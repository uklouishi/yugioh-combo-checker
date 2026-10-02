/**
 * 快捷模式：让引擎自己从起手打到终场。
 *
 * 引擎没法复制局面，每试一种打法都要从头重放，所以用有限宽度的束搜索：
 * 每一层从当前最好的几个局面出发，试每一个召唤和发动（检索选哪张、发动哪个效果也分开试几种），
 * 按「终场条件满足多少 + 还剩多少资源」给新局面打分，只留最好的几个往下走，直到时间用完或没有新局面。
 * 搜到的最好局面就是生成的路线。它只是「引擎在时间内找到的」，不一定是最优展开。
 *
 * 终场条件：每张重要终端要在哪个区域、什么优先级。最高优先的卡先争取（一张最高优先抵得过 20 张高优先）。
 * 没有标重要终端时，尽量多出额外卡组的怪兽。
 */
import { OcgMessageType, OcgResponseType, type OcgCoreSync, type OcgResponse } from "ocgcore-wasm";
import { isExtraDeckCard, TYPE, type EngineData } from "../engine/data";
import { settle } from "../engine/run";
import { autoRespond, DuelSession, type DuelSetup, type PlayerField, type SelectMessage } from "../engine/session";
import type { KeyPriority, KeyZone } from "./model";

export interface AutoTarget {
  card: number;
  zone: KeyZone;
  priority: KeyPriority;
}

export interface AutoplayOptions {
  core: OcgCoreSync;
  data: EngineData;
  setup: DuelSetup;
  targets: AutoTarget[];
  /** 时间上限（毫秒）。 */
  timeMs?: number;
  /** 每层留几个局面。 */
  beam?: number;
  /** 让出主线程（页面不卡）。 */
  pause?: () => Promise<void>;
  /** 返回 true 时尽快停下，交出目前最好的结果。 */
  cancelled?: () => boolean;
  onProgress?: (p: { elapsed: number; nodes: number; depth: number; best: number }) => void;
}

export interface AutoplayResult {
  /** 回合结束的对局（调用方负责 destroy），可以直接 toCombo。 */
  session: DuelSession;
  /** 结束回合之前的回应（「接着手动打」从这里开始）。 */
  openAt: number;
  /** 每个终场条件有没有达成。 */
  met: (AutoTarget & { ok: boolean })[];
  nodes: number;
  elapsed: number;
  /** 时间用完时还没搜完。 */
  timedOut: boolean;
}

const PRIORITY_WEIGHT: Record<KeyPriority, number> = { 1: 1, 2: 20, 3: 400 };
type IdleMsg = Extract<SelectMessage, { type: OcgMessageType.SELECT_IDLECMD }>;

/** 每个区域里的卡（同名多张就列多次）。 */
export function zonesOf(f: PlayerField): Record<KeyZone, number[]> {
  const mons = f.monsters.filter((c) => c !== null);
  return {
    field: [...mons, ...f.spells.filter((c) => c !== null)].map((c) => c.code),
    gy: f.grave.map((c) => c.code),
    banished: f.banished.map((c) => c.code),
    material: mons.flatMap((c) => c.overlays),
  };
}

/** 哪些条件达成了：同一张卡标了一次，只要那个区域里有一张就算。 */
export function targetsMet(targets: AutoTarget[], f: PlayerField): boolean[] {
  const z = zonesOf(f);
  return targets.map((t) => z[t.zone].includes(t.card));
}

interface Node {
  responses: OcgResponse[];
  goal: number;
  score: number;
  key: string;
  depth: number;
}

/** 开一局并重放到第一个没记录的提示；缺脚本时补取。 */
async function open(core: OcgCoreSync, data: EngineData, setup: DuelSetup, responses: OcgResponse[]) {
  return settle(core, data, new DuelSession(core, data, setup, responses).start());
}

export async function autoplay(opts: AutoplayOptions): Promise<AutoplayResult | null> {
  const { core, data, setup, targets } = opts;
  const t0 = Date.now();
  const deadline = t0 + (opts.timeMs ?? 30_000);
  const beam = opts.beam ?? 8;
  const targetCards = new Set(targets.map((t) => t.card));
  const elapsed = () => Date.now() - t0;
  const over = () => Date.now() > deadline || !!opts.cancelled?.();
  let nodes = 0;
  let timedOut = false;

  await data.prefetch(DuelSession.scriptsFor(setup, data));
  const extraCard = (code: number) => {
    const c = data.cards.get(code);
    return !!c && isExtraDeckCard(c);
  };
  const isTrap = (code: number) => ((data.cards.get(code)?.type ?? 0) & TYPE.TRAP) !== 0;

  const goalOf = (f: PlayerField) => {
    if (!targets.length) return f.monsters.filter((c) => c && extraCard(c.code)).length;
    const met = targetsMet(targets, f);
    return targets.reduce((s, t, i) => s + (met[i] ? PRIORITY_WEIGHT[t.priority] : 0), 0);
  };
  /** 还有多少资源：能做的事、手卡、场上的怪兽。终场条件一样时，资源多的局面往下走更有希望。 */
  const potential = (f: PlayerField, m: IdleMsg) => {
    const mons = f.monsters.filter((c) => c !== null);
    const options = m.activates.length + m.special_summons.length + m.summons.length;
    const targetInReach = [...f.hand, ...f.grave].filter((c) => targetCards.has(c.code)).length;
    return options * 0.4 + f.hand.length * 0.3 + mons.length * 0.5 + mons.filter((c) => extraCard(c.code)).length * 0.8 + targetInReach * 0.5 + f.grave.length * 0.05;
  };
  const keyOf = (s: DuelSession, f: PlayerField) => {
    const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b).join(",");
    const z = zonesOf(f);
    // 用过哪些卡的效果（按卡号计数）近似一回合一次的限制
    const used = sorted(s.actions.flatMap((a) => (a.code ? [a.code] : [])));
    return [sorted(f.hand.map((c) => c.code)), sorted(z.field), sorted(z.material), sorted(z.gy), sorted(z.banished), used].join("|");
  };

  /** 自己的非主要阶段提示有哪些值得分开试的回答：第一个是默认。 */
  const choices = (m: SelectMessage): OcgResponse[] => {
    const def = autoRespond(m);
    switch (m.type) {
      case OcgMessageType.SELECT_CHAIN: {
        if (!m.selects.length) return [def];
        // 默认发动自己的效果；不强制时也试一次不发动
        const acts = m.selects.slice(0, 2).map((_, i) => ({ type: OcgResponseType.SELECT_CHAIN, index: i }) as OcgResponse);
        return m.forced ? acts : [...acts, { type: OcgResponseType.SELECT_CHAIN, index: null }];
      }
      case OcgMessageType.SELECT_EFFECTYN:
      case OcgMessageType.SELECT_YESNO:
        return [def, autoRespond(m, 1)];
      case OcgMessageType.SELECT_OPTION:
        return m.options.map((_, i) => ({ type: OcgResponseType.SELECT_OPTION, index: i }) as OcgResponse);
      case OcgMessageType.SELECT_CARD: {
        if (m.max !== 1 || m.selects.length < 2) return [def];
        // 检索、特召选哪一张：每种卡试一次，重要终端优先
        const seen = new Set<number>();
        const picks: { i: number; code: number }[] = [];
        m.selects.forEach((c, i) => {
          if (!seen.has(c.code)) {
            seen.add(c.code);
            picks.push({ i, code: c.code });
          }
        });
        picks.sort((a, b) => Number(targetCards.has(b.code)) - Number(targetCards.has(a.code)));
        return picks.map((p) => ({ type: OcgResponseType.SELECT_CARD, indicies: [p.i] }) as OcgResponse);
      }
      default:
        return [def];
    }
  };

  /**
   * 从一个主要阶段局面做一个动作，把之后的选择也分开试几种，得到下一批主要阶段局面。
   * 每条分支都要从头重放一次，所以每个动作最多试 maxPaths 条。
   */
  const expand = async (prefix: OcgResponse[], maxPaths: number): Promise<{ s: DuelSession; f: PlayerField; m: IdleMsg }[]> => {
    const out: { s: DuelSession; f: PlayerField; m: IdleMsg }[] = [];
    const queue: OcgResponse[][] = [prefix];
    let started = 0;
    while (queue.length && started < maxPaths && !over()) {
      const responses = queue.shift()!;
      started++;
      nodes++;
      await opts.pause?.();
      const s = await open(core, data, setup, responses);
      let attempt = 0;
      let ok = true;
      for (let guard = 0; guard < 300 && s.status === "prompt" && s.prompt && s.prompt.msg.type !== OcgMessageType.SELECT_IDLECMD; guard++) {
        const m = s.prompt.msg;
        if (s.prompt.retry) {
          if (++attempt > 6) {
            ok = false;
            break;
          }
          s.respond(autoRespond(m, attempt));
          continue;
        }
        attempt = 0;
        const cs = choices(m);
        for (const alt of cs.slice(1)) if (queue.length + started < maxPaths) queue.push([...s.responses, alt]);
        s.respond(cs[0]);
      }
      const m = s.prompt?.msg;
      if (ok && s.status === "prompt" && m?.type === OcgMessageType.SELECT_IDLECMD) out.push({ s, f: s.field()[0], m });
      else s.destroy();
    }
    return out;
  };

  /** 主要阶段能做的动作：召唤、特召、发动，以及把陷阱盖放（终场的一部分）。 */
  const idleMoves = (m: IdleMsg): OcgResponse[] => {
    const r = (action: number, index: number) => ({ type: OcgResponseType.SELECT_IDLECMD, action, index }) as OcgResponse;
    return [
      ...m.special_summons.map((_, i) => r(1, i)),
      ...m.activates.map((_, i) => r(5, i)),
      ...m.summons.map((_, i) => r(0, i)),
      ...m.spell_sets.flatMap((c, i) => (isTrap(c.code) || targetCards.has(c.code) ? [r(4, i)] : [])),
    ];
  };

  // 起手局面
  const root = await open(core, data, setup, []);
  const rf = root.field()[0];
  const rm = root.prompt?.msg;
  if (root.status !== "prompt" || rm?.type !== OcgMessageType.SELECT_IDLECMD) {
    root.destroy();
    return null;
  }
  const rootNode: Node = { responses: [...root.responses], goal: goalOf(rf), score: potential(rf, rm), key: keyOf(root, rf), depth: 0 };
  root.destroy();

  let best = rootNode;
  const better = (a: Node, b: Node) => a.goal > b.goal || (a.goal === b.goal && a.score > b.score);
  const seen = new Set<string>([rootNode.key]);
  let frontier: Node[] = [rootNode];
  let depth = 0;
  const allMet = targets.reduce((s, t) => s + PRIORITY_WEIGHT[t.priority], 0);
  // 条件全部达成就停（没标重要终端时一直搜到时间用完）
  const done = () => targets.length > 0 && best.goal >= allMet;
  while (frontier.length && !over() && !done()) {
    depth++;
    const next: Node[] = [];
    for (const node of frontier) {
      const s = await open(core, data, setup, node.responses);
      const m = s.prompt?.msg;
      s.destroy();
      if (m?.type !== OcgMessageType.SELECT_IDLECMD) continue;
      for (const move of idleMoves(m)) {
        if (over() || done()) break;
        for (const c of await expand([...node.responses, move], 4)) {
          const key = keyOf(c.s, c.f);
          if (!seen.has(key)) {
            seen.add(key);
            const child: Node = { responses: [...c.s.responses], goal: goalOf(c.f), score: potential(c.f, c.m), key, depth };
            next.push(child);
            if (better(child, best)) best = child;
          }
          c.s.destroy();
        }
      }
      opts.onProgress?.({ elapsed: elapsed(), nodes, depth, best: best.goal });
    }
    // 留终场条件满足得多的，其次资源多的
    next.sort((a, b) => b.goal - a.goal || b.score - a.score);
    frontier = next.slice(0, beam);
  }
  timedOut = frontier.length > 0 && !done();

  // 在最好的局面结束回合
  const s = await open(core, data, setup, best.responses);
  const openAt = s.responses.length;
  for (let guard = 0, attempt = 0; guard < 300 && s.status === "prompt" && s.prompt; guard++) {
    attempt = s.prompt.retry ? attempt + 1 : 0;
    if (attempt > 6) break;
    const m = s.prompt.msg;
    // 结束阶段之类的诱发效果照常发动
    const r = m.type === OcgMessageType.SELECT_CHAIN && m.selects.length && attempt === 0 ? ({ type: OcgResponseType.SELECT_CHAIN, index: 0 } as OcgResponse) : autoRespond(m, attempt);
    s.respond(r);
  }
  const met = targetsMet(targets, s.field()[0]);
  return { session: s, openAt, met: targets.map((t, i) => ({ ...t, ok: met[i] })), nodes, elapsed: elapsed(), timedOut };
}

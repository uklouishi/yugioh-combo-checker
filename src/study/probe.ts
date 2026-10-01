/**
 * 用规则引擎自动试「被手坑打断后，手里另一张卡能不能接着续上」：
 *
 * 1. 按玩家存下的对局记录重放路线（按卡名对上每一次选择，手里多了一张卡也能对上），
 *    对手在被打的那张卡发动效果时用手坑连锁。
 * 2. 被打之后，在引擎里有限深度地试召唤和发动，看能不能用那张卡续出路线里的关键怪兽
 *    （路线里会让重要终端出不来的额外怪兽，或重要终端本身）。
 *
 * 结果只是建议，玩家确认后才算进手坑优先级。
 */
import { OcgMessageType, OcgResponseType, type OcgCoreSync, type OcgResponse } from "ocgcore-wasm";
import type { EngineData } from "../engine/data";
import { decodeReplay } from "../engine/replay";
import { settle } from "../engine/run";
import { autoRespond, DuelSession, type DuelSetup, type SelectMessage } from "../engine/session";
import { sigCard, type StudyComparison } from "./compare";
import type { Combo } from "../model/schema";
import { starterHand, type DeckStudy, type Recovery, type Starter } from "./model";
import { practiceMain } from "./wildcard";

/** 一次自己的选择，按卡名记（换了手牌、卡组里的位置变了也能对上）。 */
interface ScriptStep {
  type: number;
  codes: (number | null)[];
  desc?: string;
  raw: OcgResponse;
}

const IDLE_LISTS = ["summons", "special_summons", "pos_changes", "monster_sets", "spell_sets", "activates"] as const;
type IdleMsg = Extract<SelectMessage, { type: OcgMessageType.SELECT_IDLECMD }>;
const idleList = (m: IdleMsg, action: number): { code: number; description?: bigint }[] => m[IDLE_LISTS[action as 0 | 1 | 2 | 3 | 4 | 5]];

function describe(m: SelectMessage, r: OcgResponse): ScriptStep {
  const step: ScriptStep = { type: m.type, codes: [], raw: r };
  if (m.type === OcgMessageType.SELECT_IDLECMD && r.type === OcgResponseType.SELECT_IDLECMD && r.action <= 5 && r.index !== null) {
    const c = idleList(m, r.action)[r.index];
    step.codes = [c?.code ?? null];
    if (r.action === 5) step.desc = String(m.activates[r.index]?.description);
  } else if (m.type === OcgMessageType.SELECT_CHAIN && r.type === OcgResponseType.SELECT_CHAIN) {
    const c = r.index === null ? null : m.selects[r.index];
    step.codes = [c?.code ?? null];
    if (c) step.desc = String(c.description);
  } else if ((m.type === OcgMessageType.SELECT_CARD || m.type === OcgMessageType.SELECT_TRIBUTE || m.type === OcgMessageType.SELECT_SUM) && "indicies" in r && r.indicies) {
    step.codes = r.indicies.map((i) => m.selects[i]?.code ?? null);
  } else if (m.type === OcgMessageType.SELECT_UNSELECT_CARD && r.type === OcgResponseType.SELECT_UNSELECT_CARD) {
    step.codes = [r.index === null ? null : (m.select_cards[r.index]?.code ?? null)];
  }
  return step;
}

/** 把记下的选择套到新的提示上：按卡名找位置。对不上返回 null。 */
function remap(m: SelectMessage, step: ScriptStep): OcgResponse | null {
  if (m.type !== step.type) return null;
  const r = step.raw;
  if (m.type === OcgMessageType.SELECT_IDLECMD && r.type === OcgResponseType.SELECT_IDLECMD && r.action <= 5 && r.index !== null) {
    const list = idleList(m, r.action);
    let i = list.findIndex((c) => c.code === step.codes[0] && (step.desc === undefined || String(c.description) === step.desc));
    if (i < 0) i = list.findIndex((c) => c.code === step.codes[0]);
    return i < 0 ? null : { type: OcgResponseType.SELECT_IDLECMD, action: r.action, index: i };
  }
  if (m.type === OcgMessageType.SELECT_CHAIN) {
    if (step.codes[0] === null) return { type: OcgResponseType.SELECT_CHAIN, index: null };
    let i = m.selects.findIndex((c) => c.code === step.codes[0] && String(c.description) === step.desc);
    if (i < 0) i = m.selects.findIndex((c) => c.code === step.codes[0]);
    return i < 0 ? null : { type: OcgResponseType.SELECT_CHAIN, index: i };
  }
  if ((m.type === OcgMessageType.SELECT_CARD || m.type === OcgMessageType.SELECT_TRIBUTE || m.type === OcgMessageType.SELECT_SUM) && "indicies" in r) {
    const used = new Set<number>();
    for (const code of step.codes) {
      const i = m.selects.findIndex((c, j) => c.code === code && !used.has(j));
      if (i < 0) return null;
      used.add(i);
    }
    return { ...r, indicies: [...used].sort((a, b) => a - b) } as OcgResponse;
  }
  if (m.type === OcgMessageType.SELECT_UNSELECT_CARD) {
    if (step.codes[0] === null) return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null };
    const i = m.select_cards.findIndex((c) => c.code === step.codes[0]);
    return i < 0 ? null : { type: OcgResponseType.SELECT_UNSELECT_CARD, index: i };
  }
  return r;
}

/** 照着路线走：给一个提示，返回该怎么选；对不上（路线走不下去了）返回 null。 */
export type Follower = (m: SelectMessage) => OcgResponse | null;

/** 照着按卡名记下的选择走。 */
export function scriptFollower(script: ScriptStep[]): Follower {
  let k = 0;
  return (m) => {
    const step = script[k];
    const r = step && remap(m, step);
    if (r) k++;
    return r;
  };
}

/**
 * 没有对局记录的旧路线：照着 combo 的步骤走。主要阶段按步骤里的卡选召唤或发动，
 * 连锁时机按下一步要发动的卡，选卡时优先选这一步里移动过的卡，其余按默认。
 */
export function comboFollower(combo: Combo): Follower {
  let k = 0;
  let cur = -1;
  const next = () => combo.steps[k]?.actions[0];
  const take = () => {
    cur = k;
    k++;
  };
  const moved = () => new Set((combo.steps[cur]?.moves ?? []).map((mv) => mv.card.id));
  return (m) => {
    switch (m.type) {
      case OcgMessageType.SELECT_IDLECMD: {
        const a = next();
        if (!a) return null;
        if (a.type === "activate") {
          const i = m.activates.findIndex((c) => c.code === a.activation.card.id);
          if (i < 0) return null;
          take();
          return { type: OcgResponseType.SELECT_IDLECMD, action: 5, index: i };
        }
        const normal = a.summon.method === "normal";
        const list = normal ? m.summons : m.special_summons;
        const i = list.findIndex((c) => c.code === a.summon.card.id);
        if (i < 0) return null;
        take();
        return { type: OcgResponseType.SELECT_IDLECMD, action: normal ? 0 : 1, index: i };
      }
      case OcgMessageType.SELECT_CHAIN: {
        const a = next();
        const i = a?.type === "activate" ? m.selects.findIndex((c) => c.code === a.activation.card.id) : -1;
        if (i >= 0) {
          take();
          return { type: OcgResponseType.SELECT_CHAIN, index: i };
        }
        return { type: OcgResponseType.SELECT_CHAIN, index: m.forced && m.selects.length ? 0 : null };
      }
      case OcgMessageType.SELECT_CARD:
      case OcgMessageType.SELECT_TRIBUTE: {
        const want = moved();
        const picked = m.selects.flatMap((c, i) => (want.has(c.code) ? [i] : [])).slice(0, m.max);
        for (let i = 0; picked.length < m.min && i < m.selects.length; i++) if (!picked.includes(i)) picked.push(i);
        return { type: m.type === OcgMessageType.SELECT_CARD ? OcgResponseType.SELECT_CARD : OcgResponseType.SELECT_TRIBUTE, indicies: picked.sort((a, b) => a - b) } as OcgResponse;
      }
      case OcgMessageType.SELECT_UNSELECT_CARD: {
        const want = moved();
        const i = m.select_cards.findIndex((c) => want.has(c.code));
        if (i >= 0) return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: i };
        return autoRespond(m);
      }
      default:
        return autoRespond(m);
    }
  };
}

/** 开一局，缺脚本时补取重放（和 run.ts 的 startDuel 一样，但可以先挂上回调）。 */
async function open(core: OcgCoreSync, data: EngineData, setup: DuelSetup, responses: OcgResponse[], hook?: DuelSession["onOwnAnswer"]) {
  await data.prefetch(DuelSession.scriptsFor(setup, data));
  const s = new DuelSession(core, data, setup, responses);
  s.onOwnAnswer = hook;
  s.start();
  return s.status === "missing_scripts" ? settle(core, data, s) : s;
}

/** 按卡名记下一条路线里自己的每一次选择。 */
export async function captureScript(core: OcgCoreSync, data: EngineData, replay: string): Promise<{ setup: DuelSetup; script: ScriptStep[] } | null> {
  const r = decodeReplay(replay);
  if (!r) return null;
  const script: ScriptStep[] = [];
  const s = await open(core, data, r.setup, r.responses, (m, resp) => script.push(describe(m, resp)));
  s.destroy();
  return { setup: r.setup, script };
}

/** 自动回答非主要阶段的提示：自己的可选效果一律发动，其余按默认。停在主要阶段返回 true。 */
function autoAnswer(s: DuelSession): boolean {
  let attempt = 0;
  for (let guard = 0; guard < 200 && s.status === "prompt" && s.prompt && s.prompt.msg.type !== OcgMessageType.SELECT_IDLECMD; guard++) {
    const m = s.prompt.msg;
    attempt = s.prompt.retry ? attempt + 1 : 0;
    if (attempt > 6) return false;
    const r = m.type === OcgMessageType.SELECT_CHAIN && m.selects.length && attempt === 0 ? ({ type: OcgResponseType.SELECT_CHAIN, index: 0 } as OcgResponse) : autoRespond(m, attempt);
    s.respond(r);
  }
  return s.status === "prompt" && s.prompt?.msg.type === OcgMessageType.SELECT_IDLECMD;
}

export interface ProbeTask {
  starterId: string;
  sig: string;
  handtrap: number;
  card: number;
}

export interface ProbeContext {
  core: OcgCoreSync;
  data: EngineData;
  /** 路线的开局设置和怎么照着走（routeFollower 的结果）。 */
  route: { setup: DuelSetup; follower: () => Follower };
  /** 续出来就算续上的卡。 */
  waypoints: Set<number>;
  depth?: number;
  nodes?: number;
  pause?: () => Promise<void>;
}

/** 试一种情况：返回续上的线，续不上返回 null。 */
export async function probe(ctx: ProbeContext, task: ProbeTask): Promise<Recovery | null> {
  const { core, data, route, waypoints } = ctx;
  const on = sigCard(task.sig);
  const setup: DuelSetup = {
    ...route.setup,
    hand: [...(route.setup.hand ?? []), task.card],
    opponentHand: [task.handtrap],
    opponentExtra: undefined,
    opponentSynchro: undefined,
    opponentPlan: { code: task.handtrap, on },
  };
  // 照着路线打，直到对手用了手坑；之后自动处理到下一个主要阶段
  const s = await open(core, data, setup, []);
  const follow = route.follower();
  let hit = false;
  for (let guard = 0; guard < 2000 && s.status === "prompt" && s.prompt; guard++) {
    hit ||= s.hits.some((h) => h.used === task.handtrap);
    if (hit) break;
    const r = follow(s.prompt.msg);
    if (!r) break;
    s.respond(r);
  }
  hit ||= s.hits.some((h) => h.used === task.handtrap);
  if (!hit || !autoAnswer(s)) {
    s.destroy();
    return null;
  }
  const base = [...s.responses];
  const before = new Set(s.field()[0].monsters.flatMap((c) => (c ? [c.code] : [])));
  const startActions = s.actions.length;
  // 手里这张卡此刻要有能做的事，否则它帮不上忙
  const m0 = s.prompt!.msg;
  const usable = m0.type === OcgMessageType.SELECT_IDLECMD && IDLE_LISTS.some((k) => k !== "pos_changes" && (m0[k] as { code: number }[]).some((c) => c.code === task.card));
  s.destroy();
  if (!usable) return null;

  const budget = { left: ctx.nodes ?? 40 };
  const depth = ctx.depth ?? 5;
  let found: Recovery | null = null;
  const visit = async (responses: OcgResponse[], d: number): Promise<void> => {
    if (found || budget.left-- <= 0) return;
    await ctx.pause?.();
    const t = await open(core, data, setup, responses);
    const ok = autoAnswer(t);
    const reached = t.field()[0].monsters.find((c) => c && c.code !== task.card && waypoints.has(c.code) && !before.has(c.code));
    const usedCard = t.actions.slice(startActions).some((a) => a.code === task.card);
    if (reached && usedCard) {
      found = { ...task, reached: reached.code, line: t.actions.slice(startActions).map((a) => a.label) };
      t.destroy();
      return;
    }
    const next = [...t.responses];
    const m = t.prompt?.msg;
    t.destroy();
    if (!ok || d >= depth || !m || m.type !== OcgMessageType.SELECT_IDLECMD) return;
    // 先试这张卡和路线里出现过的卡
    const children: { r: OcgResponse; code: number }[] = [
      ...m.special_summons.map((c, i) => ({ r: { type: OcgResponseType.SELECT_IDLECMD, action: 1, index: i } as OcgResponse, code: c.code })),
      ...m.activates.map((c, i) => ({ r: { type: OcgResponseType.SELECT_IDLECMD, action: 5, index: i } as OcgResponse, code: c.code })),
      ...m.summons.map((c, i) => ({ r: { type: OcgResponseType.SELECT_IDLECMD, action: 0, index: i } as OcgResponse, code: c.code })),
    ];
    const rank = (code: number) => (code === task.card ? 0 : waypoints.has(code) ? 1 : 2);
    children.sort((a, b) => rank(a.code) - rank(b.code));
    for (const c of children) {
      if (found || budget.left <= 0) return;
      await visit([...next, c.r], d + 1);
    }
  };
  await visit(base, 0);
  return found;
}

/**
 * 要试哪些情况：每条打出了重要终端的路线，每个会让重要终端变少的吃坑点（同一个动作只试一次，用排名最高的手坑），
 * 手里另有卡组里的哪张卡（不含手坑、这个动点自己的卡）。
 */
export function probeTasks(study: DeckStudy, cmp: StudyComparison, isHandtrap: (id: number) => boolean): ProbeTask[] {
  const tasks: ProbeTask[] = [];
  const cards = [...new Set(study.main)].filter((c) => !isHandtrap(c));
  for (const r of cmp.routes) {
    if (!r.keyEnd.length) continue;
    // 每个能让重要终端变少的动作都要试：对手会挑没被续上的那一下打
    const sigs = new Map<string, number>();
    for (const h of cmp.handtraps) {
      for (const o of h.options[r.starter.id] ?? []) if (o.keyLost > 0 && !o.sig.startsWith("sum:") && !sigs.has(o.sig)) sigs.set(o.sig, h.handtrap);
    }
    for (const [sig, handtrap] of sigs) {
      for (const card of cards) if (!r.starter.cards.includes(card)) tasks.push({ starterId: r.starter.id, sig, handtrap, card });
    }
  }
  return tasks;
}

/**
 * 续出来就算续上的卡：路线里会让重要终端出不来的融合、同调、超量、连接、仪式召唤的怪兽，加上重要终端本身。
 * （效果特召不算：很多卡能特召自己，算进来就分不出有没有真的续上。）
 */
export function waypointsOf(cmp: StudyComparison): Set<number> {
  const out = new Set<number>();
  for (const r of cmp.routes) {
    for (const k of r.keyEnd) out.add(k);
    for (const [sig, lost] of Object.entries(r.sigLoss)) {
      if (lost > 0 && /^sum:\d+:(fusion|synchro|xyz|link|ritual)$/.test(sig)) out.add(sigCard(sig));
    }
  }
  return out;
}

/** 一条路线怎么重放：有对局记录就按记录，没有就照着 combo 的步骤走。 */
export async function routeFollower(
  core: OcgCoreSync,
  data: EngineData,
  study: DeckStudy,
  starter: Starter,
): Promise<{ setup: DuelSetup; follower: () => Follower; exact: boolean } | null> {
  const replay = study.replays[starter.id];
  if (replay) {
    const cap = await captureScript(core, data, replay);
    if (cap) return { setup: cap.setup, follower: () => scriptFollower(cap.script), exact: true };
  }
  const combo = study.routes[starter.id];
  if (!combo) return null;
  const setup: DuelSetup = { main: practiceMain(study, starter), extra: study.extra, hand: starterHand(starter), opponentHand: [], format: study.format, seed: 1 };
  return { setup, follower: () => comboFollower(combo), exact: false };
}

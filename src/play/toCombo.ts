/**
 * 把一局实战练习导出成 combo 文件（和「打开」「分析」页用的是同一种格式）。
 *
 * 每个自己的操作（召唤、发动…）是一个 step；卡片移动来自引擎的 MOVE 消息，
 * 效果标签（检索、从墓地特召…）按效果处理期间的移动推出来，吃坑点用练习里引擎实际给出的时点。
 */
import { OcgLocation } from "ocgcore-wasm";
import { handtrapById } from "../data";
import { TYPE, type EngineData } from "../engine/data";
import { DRAW_HANDTRAPS, type DuelSession, type TraceEntry } from "../engine/session";
import { Combo, type CardRef, type EffectTag, type InterruptionNote, type Move, type Step, type StepAction, type SummonMethod, type Zone } from "../model/schema";

const OVERLAY = 0x80;
// OcgPosition：1 表侧攻击、2 里侧攻击、4 表侧守备、8 里侧守备
const POS_FACEDOWN = 0x2 | 0x8;
const POS_DEFENSE = 0x4 | 0x8;

type MoveEntry = Extract<TraceEntry, { kind: "move" }>;

/** 引擎的位置 → combo 的区域和格子。null 表示 combo 格式里没有这个区域（衍生物等）。 */
function zoneOf(loc: { location: number; sequence: number }): { zone: Zone; slot?: number } | null {
  if (loc.location & OVERLAY) return null;
  switch (loc.location) {
    case OcgLocation.DECK:
      return { zone: "deck" };
    case OcgLocation.HAND:
      return { zone: "hand" };
    case OcgLocation.EXTRA:
      return { zone: "extra" };
    case OcgLocation.GRAVE:
      return { zone: "gy" };
    case OcgLocation.REMOVED:
      return { zone: "banished" };
    case OcgLocation.MZONE:
      return loc.sequence >= 5 ? { zone: "emz", slot: loc.sequence - 5 } : { zone: "monster", slot: loc.sequence };
    case OcgLocation.SZONE:
      return loc.sequence === 5 ? { zone: "field_zone", slot: 0 } : loc.sequence < 5 ? { zone: "spell_trap", slot: loc.sequence } : null;
    default:
      return null;
  }
}

/** 效果处理中的一次移动说明了效果包含什么处理。 */
function tagOf(from: Zone, to: Zone): EffectTag | null {
  const field = (z: Zone) => z === "monster" || z === "emz";
  if (from === "deck" && to === "hand") return "add_from_deck";
  if (from === "deck" && field(to)) return "ss_from_deck";
  if (from === "deck" && to === "gy") return "send_from_deck_to_gy";
  if (from === "deck" && (to === "spell_trap" || to === "field_zone")) return "set_from_deck";
  if (from === "gy" && (to === "hand" || to === "deck" || to === "extra")) return "add_from_gy";
  if (from === "gy" && field(to)) return "ss_from_gy";
  if (from === "gy" && to === "banished") return "banish_from_gy";
  if (from === "hand" && field(to)) return "ss_from_hand";
  if (from === "banished" && field(to)) return "ss_from_banished";
  if (to === "banished") return "banish";
  return null;
}

function summonMethod(data: EngineData, code: number, from: Zone, normal: boolean): SummonMethod {
  if (normal) return "normal";
  const c = data.cards.get(code);
  if (from === "extra" && c) {
    if (c.type & TYPE.LINK) return "link";
    if (c.type & TYPE.XYZ) return "xyz";
    if (c.type & TYPE.SYNCHRO) return "synchro";
    if (c.type & TYPE.FUSION) return "fusion";
  }
  return "special";
}

/** 并到别的步骤里的移动：原来记的时点对那一步没有意义，去掉（播放时放在最后）。 */
function untimed({ afterAction: _a, resolving: _r, ...m }: Move): Move {
  return m;
}

export interface ExportOptions {
  title?: string;
  deck?: string;
  /** 用于 id 和日期，测试时固定。 */
  now?: Date;
}

export function toCombo(session: DuelSession, opts: ExportOptions = {}): Combo {
  const { data, setup } = session;
  const ref = (code: number): CardRef => ({ id: code, name: data.name(code) });
  const now = opts.now ?? new Date();

  // 起手：指定起手，或开局抽到的 5 张
  const opening = setup.hand ?? session.trace.filter((t) => t.action < 0 && t.kind === "draw" && t.player === 0).flatMap((t) => (t.kind === "draw" ? t.codes : []));

  const steps: Step[] = [];
  const usedDeck: number[] = [];
  const usedExtra: number[] = [];
  // Maxx "C" 类手坑任何时点都能丢，只在第一次出现的步骤里记
  const drawNoted = new Set<number>();
  let carry: Move[] = [];
  let carryTitle: string[] = [];

  session.actions.forEach((action, ai) => {
    const entries = session.trace.filter((t) => t.action === ai);
    const moves: Move[] = [];
    const notes: string[] = [];
    const actions: StepAction[] = [];
    // 记下每次移动发生在第几个动作之后、正在处理哪一环连锁，播放时按这个顺序演示
    const when = (): Pick<Move, "afterAction" | "resolving"> => ({
      afterAction: actions.length,
      ...(resolving !== null && { resolving }),
    });
    // 连锁序号 → 那一环的发动（效果处理期间的移动给它加标签）
    const byLink = new Map<number, Extract<StepAction, { type: "activate" }>["activation"]>();
    let resolving: number | null = null;
    // 这个操作里从手卡放到魔陷区的卡：随后的发动算作从手卡发动魔法/陷阱
    const placedFromHand = new Set<number>();

    for (const t of entries) {
      if (t.kind === "draw" && t.player === 0) {
        for (const code of t.codes) moves.push({ card: ref(code), from: "deck", to: "hand", ...when() });
        if (resolving !== null) byLink.get(resolving)?.effects.push("draw");
      } else if (t.kind === "chain" && t.controller === 0) {
        const c = data.cards.get(t.code);
        let from = zoneOf(t)?.zone ?? "hand";
        let kind: "monster_effect" | "spell_card" | "trap_card" | "spell_trap_effect" = "monster_effect";
        if (c && !(c.type & TYPE.MONSTER)) {
          if (placedFromHand.has(t.code)) {
            from = "hand";
            kind = c.type & TYPE.TRAP ? "trap_card" : "spell_card";
          } else kind = "spell_trap_effect";
        }
        const activation: Extract<StepAction, { type: "activate" }>["activation"] = { card: ref(t.code), from, kind, chainLink: t.link, effects: [] };
        byLink.set(t.link, activation);
        actions.push({ type: "activate", activation });
      } else if (t.kind === "solving") {
        resolving = t.link;
      } else if (t.kind === "solved") {
        resolving = null;
      } else if (t.kind === "summon" && t.controller === 0) {
        // 召唤从哪里来在下面按进场的移动补上
        const summon = { card: ref(t.code), method: summonMethod(data, t.code, "hand", t.normal), from: "hand" as Zone };
        actions.push({ type: resolving !== null ? "resolve_summon" : "summon", summon });
      } else if (t.kind === "move") {
        const m = t as MoveEntry;
        if (m.to.controller !== 0 && m.from.controller !== 0) continue;
        if (m.from.location === m.to.location && !(m.from.location & OVERLAY)) continue; // 同一区域内换格子、改变表示形式
        if (m.to.location & OVERLAY && m.from.location === OcgLocation.MZONE && m.from.controller === 0) {
          // 超量素材：combo 格式没有素材区，记在墓地
          moves.push({ card: ref(m.code), from: zoneOf(m.from)!.zone, to: "gy", ...when() });
          notes.push(`${data.name(m.code)} 成为超量素材（场地里记在墓地）`);
          continue;
        }
        if (m.from.location & OVERLAY) {
          if (m.to.location === OcgLocation.GRAVE) continue; // 素材已经记在墓地
          const to = zoneOf(m.to);
          if (to && m.to.controller === 0) moves.push({ card: ref(m.code), from: "gy", to: to.zone, slot: to.slot, ...when() });
          continue;
        }
        const from = zoneOf(m.from);
        const to = zoneOf(m.to);
        if (!from || !to || m.to.controller !== 0 || m.from.controller !== 0) continue;
        const move: Move = { card: ref(m.code), from: from.zone, to: to.zone };
        if (to.slot !== undefined) move.slot = to.slot;
        const onField = to.zone === "monster" || to.zone === "emz" || to.zone === "spell_trap" || to.zone === "field_zone";
        if (onField && m.to.position & POS_FACEDOWN) move.faceDown = true;
        if ((to.zone === "monster" || to.zone === "emz") && m.to.position & POS_DEFENSE) move.defense = true;
        Object.assign(move, when());
        moves.push(move);
        if (from.zone === "hand" && (to.zone === "spell_trap" || to.zone === "field_zone")) placedFromHand.add(m.code);
        if (from.zone === "deck") usedDeck.push(m.code);
        if (from.zone === "extra") usedExtra.push(m.code);
        if (resolving !== null) {
          const tag = tagOf(from.zone, to.zone);
          const a = byLink.get(resolving);
          if (tag && a && !a.effects.includes(tag)) a.effects.push(tag);
        }
      }
    }

    // 召唤从哪里来：看这张卡进场的那次移动
    for (const a of actions) {
      if (a.type === "activate") continue;
      const enter = moves.find((mv) => mv.card.id === a.summon.card.id && (mv.to === "monster" || mv.to === "emz"));
      if (enter) {
        a.summon.from = enter.from;
        const t = entries.find((e) => e.kind === "summon" && e.code === a.summon.card.id);
        a.summon.method = summonMethod(data, a.summon.card.id, enter.from, t?.kind === "summon" && t.normal);
      }
    }

    if (action.label === "结束回合" || action.label === "进入战斗阶段") {
      if (steps.length) steps.at(-1)!.moves.push(...moves.map(untimed));
      return;
    }
    if (!actions.length) {
      // 盖放魔陷、改变表示形式：combo 格式里没有对应的动作，并到相邻的步骤里
      carry.push(...moves.map((m) => ({ ...untimed(m), afterAction: 0 })));
      carryTitle.push(action.label);
      return;
    }

    const interruptions: InterruptionNote[] = [];
    const hitActions = ai === 0 ? [-1, 0] : [ai];
    for (const h of session.hits.filter((x) => hitActions.includes(x.action))) {
      for (const o of h.options) {
        if (!handtrapById.has(o.code) || interruptions.some((n) => n.handtrap === o.code)) continue;
        if (DRAW_HANDTRAPS.has(o.code) && h.used !== o.code) {
          if (drawNoted.has(o.code)) continue;
          drawNoted.add(o.code);
        }
        interruptions.push({
          handtrap: o.code,
          note: h.used === o.code ? `练习中对手在「${h.context}」时发动了这张。` : `实战练习：对手可以在「${h.context}」时连锁。`,
          applies: true,
        });
      }
    }

    steps.push({
      id: `s${steps.length + 1}`,
      title: [...carryTitle, action.label].join("，"),
      actions,
      moves: [...carry, ...moves],
      interruptions,
      ...(notes.length && { notes: notes.join("；") }),
    });
    carry = [];
    carryTitle = [];
  });
  if (carry.length && steps.length) steps.at(-1)!.moves.push(...carry.map(untimed));

  const [me] = session.field();
  const board = [...me.monsters, ...me.spells].filter((c): c is NonNullable<typeof c> => c !== null);
  const starterNames = opening.map((c) => data.name(c));
  const extraCount = new Map<number, number>();
  for (const c of usedExtra) extraCount.set(c, (extraCount.get(c) ?? 0) + 1);

  const combo = {
    id: `play-${now.getTime().toString(36)}`,
    deck: opts.deck ?? "实战练习",
    title: opts.title ?? `实战练习：${starterNames.join("、")}`,
    format: setup.format === "ocg" ? "OCG" : "TCG",
    updatedAt: now.toISOString().slice(0, 10),
    sources: ["在本站「实战练习」里用规则引擎实际打出来的路线，吃坑点来自引擎给对手的连锁时点。"],
    starter: opening.map(ref),
    requires: {
      deck: [...new Set(usedDeck)].map(ref),
      // 场地模拟从额外卡组取卡，同名卡用了几张就列几张
      extra: [...extraCount].flatMap(([c, n]) => Array.from({ length: n }, () => ref(c))),
    },
    handSize: Math.max(1, opening.length),
    deckSize: Math.min(60, Math.max(40, setup.main.length)),
    steps,
    endboard: {
      cards: board.map((c) => ref(c.code)),
      description: `场上 ${me.monsters.filter(Boolean).length} 只怪兽、${me.spells.filter(Boolean).length} 张魔陷，手卡 ${me.hand.length} 张。`,
    },
  };
  return Combo.parse(combo);
}

/** 是否有可以导出的内容：回合打完，并且至少有一个步骤。 */
export const canExport = (s: DuelSession | null) =>
  !!s && s.status === "turn_over" && s.actions.some((a) => a.label !== "结束回合" && a.label !== "进入战斗阶段");

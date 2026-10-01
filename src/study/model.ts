/**
 * 卡组研究：一副卡组的动点（单卡动、两卡动）、玩家选的重要终端，以及每个动点实际打出来的路线。
 *
 * 玩家在练习模式里用固定起手把每个动点打一遍，存成 combo；对比页把所有路线放在一起，
 * 按「打掉多少重要终端」给手坑排优先级。保存在浏览器本地，可以导出/导入 JSON。
 */
import { z } from "zod";
import { CardId, Combo } from "../model/schema";

/** 「任意魔法师族怪兽」「任意 Dark Magician 字段的卡」这类条件：都不写就是任意怪兽。 */
export const CardFilter = z.object({
  /** 字段代码（引擎的 setcode）。只按字段时魔法、陷阱也算。 */
  setcode: z.number().int().positive().optional(),
  /** 字段名，只用来显示。 */
  setname: z.string().optional(),
  /** 种族（引擎的 RACE 位）。 */
  race: z.number().int().positive().optional(),
  /** 属性（引擎的 ATTRIBUTE 位）。 */
  attribute: z.number().int().positive().optional(),
  /** 等级/阶级不超过多少。 */
  maxLevel: z.number().int().min(1).max(12).optional(),
});
export type CardFilter = z.infer<typeof CardFilter>;

/** 起手里有一张「符合条件的任意卡」。练习时用代表卡放进手里。 */
export const Wildcard = z.object({
  filter: CardFilter,
  /** 练习时放进起手的卡：默认是符合条件的白板（没有效果），也可以是卡组里的某一张。 */
  representative: CardId,
});
export type Wildcard = z.infer<typeof Wildcard>;

export const Starter = z.object({
  id: z.string(),
  /** 起手的卡（单卡动 1 张，两卡动 2 张）。 */
  cards: z.array(CardId).min(1).max(5),
  /** 再加一张符合条件的任意卡（比如 Regulus + 任意魔法师族怪兽）。 */
  wildcard: Wildcard.optional(),
});
export type Starter = z.infer<typeof Starter>;

/** 一套换 side：换出主卡组的卡、换入 side 的卡（同名卡换几张就列几次）。 */
export const SidePlan = z.object({
  out: z.array(CardId).default([]),
  in: z.array(CardId).default([]),
});
export type SidePlan = z.infer<typeof SidePlan>;

/** 引擎试出来的续打：这条路线在这个动作被手坑打断后，手里另有 card 时能接着出 reached。 */
export const Recovery = z.object({
  starterId: z.string(),
  /** 被打的动作（compare.ts 的 actionSig）。 */
  sig: z.string(),
  /** 试的时候用的手坑。 */
  handtrap: CardId,
  card: CardId,
  /** 续出来的关键怪兽（路线里的额外怪兽或重要终端）。 */
  reached: CardId,
  line: z.array(z.string()),
  /** 玩家确认：true 对，false 不对，没写表示还没确认。 */
  ok: z.boolean().optional(),
});
export type Recovery = z.infer<typeof Recovery>;

/** 重要终端要在哪里才算达成。 */
export const KeyZone = z.enum(["field", "gy", "banished", "material"]);
export type KeyZone = z.infer<typeof KeyZone>;
/** 1 优先、2 高优先、3 最高优先。 */
export const KeyPriority = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type KeyPriority = z.infer<typeof KeyPriority>;
export const KeyTarget = z.object({ zone: KeyZone.default("field"), priority: KeyPriority.default(1) });
export type KeyTarget = z.infer<typeof KeyTarget>;

export const DeckStudy = z.object({
  id: z.string(),
  name: z.string(),
  format: z.enum(["tcg", "ocg"]).default("tcg"),
  main: z.array(CardId),
  extra: z.array(CardId).default([]),
  /** 卡号 → 这张卡展开时要不要用掉通常召唤。没写的当作不占。 */
  normalSummon: z.record(z.string(), z.boolean()).default({}),
  starters: z.array(Starter).default([]),
  /** 玩家选的重要终端（阻抗怪等）。 */
  keyCards: z.array(CardId).default([]),
  /** 卡号 → 重要终端的条件（在哪个区域、优先级）。没写的是场上、优先。 */
  keyTargets: z.record(z.string(), KeyTarget).default({}),
  /** 废件：先后攻都不想抽到的卡，只用来算废件上手率。 */
  bricks: z.array(CardId).default([]),
  /** side 卡组。 */
  side: z.array(CardId).default([]),
  /** 卡组里（含 side）哪些是手坑。没设置过时按网站的手坑表推荐。 */
  handtraps: z.array(CardId).optional(),
  /** 解牌（后攻破场的卡：Super Polymerization、Lava Golem…）。 */
  breakers: z.array(CardId).default([]),
  /** 玩家确认过手坑和解牌已经标好，换 side 分析才能用。 */
  rolesConfirmed: z.boolean().default(false),
  /** 先攻、后攻各一套换 side。 */
  sidePlans: z.object({ first: SidePlan, second: SidePlan }).default({ first: { out: [], in: [] }, second: { out: [], in: [] } }),
  /** 动点 id → 打出来的路线。 */
  routes: z.record(z.string(), Combo).default({}),
  /** 动点 id → 这条路线的对局记录（engine/replay.ts 的字符串），引擎自动试补点时用来重放。 */
  replays: z.record(z.string(), z.string()).default({}),
  /** 引擎试出来的「被打后靠这张卡续上」，玩家确认过的才算进手坑优先级。 */
  recoveries: z.array(Recovery).default([]),
  updatedAt: z.string(),
});
export type DeckStudy = z.infer<typeof DeckStudy>;

export const usesNormal = (study: DeckStudy, card: number) => study.normalSummon[String(card)] === true;

const count = (ids: number[], id: number) => ids.filter((x) => x === id).length;

/** 这一手能不能作为起手：卡组里张数够不够、通常召唤冲不冲突。能用返回 null。 */
export function starterProblem(study: DeckStudy, cards: number[]): string | null {
  if (!cards.length) return "至少选一张卡";
  for (const id of new Set(cards)) {
    if (count(study.main, id) < count(cards, id)) return `主卡组里没有 ${count(cards, id)} 张这张卡`;
  }
  if (cards.filter((c) => usesNormal(study, c)).length > 1) return "两张都要用通常召唤，一回合只能通召一次";
  return null;
}

/** 同样的卡（不分顺序）算同一个动点。 */
export const sameHand = (a: number[], b: number[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** 练习时的起手：指定的卡，加上通配的代表卡。 */
export const starterHand = (s: Pick<Starter, "cards" | "wildcard">) => (s.wildcard ? [...s.cards, s.wildcard.representative] : s.cards);

const sameFilter = (a?: CardFilter, b?: CardFilter) =>
  (a?.setcode ?? 0) === (b?.setcode ?? 0) &&
  (a?.race ?? 0) === (b?.race ?? 0) && (a?.attribute ?? 0) === (b?.attribute ?? 0) && (a?.maxLevel ?? 0) === (b?.maxLevel ?? 0);

/** 两个动点是不是同一手（卡一样，通配条件也一样）。 */
export const sameStarter = (a: Pick<Starter, "cards" | "wildcard">, b: Pick<Starter, "cards" | "wildcard">) =>
  sameHand(a.cards, b.cards) && !!a.wildcard === !!b.wildcard && sameFilter(a.wildcard?.filter, b.wildcard?.filter);

export function newStudy(name: string, main: number[], extra: number[], format: "tcg" | "ocg", now = new Date(), side: number[] = []): DeckStudy {
  return {
    id: `study-${now.getTime().toString(36)}`,
    name,
    format,
    main,
    extra,
    normalSummon: {},
    starters: [],
    keyCards: [],
    keyTargets: {},
    bricks: [],
    side,
    breakers: [],
    rolesConfirmed: false,
    sidePlans: { first: { out: [], in: [] }, second: { out: [], in: [] } },
    routes: {},
    replays: {},
    recoveries: [],
    updatedAt: now.toISOString().slice(0, 10),
  };
}

export function addStarter(study: DeckStudy, cards: number[], now = new Date(), wildcard?: Wildcard): DeckStudy {
  if (study.starters.some((s) => sameStarter(s, { cards, wildcard }))) return study;
  const id = `st-${now.getTime().toString(36)}-${study.starters.length}`;
  return { ...study, starters: [...study.starters, { id, cards, ...(wildcard && { wildcard }) }] };
}

export function removeStarter(study: DeckStudy, id: string): DeckStudy {
  const { [id]: _gone, ...routes } = study.routes;
  const { [id]: _replay, ...replays } = study.replays;
  return { ...study, starters: study.starters.filter((s) => s.id !== id), routes, replays, recoveries: study.recoveries.filter((r) => r.starterId !== id) };
}

/**
 * 存一条路线。单卡动顺便按路线里实际有没有通常召唤更新这张卡的通召标记
 * （引擎打出来的才是准的，两卡动分不清是哪一张召唤的，不改）。
 */
export function saveRoute(study: DeckStudy, starterId: string, combo: Combo, replay?: string): DeckStudy {
  const starter = study.starters.find((s) => s.id === starterId);
  if (!starter) return study;
  const normalSummon = { ...study.normalSummon };
  if (starter.cards.length === 1 && !starter.wildcard) {
    const ns = combo.steps.some((s) => s.actions.some((a) => a.type === "summon" && a.summon.method === "normal"));
    normalSummon[String(starter.cards[0])] = ns;
  }
  // 路线换了，之前引擎为这条路线试出来的续打作废
  const replays = { ...study.replays };
  if (replay) replays[starterId] = replay;
  else delete replays[starterId];
  const recoveries = study.recoveries.filter((r) => r.starterId !== starterId);
  return { ...study, normalSummon, routes: { ...study.routes, [starterId]: combo }, replays, recoveries };
}

/** 换 side 后的主卡组：换出的卡按张数去掉，换入的加上。 */
export function sidedMain(main: number[], plan: SidePlan): number[] {
  const out = [...main];
  for (const c of plan.out) {
    const i = out.indexOf(c);
    if (i >= 0) out.splice(i, 1);
  }
  return [...out, ...plan.in];
}

/** 换 side 的问题：换出比主卡组多、换入比 side 多、换完不在 40–60 张。没问题返回 null。 */
export function sideProblem(study: DeckStudy, plan: SidePlan): string | null {
  const count = (ids: number[], id: number) => ids.filter((x) => x === id).length;
  for (const id of new Set(plan.out)) if (count(plan.out, id) > count(study.main, id)) return "换出的张数比主卡组里的多";
  for (const id of new Set(plan.in)) if (count(plan.in, id) > count(study.side, id)) return "换入的张数比 side 里的多";
  const n = study.main.length - plan.out.length + plan.in.length;
  if (n < 40 || n > 60) return `换完主卡组是 ${n} 张，要在 40–60 张之间`;
  return null;
}

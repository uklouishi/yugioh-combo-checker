/**
 * 卡组研究：一副卡组的动点（单卡动、两卡动）、玩家选的重要终端，以及每个动点实际打出来的路线。
 *
 * 玩家在练习模式里用固定起手把每个动点打一遍，存成 combo；对比页把所有路线放在一起，
 * 按「打掉多少重要终端」给手坑排优先级。保存在浏览器本地，可以导出/导入 JSON。
 */
import { z } from "zod";
import { CardId, Combo } from "../model/schema";

export const Starter = z.object({
  id: z.string(),
  /** 起手的卡（单卡动 1 张，两卡动 2 张）。 */
  cards: z.array(CardId).min(1).max(5),
});
export type Starter = z.infer<typeof Starter>;

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
  /** 动点 id → 打出来的路线。 */
  routes: z.record(z.string(), Combo).default({}),
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

export function newStudy(name: string, main: number[], extra: number[], format: "tcg" | "ocg", now = new Date()): DeckStudy {
  return {
    id: `study-${now.getTime().toString(36)}`,
    name,
    format,
    main,
    extra,
    normalSummon: {},
    starters: [],
    keyCards: [],
    routes: {},
    updatedAt: now.toISOString().slice(0, 10),
  };
}

export function addStarter(study: DeckStudy, cards: number[], now = new Date()): DeckStudy {
  if (study.starters.some((s) => sameHand(s.cards, cards))) return study;
  const id = `st-${now.getTime().toString(36)}-${study.starters.length}`;
  return { ...study, starters: [...study.starters, { id, cards }] };
}

export function removeStarter(study: DeckStudy, id: string): DeckStudy {
  const { [id]: _gone, ...routes } = study.routes;
  return { ...study, starters: study.starters.filter((s) => s.id !== id), routes };
}

/**
 * 存一条路线。单卡动顺便按路线里实际有没有通常召唤更新这张卡的通召标记
 * （引擎打出来的才是准的，两卡动分不清是哪一张召唤的，不改）。
 */
export function saveRoute(study: DeckStudy, starterId: string, combo: Combo): DeckStudy {
  const starter = study.starters.find((s) => s.id === starterId);
  if (!starter) return study;
  const normalSummon = { ...study.normalSummon };
  if (starter.cards.length === 1) {
    const ns = combo.steps.some((s) => s.actions.some((a) => a.type === "summon" && a.summon.method === "normal"));
    normalSummon[String(starter.cards[0])] = ns;
  }
  return { ...study, normalSummon, routes: { ...study.routes, [starterId]: combo } };
}

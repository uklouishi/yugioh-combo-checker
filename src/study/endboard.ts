/**
 * 终场条件：重要终端不一定要留在场上，也可以是「墓地有」「除外有」「作为超量素材有」。
 * 每张重要终端还有优先级（优先 / 高优先 / 最高优先），对比分析里按权重算。
 */
import { simulateLenient } from "../model/board";
import type { Combo } from "../model/schema";
import type { DeckStudy, KeyPriority, KeyTarget, KeyZone } from "./model";

export const ZONE_LABEL: Record<KeyZone, string> = { field: "场上", gy: "墓地", banished: "除外", material: "超量素材" };
/** 卡图下面的下拉框很窄，用短名。 */
export const ZONE_SHORT: Record<KeyZone, string> = { field: "场上", gy: "墓地", banished: "除外", material: "素材" };
export const PRIORITY_LABEL: Record<KeyPriority, string> = { 1: "优先", 2: "高优先", 3: "最高优先" };

const DEFAULT_TARGET: KeyTarget = { zone: "field", priority: 1 };

/** 一张重要终端的条件：没设置过的是「场上有、优先」。 */
export const keyTarget = (study: Pick<DeckStudy, "keyTargets">, id: number): KeyTarget => study.keyTargets[String(id)] ?? DEFAULT_TARGET;

/** 点一下重要终端：没标 → 优先 → 高优先 → 最高优先 → 取消。条件里的区域保持不变。 */
export function cycleKey(study: DeckStudy, id: number): DeckStudy {
  const keyTargets = { ...study.keyTargets };
  if (!study.keyCards.includes(id)) {
    keyTargets[String(id)] = { ...keyTarget(study, id), priority: 1 };
    return { ...study, keyCards: [...study.keyCards, id], keyTargets };
  }
  const t = keyTarget(study, id);
  if (t.priority < 3) {
    keyTargets[String(id)] = { ...t, priority: (t.priority + 1) as KeyPriority };
    return { ...study, keyTargets };
  }
  delete keyTargets[String(id)];
  return { ...study, keyCards: study.keyCards.filter((c) => c !== id), keyTargets };
}

export function setKeyZone(study: DeckStudy, id: number, zone: KeyZone): DeckStudy {
  return { ...study, keyTargets: { ...study.keyTargets, [String(id)]: { ...keyTarget(study, id), zone } } };
}

/** 回合结束时每个区域里的卡（同名多张就列多次）。旧路线没记墓地、除外、素材时按 moves 推算。 */
export function endZones(combo: Combo): Record<KeyZone, number[]> {
  const e = combo.endboard;
  const field = e.cards.map((c) => c.id);
  if (e.grave && e.banished && e.materials) {
    return { field, gy: e.grave.map((c) => c.id), banished: e.banished.map((c) => c.id), material: e.materials.map((c) => c.id) };
  }
  const last = simulateLenient(combo).frames.at(-1)!.board;
  // 旧路线：超量召唤的素材，超量怪兽还在场上就算挂着
  const material = combo.steps.flatMap((s) =>
    s.actions.flatMap((a) => (a.type !== "activate" && a.summon.method === "xyz" && field.includes(a.summon.card.id) ? (a.summon.materials ?? []).map((c) => c.id) : [])),
  );
  // 推算的墓地里会混进当素材的卡（旧路线把素材记成送去墓地）
  const gy = last.gy.map((p) => p.card.id);
  for (const m of material) {
    const i = gy.indexOf(m);
    if (i >= 0) gy.splice(i, 1);
  }
  return { field, gy, banished: last.banished.map((p) => p.card.id), material };
}

/** 这条路线达成了哪些重要终端：每张按条件里的区域数（同名多张都算）。 */
export function keyCardsMet(study: DeckStudy, combo: Combo): number[] {
  const zones = endZones(combo);
  return study.keyCards.flatMap((id) => zones[keyTarget(study, id).zone].filter((c) => c === id));
}

/** 按优先级把每张重复列几次（优先 1、高优先 2、最高优先 3），对比分析的占比就成了加权占比。 */
export const weighted = (study: DeckStudy, ids: number[]) => ids.flatMap((id) => Array(keyTarget(study, id).priority).fill(id) as number[]);

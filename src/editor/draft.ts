/** 编辑器的草稿：形状与 Combo 一致，但允许还没选卡（id 为 0）等不完整状态。 */
import type { Combo, Move, Step, StepAction } from "../model/schema";

export type Draft = Combo;

export const EMPTY_CARD = { id: 0, name: "" };

export function newDraft(): Draft {
  return {
    id: `combo-${Date.now().toString(36)}`,
    deck: "",
    title: "",
    format: "TCG",
    handSize: 5,
    deckSize: 40,
    starter: [],
    requires: { deck: [], extra: [] },
    steps: [],
    endboard: { cards: [], description: "" },
    sources: [],
    updatedAt: new Date().toISOString().slice(0, 10),
  };
}

export function newStep(existing: Step[]): Step {
  let n = existing.length + 1;
  while (existing.some((s) => s.id === `s${n}`)) n += 1;
  return { id: `s${n}`, title: "", actions: [], moves: [], interruptions: [] };
}

const hasCard = (r: { id: number }) => r.id > 0;

/** 去掉还没选卡的动作、移动，供预览和推导使用。 */
export function sanitize(d: Draft): Draft {
  return {
    ...d,
    steps: d.steps.map((s) => ({
      ...s,
      actions: s.actions.filter((a) => (a.type === "activate" ? hasCard(a.activation.card) : hasCard(a.summon.card))),
      moves: s.moves.filter((m) => hasCard(m.card)),
    })),
  };
}

/** 根据动作推测卡片移动，作者可以再手动调整。 */
export function suggestMoves(actions: StepAction[]): Move[] {
  const moves: Move[] = [];
  for (const a of actions) {
    if (a.type === "activate") {
      const act = a.activation;
      if (!hasCard(act.card)) continue;
      if ((act.kind === "spell_card" || act.kind === "trap_card") && act.from === "hand") {
        moves.push({ card: act.card, from: "hand", to: "spell_trap" });
      }
      for (const r of act.result ?? []) {
        if (!hasCard(r)) continue;
        if (act.effects.includes("add_from_deck")) moves.push({ card: r, from: "deck", to: "hand" });
        else if (act.effects.includes("add_from_gy")) moves.push({ card: r, from: "gy", to: "hand" });
        else if (act.effects.includes("send_from_deck_to_gy")) moves.push({ card: r, from: "deck", to: "gy" });
        else if (act.effects.includes("place_as_continuous_spell")) moves.push({ card: r, from: "gy", to: "spell_trap" });
      }
      if (act.kind === "spell_card" && act.from === "hand") {
        moves.push({ card: act.card, from: "spell_trap", to: "gy" });
      }
    } else {
      const s = a.summon;
      if (!hasCard(s.card)) continue;
      for (const m of s.materials ?? []) if (hasCard(m)) moves.push({ card: m, from: "monster", to: "gy" });
      moves.push({ card: s.card, from: s.from, to: s.method === "link" ? "emz" : "monster" });
    }
  }
  return moves;
}

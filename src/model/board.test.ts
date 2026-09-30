import { describe, expect, it } from "vitest";
import { applyMove, initialBoard } from "./board";
import { Combo } from "./schema";

const SPOILS = { id: 89023486, name: "Original Sinful Spoils - Snake-Eye" };

describe("applyMove", () => {
  it("同名卡在两个格子里时，按 fromSlot 移走正确的那一张", () => {
    const combo = Combo.parse({
      id: "t",
      deck: "t",
      title: "t",
      starter: [SPOILS],
      steps: [{ id: "s1", title: "t", actions: [{ type: "summon", summon: { card: SPOILS, method: "normal", from: "hand" } }] }],
      endboard: { cards: [], description: "" },
      updatedAt: "2026-09-30",
    });
    const b = initialBoard(combo);
    b.spell_trap[0] = { card: SPOILS, faceDown: true };
    applyMove(b, { card: SPOILS, from: "hand", to: "spell_trap", slot: 1 });
    const { from } = applyMove(b, { card: SPOILS, from: "spell_trap", to: "gy", fromSlot: 1 });
    expect(from).toEqual({ zone: "spell_trap", index: 1 });
    expect(b.spell_trap[0]).toEqual({ card: SPOILS, faceDown: true });
    expect(b.spell_trap[1]).toBeNull();
  });
});

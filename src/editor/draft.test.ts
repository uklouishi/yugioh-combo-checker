import { describe, expect, it } from "vitest";
import { newDraft, newStep, sanitize, suggestMoves } from "./draft";

const ash = { id: 9674034, name: "Snake-Eye Ash" };
const poplar = { id: 90241276, name: "Snakes-Eyes Poplar" };

describe("suggestMoves", () => {
  it("通常召唤：手卡到怪兽区", () => {
    expect(suggestMoves([{ type: "summon", summon: { card: ash, method: "normal", from: "hand" } }])).toEqual([
      { card: ash, from: "hand", to: "monster" },
    ]);
  });

  it("检索：结果从卡组到手卡", () => {
    const moves = suggestMoves([
      { type: "activate", activation: { card: ash, from: "monster", kind: "monster_effect", effects: ["add_from_deck"], result: [poplar] } },
    ]);
    expect(moves).toEqual([{ card: poplar, from: "deck", to: "hand" }]);
  });

  it("连接召唤：素材进墓地，连接怪兽到额外怪兽区", () => {
    const link = { id: 2772337, name: "Promethean Princess, Bestower of Flames" };
    const moves = suggestMoves([{ type: "summon", summon: { card: link, method: "link", from: "extra", materials: [ash, poplar] } }]);
    expect(moves.map((m) => `${m.card.id}:${m.from}->${m.to}`)).toEqual([
      `${ash.id}:monster->gy`,
      `${poplar.id}:monster->gy`,
      `${link.id}:extra->emz`,
    ]);
  });
});

describe("草稿", () => {
  it("新步骤 id 不重复", () => {
    const d = newDraft();
    d.steps.push(newStep(d.steps));
    d.steps.push(newStep(d.steps));
    expect(d.steps.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("sanitize 去掉没选卡的动作和移动", () => {
    const d = newDraft();
    d.steps.push({
      id: "s1",
      title: "",
      actions: [{ type: "summon", summon: { card: { id: 0, name: "" }, method: "normal", from: "hand" } }],
      moves: [{ card: { id: 0, name: "" }, from: "hand", to: "monster" }],
      interruptions: [],
    });
    const s = sanitize(d);
    expect(s.steps[0].actions).toEqual([]);
    expect(s.steps[0].moves).toEqual([]);
  });
});

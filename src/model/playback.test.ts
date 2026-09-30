import { describe, expect, it } from "vitest";
import raw from "../data/combos/snake-eye-ash-1card.json";
import { simulate } from "./board";
import { buildBeats } from "./playback";
import { Combo } from "./schema";

const combo = Combo.parse(raw);
const frames = simulate(combo);

describe("buildBeats", () => {
  it("每一步播完后的局面和场地模拟一致", () => {
    combo.steps.forEach((step, i) => {
      const beats = buildBeats(step, frames[i].board);
      expect(beats.at(-1)!.board).toEqual(frames[i + 1].board);
      expect(beats.filter((b) => b.kind === "move")).toHaveLength(step.moves.length);
    });
  });

  it("从手卡发动魔法卡：先放到魔陷区，再标 CHAIN 1，然后处理", () => {
    const i = combo.steps.findIndex((s) => s.id === "s5");
    const beats = buildBeats(combo.steps[i], frames[i].board);
    expect(beats.map((b) => b.kind)).toEqual(["move", "activate", "move", "resolve", "move", "move"]);
    const act = beats[1];
    expect(act.caption).toContain("CHAIN 1");
    expect(act.chain).toEqual([{ link: 1, card: expect.objectContaining({ name: "Original Sinful Spoils - Snake-Eye" }), loc: { zone: "spell_trap", index: 2 } }]);
    // 代价在发动时支付
    expect(beats[2].caption).toBe("支付代价：Snake-Eyes Poplar 从怪兽区送去墓地");
    expect(beats[2].from).toEqual({ zone: "monster", index: 3 });
    // 魔法卡处理完送去墓地，标记跟着走
    expect(beats.at(-1)!.chain[0].loc).toEqual({ zone: "gy" });
  });

  it("导出的 combo 按记录的时点和连锁环演示", () => {
    const card = (id: number, name: string) => ({ id, name });
    const A = card(1, "A");
    const B = card(2, "B");
    const X = card(3, "X");
    const step = {
      id: "s1",
      title: "t",
      interruptions: [],
      actions: [
        { type: "activate" as const, activation: { card: A, from: "monster" as const, kind: "monster_effect" as const, chainLink: 1, effects: [] } },
        { type: "activate" as const, activation: { card: B, from: "hand" as const, kind: "monster_effect" as const, chainLink: 2, effects: [] } },
      ],
      moves: [
        { card: B, from: "hand" as const, to: "gy" as const, afterAction: 2 },
        { card: X, from: "deck" as const, to: "hand" as const, afterAction: 2, resolving: 1 },
      ],
    };
    const board = { ...frames[0].board, hand: [{ card: B }], monster: [{ card: A }, null, null, null, null] };
    const beats = buildBeats(step, board);
    expect(beats.map((b) => b.kind)).toEqual(["activate", "activate", "move", "resolve", "move"]);
    expect(beats[1].chain.map((c) => c.link)).toEqual([1, 2]);
    expect(beats[3].caption).toContain("CHAIN 2");
    expect(beats[4].caption).toBe("CHAIN 1 处理：X 从卡组加入手卡");
    expect(beats[4].chain.map((c) => c.link)).toEqual([1]);
  });
});

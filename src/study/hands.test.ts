import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HT } from "../model/interruptions";
import { Combo } from "../model/schema";
import { compareStudy } from "./compare";
import { simulateHands } from "./hands";
import { addStarter, newStudy, saveRoute, type DeckStudy } from "./model";

const snakeEye = Combo.parse(JSON.parse(readFileSync(new URL("../data/combos/snake-eye-ash-1card.json", import.meta.url), "utf8")));
const bare = Combo.parse({ ...snakeEye, steps: snakeEye.steps.map((s) => ({ ...s, interruptions: [] })) });

const ASH = 9674034;
const POPLAR = 90241276;
const PROMETHEAN = 2772337;
const FLAMBERGE = 48452496;
const ASH_BLOSSOM = 14558127;
const FILL = 1;
const opts = { isHandtrap: (id: number) => id === ASH_BLOSSOM, wildcardOk: () => false };

/** 40 张：3 Ash、3 Poplar、3 Ash Blossom、31 张其他。 */
function study(): DeckStudy {
  let s = newStudy("t", [...Array(3).fill(ASH), ...Array(3).fill(POPLAR), ...Array(3).fill(ASH_BLOSSOM), ...Array(31).fill(FILL)], [], "tcg", new Date(0));
  s = addStarter(s, [ASH], new Date(1));
  s = addStarter(s, [POPLAR], new Date(2));
  return { ...s, keyCards: [PROMETHEAN, FLAMBERGE], bricks: [FILL] };
}

/** 超几何：5 张里至少 1 张（3 张的卡）。 */
const atLeastOne = (copies: number, deck = 40, size = 5) => {
  let none = 1;
  for (let i = 0; i < size; i++) none *= (deck - copies - i) / (deck - i);
  return 1 - none;
};

describe("simulateHands", () => {
  it("上手率接近理论值", () => {
    const s = study();
    const h = simulateHands(s, compareStudy(s), { ...opts, size: 5 });
    expect(h.handtrap1).toBeCloseTo(atLeastOne(3), 1);
    expect(h.anyStarter).toBeCloseTo(atLeastOne(6), 1);
    expect(h.perStarter[s.starters[0].id]).toBeCloseTo(atLeastOne(3), 1);
    expect(h.brick1).toBeCloseTo(atLeastOne(31), 1);
    // 后攻多抽一张，上手率更高
    expect(simulateHands(s, compareStudy(s), { ...opts, size: 6 }).anyStarter).toBeGreaterThan(h.anyStarter);
  });

  it("两个不同动点都在手里才算补点上手", () => {
    const s = study();
    const h = simulateHands(s, compareStudy(s), { ...opts, size: 5 });
    expect(h.multiStarter).toBeGreaterThan(0);
    expect(h.multiStarter).toBeLessThan(h.anyStarter);
    expect(h.multiStarter).toBeCloseTo(atLeastOne(3) ** 2, 1);
  });

  it("有补点时，只打其中一条路线的手坑分数会变低；两条路线都有的动作是绕不开的", () => {
    let s = study();
    s = saveRoute(s, s.starters[0].id, bare);
    // Poplar 的路线：从 Poplar 的步骤开始，Ash 的通召和检索不在里面
    const poplar = Combo.parse({ ...bare, id: "p", starter: [{ id: POPLAR, name: "Snake-Eyes Poplar" }], steps: bare.steps.slice(2) });
    s = saveRoute(s, s.starters[1].id, poplar);
    const cmp = compareStudy(s);
    const h = simulateHands(s, cmp, { ...opts, size: 5 });
    const ash = cmp.handtraps.find((x) => x.handtrap === HT.ASH)!;
    // 单看路线：两条路线都被打光
    expect(ash.score).toBe(1);
    expect(h.weighted[HT.ASH]).toBeGreaterThan(0.9);
    // 共同动作：Poplar 的检索两条路线都有，Ash 的通常召唤只有一条
    const shared = cmp.axis.find((a) => a.label.startsWith("Snake-Eyes Poplar") && a.label.includes("从卡组加入手卡"))!;
    expect(shared.routes).toHaveLength(2);
    expect(cmp.axis.some((a) => a.label === "通常召唤 Snake-Eye Ash")).toBe(false);
    expect(h.unavoidable[shared.sig]).toBe(1);
  });
});

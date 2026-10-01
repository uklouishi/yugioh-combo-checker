import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HT } from "../model/interruptions";
import { Combo } from "../model/schema";
import { compareStudy } from "./compare";
import { simulateHands } from "./hands";
import { addStarter, newStudy, saveRoute, sidedMain, sideProblem, type DeckStudy } from "./model";

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
    // 概率：完全断 + 缩减 + 没影响 = 有已打路线的起手
    const o = h.outcomes[HT.ASH];
    expect(o.stop + o.cut + o.none).toBeCloseTo(h.played, 2);
    // Ash Blossom 打两条路线都要用的检索：补点也被打掉，几乎都是完全断
    expect(o.stop).toBeGreaterThan(0.9 * h.played);
  });

  it("补点能躲开只在一条路线里的动作", () => {
    let s = study();
    s = saveRoute(s, s.starters[0].id, bare);
    const poplar = Combo.parse({ ...bare, id: "p", starter: [{ id: POPLAR, name: "Snake-Eyes Poplar" }], steps: bare.steps.slice(2) });
    s = saveRoute(s, s.starters[1].id, poplar);
    const cmp = compareStudy(s);
    // 假手坑：只能打 Ash 的通常召唤，打了 Ash 路线全没
    const ashOnly = { ...cmp.handtraps[0], handtrap: -1, options: { [s.starters[0].id]: [{ sig: "sum:9674034:normal", keyLost: 99 }] } };
    const h = simulateHands(s, { ...cmp, handtraps: [ashOnly] }, { ...opts, size: 5 });
    const o = h.outcomes[-1];
    // 手里只有 Ash 时被断；有 Poplar 时用 Poplar 补上，不受影响
    expect(o.stop).toBeGreaterThan(0);
    expect(o.none).toBeGreaterThan(0);
    expect(o.none).toBeCloseTo(h.perStarter[s.starters[1].id], 1);
  });
});

describe("解牌和换 side", () => {
  const SUPER_POLY = 48130397;
  const LAVA = 102380;

  it("解牌上手率和「手坑或解牌」", () => {
    const s = study();
    const h = simulateHands(s, compareStudy(s), { ...opts, size: 6, isBreaker: (id) => id === POPLAR });
    expect(h.breaker1).toBeCloseTo(atLeastOne(3, 40, 6), 1);
    expect(h.interaction).toBeCloseTo(atLeastOne(6, 40, 6), 1);
    expect(h.interaction).toBeGreaterThanOrEqual(h.handtrap1);
  });

  it("换 side：换出 3 张其他卡、换入解牌后，解牌上手率上升，动点上手率不变", () => {
    const s = { ...study(), side: [SUPER_POLY, SUPER_POLY, LAVA], breakers: [SUPER_POLY, LAVA] };
    const plan = { out: [FILL, FILL, FILL], in: [SUPER_POLY, SUPER_POLY, LAVA] };
    expect(sideProblem(s, plan)).toBeNull();
    const main = sidedMain(s.main, plan);
    expect(main).toHaveLength(40);
    expect(main.filter((c) => c === FILL)).toHaveLength(28);
    const isBreaker = (id: number) => s.breakers.includes(id);
    const cmp = compareStudy(s);
    const before = simulateHands(s, cmp, { ...opts, size: 6, isBreaker });
    const after = simulateHands(s, cmp, { ...opts, size: 6, isBreaker, main });
    expect(before.breaker1).toBe(0);
    expect(after.breaker1).toBeCloseTo(atLeastOne(3, 40, 6), 1);
    expect(after.anyStarter).toBeCloseTo(before.anyStarter, 1);
  });

  it("换 side 的检查", () => {
    const s = { ...study(), side: [SUPER_POLY] };
    expect(sideProblem(s, { out: [], in: [SUPER_POLY, SUPER_POLY] })).toMatch("side");
    expect(sideProblem(s, { out: [ASH, ASH, ASH, ASH], in: [] })).toMatch("主卡组");
    expect(sideProblem(s, { out: [ASH], in: [] })).toMatch("40");
    expect(sideProblem(s, { out: [ASH], in: [SUPER_POLY] })).toBeNull();
  });
});

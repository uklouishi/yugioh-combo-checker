import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HT } from "./interruptions";
import { handtrapPriorities, impactFromScore } from "./priority";
import { Combo } from "./schema";
import { applyEdits } from "../ui/PriorityPanel";

const snakeEye = Combo.parse(JSON.parse(readFileSync(new URL("../data/combos/snake-eye-ash-1card.json", import.meta.url), "utf8")));
/** 去掉作者写的影响，只看算法。 */
const bare = Combo.parse({ ...snakeEye, steps: snakeEye.steps.map((s) => ({ ...s, interruptions: [] })) });

describe("handtrapPriorities", () => {
  it("第 2 步检索被 Ash Blossom 无效时，后面几乎全部做不了，排在最前、判为直接断", () => {
    const [top] = handtrapPriorities(bare);
    expect(top.handtrap).toBe(HT.ASH);
    expect(top.step).toBe(2);
    expect(top.impact).toBe("combo_ends");
    expect(top.endLost).toBe(top.endTotal);
  });

  it('Maxx "C" 按之后的特召次数估计对手抽卡数', () => {
    const maxx = handtrapPriorities(bare).find((p) => p.handtrap === HT.MAXX_C)!;
    expect(maxx.draws).toBeGreaterThanOrEqual(5);
    expect(maxx.lostSteps).toBe(0);
  });

  it("分数从高到低排序", () => {
    const scores = handtrapPriorities(bare).map((p) => p.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("作者写了影响时以作者为准", () => {
    const nib = handtrapPriorities(snakeEye).find((p) => p.handtrap === HT.NIBIRU)!;
    expect(nib.authored).toBe(true);
    expect(nib.impact).toBe("minor");
  });

  it("分数到影响的换算", () => {
    expect(impactFromScore(0.8)).toBe("combo_ends");
    expect(impactFromScore(0.4)).toBe("reduced_endboard");
    expect(impactFromScore(0.1)).toBe("minor");
  });
});

describe("applyEdits", () => {
  it("按手动顺序排列，新出现的手坑接在后面，改过的影响生效", () => {
    const auto = handtrapPriorities(bare);
    const [a, b, ...rest] = auto.map((p) => p.handtrap);
    const out = applyEdits(auto, { order: [b, a], impact: { [a]: "minor" } });
    expect(out.map((p) => p.handtrap)).toEqual([b, a, ...rest]);
    expect(out[1].impact).toBe("minor");
  });
});

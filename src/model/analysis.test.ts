import { describe, expect, it } from "vitest";
import { combos } from "../data";
import { analyzeCombo } from "./analysis";
import { HT } from "./interruptions";

const snakeEye = combos.find((c) => c.id === "snake-eye-ash-1card")!;

describe("analyzeCombo", () => {
  const a = analyzeCombo(snakeEye);

  it("统计召唤次数", () => {
    expect(a.normalSummons).toBe(1);
    expect(a.specialSummons).toBe(6);
  });

  it("最严重的手坑排在最前：Ash Blossom 在第 2 步直接断", () => {
    expect(a.handtraps[0].handtrap).toBe(HT.ASH);
    expect(a.handtraps[0].worst.impact).toBe("combo_ends");
    expect(a.handtraps[0].worst.stepId).toBe("s2");
    expect(a.firstComboEnd).toBe(2);
  });

  it("记录每张手坑能打的全部步骤", () => {
    const ash = a.handtraps.find((h) => h.handtrap === HT.ASH)!;
    expect(ash.steps).toEqual([2, 4, 5, 10]);
    expect(ash.firstStep).toBe(2);
  });

  it("没有手坑能打的步骤为 null", () => {
    // 第 1 步通常召唤 Snake-Eye Ash 会被 Mulcharmy Purulia 标上，去掉这一步的动作再看
    const b = analyzeCombo({ ...snakeEye, steps: snakeEye.steps.map((s, i) => (i === 0 ? { ...s, actions: [] } : s)) });
    expect(b.stepWorst[0]).toBeNull();
    expect(a.stepWorst[0]?.handtrap).toBe(HT.PURULIA);
  });
});

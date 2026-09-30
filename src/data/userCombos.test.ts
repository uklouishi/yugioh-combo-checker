import { describe, expect, it } from "vitest";
import { combos } from ".";
import { parseCombos } from "./userCombos";

describe("parseCombos", () => {
  it("接受合法的 combo（单条或数组）", () => {
    const one = { ...combos[0], id: "copy" };
    const r = parseCombos(JSON.stringify(one), combos);
    expect(r.ok).toBe(true);
    expect(parseCombos(JSON.stringify([one]), combos).ok).toBe(true);
  });

  it("JSON 语法错误和缺字段给出中文提示", () => {
    const bad = parseCombos("{", combos);
    expect(!bad.ok && bad.errors[0]).toMatch(/不是合法的 JSON/);
    const missing = parseCombos(JSON.stringify({ id: "x" }), combos);
    expect(!missing.ok && missing.errors.join("\n")).toMatch(/字段 deck/);
  });

  it("卡片移动对不上时报错", () => {
    const broken = structuredClone({ ...combos[0], id: "broken" });
    broken.steps[0].moves[0].from = "gy";
    const r = parseCombos(JSON.stringify(broken), combos);
    expect(!r.ok && r.errors.join("\n")).toMatch(/墓地里没有 Snake-Eye Ash/);
  });
});

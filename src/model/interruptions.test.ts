import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import handtrapsJson from "../data/handtraps.json";
import { deriveInterruptions, HT } from "./interruptions";
import { Combo, Handtrap } from "./schema";
import { checkCombos } from "./validate";

const dir = new URL("../data/combos/", import.meta.url);
const combos = readdirSync(dir).map((f) => Combo.parse(JSON.parse(readFileSync(new URL(f, dir), "utf8"))));
const handtraps = Handtrap.array().parse(handtrapsJson);
const snakeEye = combos.find((c) => c.id === "snake-eye-ash-1card")!;

const at = (stepId: string) => deriveInterruptions(snakeEye).filter((i) => i.stepId === stepId);
const ids = (stepId: string) => at(stepId).map((i) => i.handtrap);

describe("combo 数据", () => {
  it("全部通过一致性检查", () => {
    expect(checkCombos(combos, handtraps)).toEqual([]);
  });
});

describe("deriveInterruptions", () => {
  it("检索效果吃 Ash Blossom、Droll & Lock Bird，场上怪兽效果吃 Infinite Impermanence / Effect Veiler / Ghost Ogre", () => {
    expect(ids("s2")).toEqual(
      expect.arrayContaining([HT.ASH, HT.DROLL, HT.IMPERM, HT.VEILER, HT.GHOST_OGRE]),
    );
    expect(at("s2").find((i) => i.handtrap === HT.ASH)?.impact).toBe("combo_ends");
  });

  it('Maxx "C" 标在第一次特召', () => {
    expect(deriveInterruptions(snakeEye).find((i) => i.handtrap === HT.MAXX_C)?.stepId).toBe("s3");
  });

  it("Nibiru标在第 5 次召唤", () => {
    const nib = deriveInterruptions(snakeEye).filter((i) => i.handtrap === HT.NIBIRU);
    expect(nib.map((i) => i.stepId)).toEqual(["s7"]);
  });

  it("手卡发动的魔法只吃 Ash Blossom，不吃 Ghost Ogre", () => {
    expect(ids("s5")).toContain(HT.ASH);
    expect(ids("s5")).not.toContain(HT.GHOST_OGRE);
  });

  it("墓地苏生吃 Ghost Belle，以墓地为对象吃 D.D. Crow", () => {
    expect(ids("s6")).toEqual(expect.arrayContaining([HT.GHOST_BELLE, HT.DD_CROW]));
  });

  it("作者标注 applies=false 会移除自动结果（cost 送墓后 Infinite Impermanence 没有对象）", () => {
    expect(ids("s10")).toContain(HT.ASH);
    expect(ids("s10")).not.toContain(HT.IMPERM);
    expect(ids("s10")).not.toContain(HT.VEILER);
  });
});

describe("simulate", () => {
  it("按 moves 算出终场：Promethean Princess 在额外怪兽区，Flamberge 在怪兽区", async () => {
    const { simulate } = await import("./board");
    const last = simulate(snakeEye).at(-1)!.board;
    expect(last.emz[0]?.card.id).toBe(2772337);
    expect(last.monster.filter(Boolean).map((p) => p!.card.id)).toEqual([48452496]);
    expect(last.spell_trap.every((p) => p === null)).toBe(true);
    expect(last.deckCount).toBe(35 - 4);
  });

  it("移动不存在的卡会报错", async () => {
    const { simulate } = await import("./board");
    const broken = structuredClone(snakeEye);
    broken.steps[0].moves[0].from = "gy";
    expect(() => simulate(broken)).toThrow(/墓地里没有 Snake-Eye Ash/);
  });
});

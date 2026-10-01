import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Combo } from "../model/schema";
import { compareStudy } from "./compare";
import { cycleKey, endZones, keyCardsMet, keyTarget, setKeyZone, weighted } from "./endboard";
import { addStarter, newStudy, saveRoute, type DeckStudy } from "./model";

const snakeEye = Combo.parse(JSON.parse(readFileSync(new URL("../data/combos/snake-eye-ash-1card.json", import.meta.url), "utf8")));

const ASH = 9674034;
const PROMETHEAN = 2772337;
const FLAMBERGE = 48452496;
const NOW = new Date("2026-10-01T00:00:00Z");

function study(): DeckStudy {
  let s = newStudy("Snake-Eye", [ASH, ...Array(39).fill(FLAMBERGE)], [PROMETHEAN], "tcg", NOW);
  s = addStarter(s, [ASH], NOW);
  return saveRoute(s, s.starters[0].id, snakeEye);
}

describe("cycleKey", () => {
  it("重复点：优先 → 高优先 → 最高优先 → 取消，区域保留", () => {
    let s = cycleKey(study(), PROMETHEAN);
    expect(s.keyCards).toEqual([PROMETHEAN]);
    expect(keyTarget(s, PROMETHEAN)).toEqual({ zone: "field", priority: 1 });
    s = setKeyZone(cycleKey(s, PROMETHEAN), PROMETHEAN, "gy");
    expect(keyTarget(s, PROMETHEAN)).toEqual({ zone: "gy", priority: 2 });
    s = cycleKey(s, PROMETHEAN);
    expect(keyTarget(s, PROMETHEAN).priority).toBe(3);
    s = cycleKey(s, PROMETHEAN);
    expect(s.keyCards).toEqual([]);
    expect(s.keyTargets).toEqual({});
  });
});

describe("终场条件", () => {
  it("新路线按记下的墓地、除外、素材算", () => {
    const ref = (id: number) => ({ id, name: String(id) });
    const c = Combo.parse({ ...snakeEye, endboard: { ...snakeEye.endboard, grave: [ref(ASH)], banished: [], materials: [ref(FLAMBERGE)] } });
    expect(endZones(c)).toMatchObject({ gy: [ASH], banished: [], material: [FLAMBERGE] });
    let s = { ...study(), keyCards: [ASH, FLAMBERGE] };
    s = setKeyZone(setKeyZone(s, ASH, "gy"), FLAMBERGE, "material");
    expect(keyCardsMet(s, c)).toEqual([ASH, FLAMBERGE]);
    expect(keyCardsMet(setKeyZone(s, ASH, "banished"), c)).toEqual([FLAMBERGE]);
  });

  it("旧路线没记墓地时按步骤推算", () => {
    const zones = endZones(snakeEye);
    expect(zones.field).toEqual(snakeEye.endboard.cards.map((c) => c.id));
    expect(zones.gy.length).toBeGreaterThan(0);
  });

  it("要在场上的卡进了墓地不算达成", () => {
    const s = { ...study(), keyCards: [PROMETHEAN] };
    const field = keyCardsMet(s, snakeEye).length;
    const inGy = endZones(snakeEye).gy.filter((c) => c === PROMETHEAN).length;
    expect(keyCardsMet(setKeyZone(s, PROMETHEAN, "gy"), snakeEye)).toHaveLength(inGy);
    expect(field).toBe(snakeEye.endboard.cards.filter((c) => c.id === PROMETHEAN).length);
  });

  it("优先级加权：最高优先算 3 张", () => {
    let s = cycleKey(cycleKey(cycleKey({ ...study(), keyCards: [FLAMBERGE] }, PROMETHEAN), PROMETHEAN), PROMETHEAN);
    expect(weighted(s, [PROMETHEAN, FLAMBERGE])).toEqual([PROMETHEAN, PROMETHEAN, PROMETHEAN, FLAMBERGE]);
    s = { ...s, keyCards: [PROMETHEAN] };
    const r = compareStudy(s).routes[0];
    expect(r.keyShown.length * 3).toBe(r.keyEnd.length);
  });
});

describe("电脑生成的路线", () => {
  it("玩家自己保存后不再算电脑生成，删动点时一起删", () => {
    const s0 = study();
    const id = s0.starters[0].id;
    const auto = saveRoute(s0, id, snakeEye, "{}", { openAt: 10, missing: [PROMETHEAN], skipped: [], timedOut: false });
    expect(auto.auto[id]?.missing).toEqual([PROMETHEAN]);
    expect(saveRoute(auto, id, snakeEye, "{}").auto[id]).toBeUndefined();
  });
});

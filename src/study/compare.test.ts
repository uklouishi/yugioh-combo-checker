import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HT } from "../model/interruptions";
import { Combo } from "../model/schema";
import { compareStudy } from "./compare";
import { addStarter, newStudy, saveRoute, starterProblem, type DeckStudy } from "./model";

const snakeEye = Combo.parse(JSON.parse(readFileSync(new URL("../data/combos/snake-eye-ash-1card.json", import.meta.url), "utf8")));
const bare = Combo.parse({ ...snakeEye, steps: snakeEye.steps.map((s) => ({ ...s, interruptions: [] })) });

const ASH = 9674034;
const POPLAR = 90241276;
const OAK = 45663742;
const PROMETHEAN = 2772337;
const FLAMBERGE = 48452496;
const NOW = new Date("2026-10-01T00:00:00Z");

function study(): DeckStudy {
  let s = newStudy("Snake-Eye", [ASH, ASH, POPLAR, OAK, ...Array(36).fill(FLAMBERGE)], [PROMETHEAN], "tcg", NOW);
  s = addStarter(s, [ASH], NOW);
  s = addStarter(s, [POPLAR], new Date(NOW.getTime() + 1));
  return s;
}

describe("starterProblem", () => {
  it("两张都占通召时不能组合", () => {
    const s = { ...study(), normalSummon: { [ASH]: true, [POPLAR]: true } };
    expect(starterProblem(s, [ASH, POPLAR])).toMatch(/通常召唤/);
    expect(starterProblem({ ...s, normalSummon: { [ASH]: true } }, [ASH, POPLAR])).toBeNull();
  });

  it("卡组里张数不够时不能组合", () => {
    expect(starterProblem(study(), [OAK, OAK])).toMatch(/没有 2 张/);
    expect(starterProblem(study(), [ASH, ASH])).toBeNull();
  });
});

describe("saveRoute", () => {
  it("单卡动按路线里有没有通常召唤更新通召标记", () => {
    const s = study();
    const out = saveRoute(s, s.starters[0].id, bare);
    expect(out.normalSummon[String(ASH)]).toBe(true);
    expect(out.routes[s.starters[0].id]).toBe(bare);
  });
});

describe("compareStudy", () => {
  it("按打掉多少重要终端给手坑排序，第 2 步检索被 Ash Blossom 无效时两张重要终端都出不来", () => {
    let s = study();
    s = saveRoute(s, s.starters[0].id, bare);
    s = { ...s, keyCards: [PROMETHEAN, FLAMBERGE] };
    const cmp = compareStudy(s);
    expect(cmp.routes).toHaveLength(1);
    expect(cmp.routes[0].keyEnd).toEqual([PROMETHEAN, FLAMBERGE]);
    const [top] = cmp.handtraps;
    expect(top.score).toBe(1);
    expect(top.hits[0].keyLost).toEqual([PROMETHEAN, FLAMBERGE]);
    const ash = cmp.handtraps.find((h) => h.handtrap === HT.ASH)!;
    expect(ash.score).toBe(1);
    expect(cmp.handtraps.map((h) => h.score)).toEqual([...cmp.handtraps.map((h) => h.score)].sort((a, b) => b - a));
    expect(cmp.drawers.find((d) => d.handtrap === HT.MAXX_C)?.draws).toBeGreaterThanOrEqual(5);
  });

  it("只选一张重要终端时只数那一张；打不出它的路线不计分", () => {
    let s = study();
    s = saveRoute(s, s.starters[0].id, bare);
    // 第二条路线：只打到 Promethean Princess 就结束
    const short = Combo.parse({ ...bare, steps: bare.steps.slice(0, 7), endboard: { cards: [{ id: PROMETHEAN, name: "Promethean Princess, Bestower of Flames" }], description: "" } });
    s = saveRoute(s, s.starters[1].id, short);
    s = { ...s, keyCards: [FLAMBERGE] };
    const cmp = compareStudy(s);
    expect(cmp.scored).toBe(1);
    expect(cmp.routes[1].keyEnd).toEqual([]);
    const ash = cmp.handtraps.find((h) => h.handtrap === HT.ASH)!;
    expect(ash.routesHit).toBe(2);
    expect(ash.routesHurt).toBe(1);
    expect(ash.score).toBe(1);
  });

  it("关键效果：检索 Poplar 的 Snake-Eye Ash 被无效会让全部重要终端出不来", () => {
    let s = study();
    s = saveRoute(s, s.starters[0].id, bare);
    s = { ...s, keyCards: [PROMETHEAN, FLAMBERGE] };
    const [top] = compareStudy(s).keyEffects;
    expect(top.score).toBe(1);
    expect(top.worst.keyLost).toHaveLength(2);
  });

  it("没选重要终端时整个终场都算", () => {
    let s = study();
    s = saveRoute(s, s.starters[0].id, bare);
    const cmp = compareStudy(s);
    expect(cmp.fallback).toBe(true);
    expect(cmp.routes[0].keyEnd).toHaveLength(2);
  });
});

import { readFile } from "node:fs/promises";
import createCore from "ocgcore-wasm";
import { beforeAll, describe, expect, it } from "vitest";
import { EngineData } from "../engine/data";
import { startDuel } from "../engine/run";
import { addStarter, newStudy, starterHand } from "./model";
import { blankFor, deckArchetypes, deckMatches, filterLabel, practiceMain, starterLabel } from "./wildcard";

// 需要先运行 npm run sync-engine 生成 public/engine/
const fetcher = (path: string) => readFile(`public/engine/${path}`, "utf8").catch(() => null);

const REGULUS = 96228804; // Regulus, the Prince of Endymion（4 星光属性魔法师族）
const VEILER = 97268402; // Effect Veiler（1 星光属性魔法师族）
const ASH_BLOSSOM = 14558127; // 炎族
const DARK_MAGICIAN = 46986414;
const SPELLCASTER = 0x2;
const DMG = 38033120; // Dark Magician Girl（字段 0x30a2，属于 Dark Magician 0x10a2）
const SE_ASH = 9674034; // Snake-Eye Ash
const SPOILS = 89023486; // Original Sinful Spoils - Snake-Eye（魔法，字段 Snake-Eye）
const DARK_MAGICIAN_SET = 0x10a2;
const SNAKE_EYE_SET = 0x205;

let data: EngineData;
beforeAll(async () => {
  data = await EngineData.load(fetcher);
});

const study = () => newStudy("Endymion", [REGULUS, REGULUS, VEILER, ...Array(37).fill(ASH_BLOSSOM)], [], "tcg", new Date("2026-10-01T00:00:00Z"));

describe("通配卡", () => {
  it("名字按条件拼出来", () => {
    expect(filterLabel({ race: SPELLCASTER })).toBe("任意魔法师族怪兽");
    expect(filterLabel({ race: SPELLCASTER, attribute: 0x20, maxLevel: 4 })).toBe("任意 4 星以下的暗属性魔法师族怪兽");
    expect(filterLabel({})).toBe("任意怪兽");
  });

  it("列出卡组里符合条件的卡，可以排除这一手已经指定的卡", () => {
    expect(deckMatches(data, study(), { race: SPELLCASTER })).toEqual([REGULUS, VEILER]);
    expect(deckMatches(data, study(), { race: SPELLCASTER }, [REGULUS])).toEqual([VEILER]);
    expect(deckMatches(data, study(), { race: SPELLCASTER, maxLevel: 2 })).toEqual([VEILER]);
  });

  it("魔法师族的白板代表卡是 Dark Magician；等级不够时换别的通常怪兽", () => {
    expect(blankFor(data, { race: SPELLCASTER })).toBe(DARK_MAGICIAN);
    const low = blankFor(data, { race: SPELLCASTER, maxLevel: 4 })!;
    expect(low).not.toBe(DARK_MAGICIAN);
    const c = data.cards.get(low)!;
    expect(c.data.level).toBeLessThanOrEqual(4);
    expect(c.data.race & 2n).toBe(2n);
  });

  it("同一张卡加不同条件算不同动点，同样的条件不重复加", () => {
    const wildcard = { filter: { race: SPELLCASTER }, representative: DARK_MAGICIAN };
    let s = addStarter(study(), [REGULUS], new Date(1), wildcard);
    s = addStarter(s, [REGULUS], new Date(2), { ...wildcard });
    s = addStarter(s, [REGULUS], new Date(3));
    expect(s.starters).toHaveLength(2);
    expect(starterLabel(data, s.starters[0])).toBe("Regulus, the Prince of Endymion + 任意魔法师族怪兽");
    expect(starterHand(s.starters[0])).toEqual([REGULUS, DARK_MAGICIAN]);
  });

  it("练习时白板放进主卡组，起手就是 Regulus + Dark Magician", async () => {
    const s = addStarter(study(), [REGULUS], new Date(1), { filter: { race: SPELLCASTER }, representative: DARK_MAGICIAN });
    const starter = s.starters[0];
    const main = practiceMain(s, starter);
    expect(main).toHaveLength(41);
    const core = await createCore({ sync: true });
    const duel = await startDuel(core, data, { main, extra: [], hand: starterHand(starter), opponentHand: [], format: "tcg", seed: 1 });
    const [me] = duel.field();
    expect(me.hand.map((c) => c.code).sort()).toEqual([REGULUS, DARK_MAGICIAN].sort());
  });

  it("自动列出卡组里的字段，子字段也算进母字段", () => {
    const main = [DARK_MAGICIAN, DMG, DMG, SE_ASH, SPOILS, ...Array(35).fill(ASH_BLOSSOM)];
    const sets = deckArchetypes(data, main);
    expect(sets.find((a) => a.setcode === DARK_MAGICIAN_SET)).toMatchObject({ name: "Dark Magician", cards: 3 });
    expect(sets.find((a) => a.setcode === SNAKE_EYE_SET)).toMatchObject({ name: "Snake-Eye", cards: 2 });
  });

  it("按字段筛选：只选字段时魔法也算，加了种族就只要怪兽", () => {
    const s = newStudy("x", [DARK_MAGICIAN, DMG, SE_ASH, SPOILS, ...Array(36).fill(ASH_BLOSSOM)], [], "tcg");
    expect(deckMatches(data, s, { setcode: DARK_MAGICIAN_SET })).toEqual([DARK_MAGICIAN, DMG]);
    expect(deckMatches(data, s, { setcode: SNAKE_EYE_SET })).toEqual([SE_ASH, SPOILS]);
    expect(deckMatches(data, s, { setcode: SNAKE_EYE_SET, race: 0x80 })).toEqual([SE_ASH]);
    expect(filterLabel({ setcode: SNAKE_EYE_SET, setname: "Snake-Eye" })).toBe("任意「Snake-Eye」卡");
    expect(filterLabel({ setcode: DARK_MAGICIAN_SET, setname: "Dark Magician", race: SPELLCASTER })).toBe("任意「Dark Magician」魔法师族怪兽");
  });

  it("字段里有通常怪兽时用它当白板，没有时找不到白板", () => {
    expect(blankFor(data, { setcode: DARK_MAGICIAN_SET })).toBe(DARK_MAGICIAN);
    expect(blankFor(data, { setcode: SNAKE_EYE_SET })).toBeNull();
  });
});

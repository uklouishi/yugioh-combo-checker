import { readFile } from "node:fs/promises";
import createCore from "ocgcore-wasm";
import { beforeAll, describe, expect, it } from "vitest";
import { EngineData } from "../engine/data";
import { startDuel } from "../engine/run";
import { addStarter, newStudy, starterHand } from "./model";
import { blankFor, deckMatches, filterLabel, practiceMain, starterLabel } from "./wildcard";

// 需要先运行 npm run sync-engine 生成 public/engine/
const fetcher = (path: string) => readFile(`public/engine/${path}`, "utf8").catch(() => null);

const REGULUS = 96228804; // Regulus, the Prince of Endymion（4 星光属性魔法师族）
const VEILER = 97268402; // Effect Veiler（1 星光属性魔法师族）
const ASH_BLOSSOM = 14558127; // 炎族
const DARK_MAGICIAN = 46986414;
const SPELLCASTER = 0x2;

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
});

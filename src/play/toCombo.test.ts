import { readFile } from "node:fs/promises";
import createCore, { OcgMessageType, OcgResponseType, type OcgCoreSync } from "ocgcore-wasm";
import { beforeAll, describe, expect, it } from "vitest";
import { handtraps } from "../data";
import { EngineData } from "../engine/data";
import { startDuel } from "../engine/run";
import type { DuelSession, DuelSetup } from "../engine/session";
import { buildBeats } from "../model/playback";
import { simulate, simulatePartial } from "../model/board";
import { checkCombos } from "../model/validate";
import { canExport, toCombo } from "./toCombo";

// 需要先运行 npm run sync-engine 生成 public/engine/
const fetcher = (path: string) => readFile(`public/engine/${path}`, "utf8").catch(() => null);

const ASH = 9674034; // Snake-Eye Ash
const POPLAR = 90241276; // Snake-Eyes Poplar
const OAK = 45663742; // Snake-Eye Oak
const LINKURIBOH = 41999284;
const ASH_BLOSSOM = 14558127;

let core: OcgCoreSync;
let data: EngineData;
beforeAll(async () => {
  core = await createCore({ sync: true });
  data = await EngineData.load(fetcher);
});

/** 自己的提示一律按「第一个选项 / 不连锁」回答，直到回到空闲。 */
function settle(s: DuelSession, zone = 2) {
  for (let n = 0; s.status === "prompt" && s.prompt!.msg.type !== OcgMessageType.SELECT_IDLECMD; n++) {
    if (n > 30) throw new Error(`stuck on prompt ${s.prompt!.msg.type}`);
    const p = s.prompt!.msg;
    if (p.type === OcgMessageType.SELECT_CHAIN) s.respond({ type: OcgResponseType.SELECT_CHAIN, index: null });
    else if (p.type === OcgMessageType.SELECT_EFFECTYN) s.respond({ type: OcgResponseType.SELECT_EFFECTYN, yes: true });
    else if (p.type === OcgMessageType.SELECT_CARD) s.respond({ type: OcgResponseType.SELECT_CARD, indicies: [p.selects.findIndex((c) => c.code === POPLAR) >= 0 ? p.selects.findIndex((c) => c.code === POPLAR) : 0] });
    else if (p.type === OcgMessageType.SELECT_PLACE) s.respond({ type: OcgResponseType.SELECT_PLACE, places: [{ player: 0, location: 4, sequence: zone }] });
    else if (p.type === OcgMessageType.SELECT_POSITION) s.respond({ type: OcgResponseType.SELECT_POSITION, position: 1 });
    else if (p.type === OcgMessageType.SELECT_UNSELECT_CARD) s.respond({ type: OcgResponseType.SELECT_UNSELECT_CARD, index: p.select_cards.length ? 0 : null });
    else throw new Error(`unexpected prompt ${p.type}`);
  }
}

function idle(s: DuelSession) {
  const m = s.prompt?.msg;
  if (m?.type !== OcgMessageType.SELECT_IDLECMD) throw new Error(`expected idle, got ${m?.type} (${s.status}: ${s.errors.join("; ")})`);
  return m;
}

describe("toCombo", () => {
  it("exports a played turn as a combo the viewer can replay", async () => {
    const setup: DuelSetup = {
      main: [ASH, POPLAR, ...Array(38).fill(OAK)],
      extra: [LINKURIBOH],
      hand: [ASH],
      opponentHand: [ASH_BLOSSOM],
      format: "tcg",
      seed: 7,
    };
    const s = await startDuel(core, data, setup);
    expect(canExport(s)).toBe(false);
    // 通常召唤 Ash → 检索 Poplar
    let m = idle(s);
    s.respond({ type: OcgResponseType.SELECT_IDLECMD, action: 0, index: m.summons.findIndex((c) => c.code === ASH) });
    settle(s);
    // 用 Ash 连接召唤 Linkuriboh（放额外怪兽区）
    m = idle(s);
    s.respond({ type: OcgResponseType.SELECT_IDLECMD, action: 1, index: m.special_summons.findIndex((c) => c.code === LINKURIBOH) });
    settle(s, 5);
    m = idle(s);
    s.respond({ type: OcgResponseType.SELECT_IDLECMD, action: 7, index: null });
    expect(s.status).toBe("turn_over");
    expect(canExport(s)).toBe(true);

    const combo = toCombo(s, { now: new Date("2026-09-30T00:00:00Z") });
    expect(combo.starter.map((c) => c.id)).toEqual([ASH]);
    expect(combo.format).toBe("TCG");
    expect(combo.steps.map((st) => st.title)).toEqual(["通常召唤 Snake-Eye Ash", "特殊召唤 Linkuriboh"]);
    const ash = combo.steps[0].actions.find((a) => a.type === "activate");
    expect(ash?.type === "activate" && ash.activation.effects).toContain("add_from_deck");
    expect(ash?.type === "activate" && ash.activation.from).toBe("monster");
    const link = combo.steps[1].actions[0];
    expect(link.type === "summon" && link.summon.method).toBe("link");
    expect(link.type === "summon" && link.summon.from).toBe("extra");
    expect(combo.requires.extra.map((c) => c.id)).toEqual([LINKURIBOH]);
    expect(combo.steps[0].interruptions.map((n) => n.handtrap)).toContain(ASH_BLOSSOM);
    expect(combo.endboard.cards.map((c) => c.id)).toEqual([LINKURIBOH]);

    // 场地模拟能从头放到尾，终场和引擎一致
    const frames = simulate(combo);
    const last = frames.at(-1)!.board;
    expect(last.emz.some((p) => p?.card.id === LINKURIBOH)).toBe(true);
    expect(last.gy.map((p) => p.card.id)).toContain(ASH);
    expect(last.hand.map((p) => p.card.id)).toContain(POPLAR);
    expect(checkCombos([combo], handtraps)).toEqual([]);

    // 播放：召唤 → CHAIN 1 发动 Ash → 处理时检索 Poplar
    const beats = buildBeats(combo.steps[0], frames[0].board);
    expect(beats.at(-1)!.board).toEqual(frames[1].board);
    expect(beats.map((b) => b.kind)).toEqual(["summon", "move", "activate", "resolve", "move"]);
    expect(beats.find((b) => b.kind === "activate")?.caption).toContain("CHAIN 1");
    expect(beats.find((b) => b.move?.card.id === POPLAR)?.move?.resolving).toBe(1);
  });

  it("records Xyz materials as going to the GY, not to the Extra Deck", () => {
    // ocgcore-wasm 把超量素材的位置写成「超量怪兽所在区域 + overlay_sequence」（OVERLAY 位被去掉）
    const WICCAT = 27632520;
    const MZONE = 4;
    const EXTRA = 64;
    const GRAVE = 16;
    const HAND = 2;
    const at = (location: number, sequence: number, extra: object = {}) => ({ controller: 0 as const, location, sequence, position: 1, ...extra });
    const session = {
      data,
      setup: { main: Array(40).fill(OAK), extra: [WICCAT], hand: [ASH, POPLAR], opponentHand: [], format: "tcg", seed: 1 },
      actions: [
        { label: "通常召唤 Snake-Eye Ash", at: 0 },
        { label: "特殊召唤 Snake-Eyes Poplar", at: 1 },
        { label: "特殊召唤 Fairy Tail - Wiccat", at: 2 },
        { label: "发动 Fairy Tail - Wiccat", at: 3 },
      ],
      hits: [],
      trace: [
        { action: 0, kind: "move", code: ASH, from: at(HAND, 0), to: at(MZONE, 2) },
        { action: 0, kind: "summon", code: ASH, controller: 0, normal: true },
        { action: 1, kind: "move", code: POPLAR, from: at(HAND, 0), to: at(MZONE, 3) },
        { action: 1, kind: "summon", code: POPLAR, controller: 0, normal: false },
        // 素材挂到还在额外卡组的 Wiccat 下面，然后 Wiccat 出场
        { action: 2, kind: "move", code: ASH, from: at(MZONE, 2), to: at(EXTRA, 0, { overlay_sequence: 0 }) },
        { action: 2, kind: "move", code: POPLAR, from: at(MZONE, 3), to: at(EXTRA, 0, { overlay_sequence: 1 }) },
        { action: 2, kind: "move", code: WICCAT, from: at(EXTRA, 0), to: at(MZONE, 4) },
        { action: 2, kind: "summon", code: WICCAT, controller: 0, normal: false },
        // 取除素材：从主要怪兽区第 5 格下面送去墓地
        { action: 3, kind: "chain", code: WICCAT, controller: 0, location: MZONE, sequence: 4, link: 1 },
        { action: 3, kind: "move", code: ASH, from: at(MZONE, 4, { overlay_sequence: 0 }), to: at(GRAVE, 0) },
        { action: 3, kind: "move", code: POPLAR, from: at(MZONE, 4, { overlay_sequence: 0 }), to: at(GRAVE, 1) },
        { action: 3, kind: "solving", link: 1 },
        { action: 3, kind: "solved", link: 1 },
      ],
      field: () => [{ monsters: [null, null, null, null, { code: WICCAT }], spells: [], hand: [] }, {}],
    } as unknown as DuelSession;

    const combo = toCombo(session, { now: new Date("2026-10-01T00:00:00Z") });
    const summon = combo.steps[2];
    expect(summon.moves.map((mv) => [mv.card.id, mv.from, mv.to])).toEqual([
      [ASH, "monster", "gy"],
      [POPLAR, "monster", "gy"],
      [WICCAT, "extra", "monster"],
    ]);
    // 取除素材不再记成「从怪兽区送墓」（素材早就记在墓地了）
    expect(combo.steps[3].moves).toEqual([]);
    expect(simulatePartial(combo).error).toBeUndefined();
  });

  it("keeps cards activated before the first action (e.g. a Quick-Play at the start of the turn)", () => {
    const DTW = 40235813; // Dark Time Wizard（速攻魔法）
    const GRAVEROBBER = 65118318;
    const at = (location: number, sequence: number) => ({ controller: 0 as const, location, sequence, position: 1 });
    const session = {
      data,
      setup: { main: [GRAVEROBBER, ...Array(39).fill(OAK)], extra: [], hand: [DTW, ASH], opponentHand: [], format: "tcg", seed: 1 },
      actions: [{ label: "通常召唤 Snake-Eye Ash", at: 3 }],
      hits: [],
      trace: [
        { action: -1, kind: "move", code: DTW, from: at(2, 0), to: at(8, 2) },
        { action: -1, kind: "chain", code: DTW, controller: 0, location: 8, sequence: 2, link: 1 },
        { action: -1, kind: "solving", link: 1 },
        { action: -1, kind: "move", code: GRAVEROBBER, from: at(1, 0), to: at(2, 1) },
        { action: -1, kind: "solved", link: 1 },
        { action: -1, kind: "move", code: DTW, from: at(8, 2), to: at(16, 0) },
        { action: 0, kind: "move", code: ASH, from: at(2, 0), to: at(4, 2) },
        { action: 0, kind: "summon", code: ASH, controller: 0, normal: true },
      ],
      field: () => [{ monsters: [null, null, { code: ASH }], spells: [], hand: [{ code: GRAVEROBBER }] }, {}],
    } as unknown as DuelSession;

    const combo = toCombo(session, { now: new Date("2026-10-01T00:00:00Z") });
    expect(combo.steps.map((st) => st.title)).toEqual(["发动 Dark Time Wizard", "通常召唤 Snake-Eye Ash"]);
    expect(combo.steps[0].moves.map((mv) => [mv.card.id, mv.from, mv.to])).toEqual([
      [DTW, "hand", "spell_trap"],
      [GRAVEROBBER, "deck", "hand"],
      [DTW, "spell_trap", "gy"],
    ]);
    expect(simulatePartial(combo).error).toBeUndefined();
  });
});

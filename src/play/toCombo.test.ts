import { readFile } from "node:fs/promises";
import createCore, { OcgMessageType, OcgResponseType, type OcgCoreSync } from "ocgcore-wasm";
import { beforeAll, describe, expect, it } from "vitest";
import { handtraps } from "../data";
import { EngineData } from "../engine/data";
import { startDuel } from "../engine/run";
import type { DuelSession, DuelSetup } from "../engine/session";
import { simulate } from "../model/board";
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
  });
});

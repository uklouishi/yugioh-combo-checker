import { readFile } from "node:fs/promises";
import createCore, { OcgLocation, OcgMessageType, OcgPosition, OcgResponseType, type OcgCoreSync } from "ocgcore-wasm";
import { beforeAll, describe, expect, it } from "vitest";
import { EngineData } from "./data";
import { activateAt, startDuel, undoResponses } from "./run";
import type { DuelSession, DuelSetup } from "./session";

// 需要先运行 npm run sync-engine 生成 public/engine/
const fetcher = (path: string) => readFile(`public/engine/${path}`, "utf8").catch(() => null);

const ASH = 9674034; // Snake-Eye Ash
const POPLAR = 90241276; // Snake-Eyes Poplar
const OAK = 45663742;
const FLAMBERGE = 48452496;
const OSS = 89023486;
const PRINCESS = 2772337;
const ASH_BLOSSOM = 14558127;
const MAXX_C = 23434538;
const ECCLESIA_DARK_DRAGON = 78397661;
const ALBAZ = 68468459; // Fallen of Albaz

const setup: DuelSetup = {
  main: [ASH, POPLAR, OAK, FLAMBERGE, OSS, ...Array(35).fill(OAK)],
  extra: [PRINCESS],
  hand: [ASH],
  opponentHand: [ASH_BLOSSOM, MAXX_C],
  seed: 42,
};

let core: OcgCoreSync;
let data: EngineData;
beforeAll(async () => {
  core = await createCore({ sync: true });
  data = await EngineData.load(fetcher);
});

function idle(s: DuelSession) {
  const m = s.prompt?.msg;
  if (m?.type !== OcgMessageType.SELECT_IDLECMD) throw new Error(`expected idle, got ${m?.type} (${s.status}: ${s.errors.join("; ")})`);
  return m;
}

/** 通常召唤 Ash，发动检索效果，选 Poplar。 */
function summonAsh(s: DuelSession) {
  const m = idle(s);
  s.respond({ type: OcgResponseType.SELECT_IDLECMD, action: 0, index: m.summons.findIndex((c) => c.code === ASH) });
  while (s.status === "prompt" && s.prompt!.msg.type !== OcgMessageType.SELECT_IDLECMD) {
    const p = s.prompt!.msg;
    if (p.type === OcgMessageType.SELECT_EFFECTYN) s.respond({ type: OcgResponseType.SELECT_EFFECTYN, yes: true });
    else if (p.type === OcgMessageType.SELECT_CHAIN) s.respond({ type: OcgResponseType.SELECT_CHAIN, index: null });
    else if (p.type === OcgMessageType.SELECT_PLACE) s.respond({ type: OcgResponseType.SELECT_PLACE, places: [{ player: 0, location: 4, sequence: 2 }] });
    else if (p.type === OcgMessageType.SELECT_POSITION) s.respond({ type: OcgResponseType.SELECT_POSITION, position: 1 });
    else if (p.type === OcgMessageType.SELECT_CARD) s.respond({ type: OcgResponseType.SELECT_CARD, indicies: [p.selects.findIndex((c) => c.code === POPLAR)] });
    else throw new Error(`unexpected prompt ${p.type}`);
  }
}

/** 开局直接把额外卡组的 Ecclesia and the Dark Dragon 放到怪兽区，省掉同调召唤。 */
function eccCore(): OcgCoreSync {
  return new Proxy(core, {
    get(t, k) {
      if (k === "duelNewCard")
        return (h: Parameters<OcgCoreSync["duelNewCard"]>[0], c: Parameters<OcgCoreSync["duelNewCard"]>[1]) =>
          t.duelNewCard(h, c.code === ECCLESIA_DARK_DRAGON ? { ...c, location: OcgLocation.MZONE, sequence: 2, position: OcgPosition.FACEUP_ATTACK } : c);
      const v = t[k as keyof OcgCoreSync];
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}

const eccSetup = (opponentHand: number[]): DuelSetup => ({ ...setup, main: [ALBAZ, ...Array(39).fill(OAK)], extra: [ECCLESIA_DARK_DRAGON], opponentHand });

/** 发动 Ecclesia：除外自己，从卡组特召 Fallen of Albaz。 */
function eccSummonAlbaz(s: DuelSession) {
  const m = idle(s);
  s.respond({ type: OcgResponseType.SELECT_IDLECMD, action: 5, index: m.activates.findIndex((c) => c.code === ECCLESIA_DARK_DRAGON) });
  while (s.status === "prompt" && s.prompt!.msg.type !== OcgMessageType.SELECT_IDLECMD) {
    const p = s.prompt!.msg;
    if (p.type === OcgMessageType.SELECT_CHAIN) s.respond({ type: OcgResponseType.SELECT_CHAIN, index: null });
    else if (p.type === OcgMessageType.SELECT_CARD) s.respond({ type: OcgResponseType.SELECT_CARD, indicies: [p.selects.findIndex((c) => c.code === ALBAZ)] });
    else if (p.type === OcgMessageType.SELECT_PLACE) s.respond({ type: OcgResponseType.SELECT_PLACE, places: [{ player: 0, location: 4, sequence: 1 }] });
    else if (p.type === OcgMessageType.SELECT_POSITION) s.respond({ type: OcgResponseType.SELECT_POSITION, position: 1 });
    else throw new Error(`unexpected prompt ${p.type}`);
  }
}

describe("DuelSession", () => {
  it("runs real card scripts: Snake-Eye Ash searches on Normal Summon", async () => {
    const s = await startDuel(core, data, setup);
    expect(s.errors).toEqual([]);
    summonAsh(s);
    const [me] = s.field();
    expect(me.monsters.some((c) => c?.code === ASH)).toBe(true);
    expect(me.hand.map((c) => c.code)).toContain(POPLAR);
    expect(s.actions.map((a) => a.label)).toEqual(["通常召唤 Snake-Eye Ash"]);
    expect(s.log.some((l) => l.text.includes("Snake-Eyes Poplar：卡组 → 手卡"))).toBe(true);
  });

  it("records when the opponent could chain handtraps", async () => {
    const s = await startDuel(core, data, setup);
    summonAsh(s);
    const codes = s.hits.flatMap((h) => h.options.map((o) => o.code));
    expect(codes).toContain(ASH_BLOSSOM);
    expect(codes).toContain(MAXX_C);
    const ashHit = s.hits.find((h) => h.options.some((o) => o.code === ASH_BLOSSOM))!;
    expect(ashHit.context).toContain("Snake-Eye Ash");
  });

  it("rewinds to a hit and lets the opponent activate Ash Blossom", async () => {
    const s = await startDuel(core, data, setup);
    summonAsh(s);
    const hit = s.hits.find((h) => h.options.some((o) => o.code === ASH_BLOSSOM))!;
    const opt = hit.options.find((o) => o.code === ASH_BLOSSOM)!;
    const t = await startDuel(core, data, setup, activateAt(s, hit, opt.index));
    // 可能还要自己回应连锁，一律不连锁
    while (t.status === "prompt" && t.prompt!.msg.type === OcgMessageType.SELECT_CHAIN) t.respond({ type: OcgResponseType.SELECT_CHAIN, index: null });
    idle(t);
    const [me, opp] = t.field();
    expect(me.hand.map((c) => c.code)).not.toContain(POPLAR);
    expect(opp.grave.map((c) => c.code)).toContain(ASH_BLOSSOM);
    expect(t.hits.find((h) => h.at === hit.at)?.used).toBe(ASH_BLOSSOM);
    expect(t.log.some((l) => l.text.includes("被无效"))).toBe(true);
  });

  it("undoes back to the previous own choice by replaying", async () => {
    const s = await startDuel(core, data, setup);
    summonAsh(s);
    const own = s.ownResponseIndices().length;
    let r = undoResponses(s)!;
    let t = await startDuel(core, data, setup, r);
    expect(t.status).toBe("prompt");
    expect(t.ownResponseIndices().length).toBe(own - 1);
    // 一直撤销到开局
    while ((r = undoResponses(t)!) && t.ownResponseIndices().length) t = await startDuel(core, data, setup, r);
    idle(t);
    expect(t.field()[0].hand.map((c) => c.code)).toEqual([ASH]);
  });

  it("draws a different random hand for each seed, and the same hand for the same seed", async () => {
    const random = { ...setup, main: [...Array(10).fill(ASH), ...Array(10).fill(POPLAR), ...Array(10).fill(OAK), ...Array(10).fill(OSS)], hand: null };
    const handOf = async (seed: number) => (await startDuel(core, data, { ...random, seed })).field()[0].hand.map((c) => c.code).join(",");
    const hands = new Set<string>();
    for (let seed = 1; seed <= 6; seed++) hands.add(await handOf(seed));
    expect(hands.size).toBeGreaterThan(1);
    expect(await handOf(3)).toBe(await handOf(3));
  });

  it("resolves effects that register new effects mid-resolution (Ecclesia and the Dark Dragon)", async () => {
    const s = await startDuel(eccCore(), data, eccSetup([]));
    eccSummonAlbaz(s);
    expect(s.errors).toEqual([]);
    const [me] = s.field();
    expect(me.banished.map((c) => c.code)).toContain(ECCLESIA_DARK_DRAGON);
    expect(me.monsters.some((c) => c?.code === ALBAZ)).toBe(true);
  });

  it('tracks what the opponent gains after Maxx "C"', async () => {
    const setup = eccSetup([MAXX_C]);
    const s = await startDuel(eccCore(), data, setup);
    const hit = s.hits.find((h) => h.options.some((o) => o.code === MAXX_C))!;
    const t = await startDuel(eccCore(), data, setup, activateAt(s, hit, hit.options.find((o) => o.code === MAXX_C)!.index));
    while (t.status === "prompt" && t.prompt!.msg.type === OcgMessageType.SELECT_CHAIN) t.respond({ type: OcgResponseType.SELECT_CHAIN, index: null });
    expect(t.gains.activated.map((a) => a.code)).toEqual([MAXX_C]);
    expect(t.gains.draws).toEqual([]);
    eccSummonAlbaz(t);
    expect(t.gains.draws).toHaveLength(1);
    expect(t.gains.draws[0].count).toBe(1);
    expect(t.gains.draws[0].context).toContain("Fallen of Albaz");
    expect(t.field()[1].hand).toHaveLength(1);
  });

  it("ends the turn and stops before the opponent acts", async () => {
    const s = await startDuel(core, data, setup);
    s.respond({ type: OcgResponseType.SELECT_IDLECMD, action: 7, index: null });
    expect(s.status).toBe("turn_over");
    expect(s.log.at(-1)?.text).toBe("回合结束");
  });
});

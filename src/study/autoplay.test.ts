import { readFile } from "node:fs/promises";
import createCore, { type OcgCoreSync } from "ocgcore-wasm";
import { beforeAll, describe, expect, it } from "vitest";
import { EngineData } from "../engine/data";
import { SAMPLE_DECK } from "../play/sample";
import { autoplay } from "./autoplay";

// 需要先运行 npm run sync-engine 生成 public/engine/
const fetcher = (path: string) => readFile(`public/engine/${path}`, "utf8").catch(() => null);

const ASH = 9674034; // Snake-Eye Ash
const PRINCESS = 2772337; // Promethean Princess, Bestower of Flames

let core: OcgCoreSync;
let data: EngineData;
beforeAll(async () => {
  core = await createCore({ sync: true });
  data = await EngineData.load(fetcher);
});

describe("autoplay", () => {
  it("Snake-Eye Ash 一张卡自己打出 Promethean Princess", async () => {
    const r = await autoplay({
      core,
      data,
      setup: { main: SAMPLE_DECK.main, extra: SAMPLE_DECK.extra, hand: [ASH], opponentHand: [], seed: 1 },
      targets: [{ card: PRINCESS, zone: "field", priority: 3 }],
      timeMs: 20_000,
    });
    expect(r).not.toBeNull();
    console.log(r!.nodes, r!.elapsed, r!.session.actions.map((a) => a.label).join(" / "));
    expect(r!.session.status).toBe("turn_over");
    expect(r!.met[0].ok).toBe(true);
    r!.session.destroy();
  }, 60_000);
});

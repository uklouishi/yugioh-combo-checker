import createCore, { OcgResponseType, type OcgCoreSync, type OcgResponse } from "ocgcore-wasm";
import type { EngineData } from "./data";
import { DuelSession, type DuelSetup, type Hit } from "./session";

let corePromise: Promise<OcgCoreSync> | undefined;

/** 引擎只加载一次（约 1.2 MB 的 WebAssembly）。 */
export function loadCore(): Promise<OcgCoreSync> {
  return (corePromise ??= createCore({ sync: true }));
}

/** 缺卡片脚本时补取后从头重放，直到不缺为止。 */
export async function settle(core: OcgCoreSync, data: EngineData, s: DuelSession): Promise<DuelSession> {
  for (let i = 0; i < 8 && s.status === "missing_scripts"; i++) {
    const missing = [...s.missing];
    s.destroy();
    await data.prefetch(missing);
    s = new DuelSession(core, data, s.setup, s.responses).start();
  }
  return s;
}

export async function startDuel(core: OcgCoreSync, data: EngineData, setup: DuelSetup, responses: OcgResponse[] = []) {
  await data.prefetch(DuelSession.scriptsFor(setup, data));
  return settle(core, data, new DuelSession(core, data, setup, responses).start());
}

/** 撤销：回到自己上一次做选择之前。 */
export function undoResponses(s: DuelSession): OcgResponse[] | null {
  const mine = s.ownResponseIndices();
  const last = mine.at(-1);
  return last === undefined ? null : s.responses.slice(0, last);
}

/** 回到吃坑点，让对手发动某张手坑。 */
export function activateAt(s: DuelSession, hit: Hit, index: number): OcgResponse[] {
  return [...s.responses.slice(0, hit.at), { type: OcgResponseType.SELECT_CHAIN, index }];
}

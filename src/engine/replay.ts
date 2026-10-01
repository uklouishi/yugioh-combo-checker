/** 对局记录（开局设置 + 全部回应）和字符串互转。回应里可能有 bigint，存成 {$big}。 */
import type { OcgResponse } from "ocgcore-wasm";
import type { DuelSetup } from "./session";

export interface Replay {
  setup: DuelSetup;
  responses: OcgResponse[];
}

export const encodeReplay = (r: Replay) => JSON.stringify(r, (_, v) => (typeof v === "bigint" ? { $big: v.toString() } : v));

export function decodeReplay(text: string): Replay | null {
  try {
    return JSON.parse(text, (_, v) => (v && typeof v === "object" && typeof v.$big === "string" ? BigInt(v.$big) : v)) as Replay;
  } catch {
    return null;
  }
}

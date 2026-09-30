import { OcgLocation, OcgMessageType, OcgResponseType, type OcgResponse } from "ocgcore-wasm";
import type { EngineData } from "../engine/data";
import type { Prompt } from "../engine/session";
import { locKey, type CardLoc } from "./DuelField";
import { describe } from "./text";

/** 一张卡此刻能做的一件事。kind 用来判断拖到哪个区域时该做哪件事。 */
export interface CardAction {
  label: string;
  kind: "summon" | "special" | "mset" | "sset" | "repos" | "activate";
  response: OcgResponse;
}

export interface CardActions {
  loc: CardLoc;
  code: number;
  actions: CardAction[];
}

/** 把引擎的空闲 / 战斗 / 连锁提示按卡整理：locKey → 这张卡能做的事。 */
export function cardActions(data: EngineData, prompt: Prompt | null): Map<string, CardActions> {
  const out = new Map<string, CardActions>();
  if (!prompt) return out;
  const m = prompt.msg;
  const add = (c: CardLoc & { code: number }, kind: CardAction["kind"], label: string, response: OcgResponse) => {
    const k = locKey(c);
    if (!out.has(k)) out.set(k, { loc: { controller: c.controller, location: c.location, sequence: c.sequence }, code: c.code, actions: [] });
    out.get(k)!.actions.push({ label, kind, response });
  };
  if (m.type === OcgMessageType.SELECT_IDLECMD) {
    const R = OcgResponseType.SELECT_IDLECMD;
    m.summons.forEach((c, i) => add(c, "summon", "通常召唤", { type: R, action: 0, index: i }));
    m.special_summons.forEach((c, i) => add(c, "special", "特殊召唤", { type: R, action: 1, index: i }));
    m.monster_sets.forEach((c, i) => add(c, "mset", "盖放", { type: R, action: 3, index: i }));
    m.spell_sets.forEach((c, i) => add(c, "sset", "盖放", { type: R, action: 4, index: i }));
    m.pos_changes.forEach((c, i) => add(c, "repos", "改变表示形式", { type: R, action: 2, index: i }));
    m.activates.forEach((c, i) => add(c, "activate", `发动${activationText(data, c.description)}`, { type: R, action: 5, index: i }));
  } else if (m.type === OcgMessageType.SELECT_BATTLECMD) {
    m.chains.forEach((c, i) => add(c, "activate", `发动${activationText(data, c.description)}`, { type: OcgResponseType.SELECT_BATTLECMD, action: 0, index: i }));
  } else if (m.type === OcgMessageType.SELECT_CHAIN) {
    m.selects.forEach((c, i) => add(c, "activate", `发动${activationText(data, c.description)}`, { type: OcgResponseType.SELECT_CHAIN, index: i }));
  }
  // 最常用的放前面：卡上的第一个按钮高亮
  for (const c of out.values()) c.actions.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  return out;
}

const ORDER: CardAction["kind"][] = ["activate", "special", "summon", "sset", "mset", "repos"];

export function activationText(data: EngineData, desc: bigint): string {
  const t = describe(data, desc);
  return t ? `：${t}` : "";
}

/**
 * 手卡拖到某个区域时该做的事：拖到怪兽区就召唤 / 特召 / 盖放，拖到魔陷区就发动或盖放。
 * 能召唤 / 发动时不提供盖放。一件都对不上时（比如魔法卡拖到了怪兽区）返回全部且 exact 为 false，交给玩家在菜单里选。
 */
export function actionsForDrop(acts: CardAction[], zone: CardLoc | null): { list: CardAction[]; exact: boolean } {
  if (!zone || zone.controller !== 0) return { list: acts, exact: false };
  const kinds: CardAction["kind"][] = zone.location === OcgLocation.MZONE ? ["summon", "special", "mset"] : zone.location === OcgLocation.SZONE ? ["activate", "sset"] : [];
  let hit = acts.filter((a) => kinds.includes(a.kind));
  // 拖出来一般是要用这张卡，能召唤 / 发动时先不提供盖放（点卡还能盖放）
  if (hit.some((a) => a.kind !== "mset" && a.kind !== "sset")) hit = hit.filter((a) => a.kind !== "mset" && a.kind !== "sset");
  return hit.length ? { list: hit, exact: true } : { list: acts, exact: false };
}

/** 空闲时能从额外卡组特殊召唤的卡。 */
export function extraSummons(all: Map<string, CardActions>): CardActions[] {
  return [...all.values()].filter((c) => c.loc.controller === 0 && c.loc.location === OcgLocation.EXTRA && c.actions.some((a) => a.kind === "special"));
}

/** 空闲 / 战斗阶段时推进阶段的按钮：进入战斗阶段、结束回合等。 */
export function phaseChoices(prompt: Prompt | null): { label: string; response: OcgResponse }[] {
  const m = prompt?.msg;
  const out: { label: string; response: OcgResponse }[] = [];
  if (m?.type === OcgMessageType.SELECT_IDLECMD) {
    if (m.to_bp) out.push({ label: "进入战斗阶段", response: { type: OcgResponseType.SELECT_IDLECMD, action: 6, index: null } });
    if (m.to_ep) out.push({ label: "结束回合", response: { type: OcgResponseType.SELECT_IDLECMD, action: 7, index: null } });
  } else if (m?.type === OcgMessageType.SELECT_BATTLECMD) {
    if (m.to_m2) out.push({ label: "进入主要阶段 2", response: { type: OcgResponseType.SELECT_BATTLECMD, action: 2, index: null } });
    if (m.to_ep) out.push({ label: "结束回合", response: { type: OcgResponseType.SELECT_BATTLECMD, action: 3, index: null } });
  }
  return out;
}

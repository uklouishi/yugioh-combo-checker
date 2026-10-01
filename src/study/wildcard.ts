/** 通配卡：「任意魔法师族怪兽」这类条件的匹配、名字和练习用的代表卡。 */
import { TYPE, type EngineCard, type EngineData } from "../engine/data";
import type { CardFilter, DeckStudy, Starter } from "./model";

const NORMAL = 0x10;
/** Dark Magician：魔法师族白板，条件允许时优先用它当代表卡。 */
const DARK_MAGICIAN = 46986414;

export const RACES: [number, string][] = [
  [0x1, "战士族"],
  [0x2, "魔法师族"],
  [0x4, "天使族"],
  [0x8, "恶魔族"],
  [0x10, "不死族"],
  [0x20, "机械族"],
  [0x40, "水族"],
  [0x80, "炎族"],
  [0x100, "岩石族"],
  [0x200, "鸟兽族"],
  [0x400, "植物族"],
  [0x800, "昆虫族"],
  [0x1000, "雷族"],
  [0x2000, "龙族"],
  [0x4000, "兽族"],
  [0x8000, "兽战士族"],
  [0x10000, "恐龙族"],
  [0x20000, "鱼族"],
  [0x40000, "海龙族"],
  [0x80000, "爬虫类族"],
  [0x100000, "念动力族"],
  [0x200000, "幻神兽族"],
  [0x400000, "创造神族"],
  [0x800000, "幻龙族"],
  [0x1000000, "电子界族"],
  [0x2000000, "幻想魔族"],
];

export const ATTRIBUTES: [number, string][] = [
  [0x1, "地"],
  [0x2, "水"],
  [0x4, "炎"],
  [0x8, "风"],
  [0x10, "光"],
  [0x20, "暗"],
  [0x40, "神"],
];

const raceName = new Map(RACES);
const attrName = new Map(ATTRIBUTES);

/** 比如「任意 4 星以下暗属性魔法师族怪兽」。 */
export function filterLabel(f: CardFilter): string {
  const level = f.maxLevel ? ` ${f.maxLevel} 星以下的` : "";
  const attr = f.attribute ? `${attrName.get(f.attribute) ?? "?"}属性` : "";
  const race = f.race ? (raceName.get(f.race) ?? "?") : "";
  return `任意${level}${attr}${race}怪兽`;
}

/** 主卡组的怪兽是否符合条件（额外卡组的怪兽不会在手里）。 */
export function matches(c: EngineCard, f: CardFilter): boolean {
  if (!(c.type & TYPE.MONSTER) || c.type & TYPE.TOKEN) return false;
  if (f.race && (c.data.race & BigInt(f.race)) === 0n) return false;
  if (f.attribute && (c.data.attribute & f.attribute) === 0) return false;
  if (f.maxLevel && (c.data.level === 0 || c.data.level > f.maxLevel)) return false;
  return true;
}

/** 卡组里符合条件的卡（去重，排除这一手里已经指定的卡）。 */
export function deckMatches(data: EngineData, study: DeckStudy, f: CardFilter, exclude: number[] = []): number[] {
  return [...new Set(study.main)].filter((id) => !exclude.includes(id) && matches(data.cards.get(id)!, f));
}

/**
 * 练习用的代表卡：符合条件的通常怪兽（没有效果，只提供种族、属性、等级），
 * 这样打出来的就是「随便哪一张都行」的路线。找不到白板时返回 null。
 */
export function blankFor(data: EngineData, f: CardFilter): number | null {
  const dm = data.cards.get(DARK_MAGICIAN);
  if (dm && matches(dm, f)) return DARK_MAGICIAN;
  let best: EngineCard | null = null;
  for (const c of data.cards.values()) {
    if (!(c.type & NORMAL) || c.type & (TYPE.FUSION | TYPE.SYNCHRO | TYPE.XYZ | TYPE.LINK | TYPE.RITUAL | TYPE.PENDULUM) || c.alias) continue;
    if (!matches(c, f)) continue;
    if (!best || c.code < best.code) best = c;
  }
  return best?.code ?? null;
}

/** 动点的名字，比如「Regulus, the Prince of Endymion + 任意魔法师族怪兽」。 */
export const starterLabel = (data: EngineData, s: Pick<Starter, "cards" | "wildcard">) =>
  [...s.cards.map((c) => data.name(c)), ...(s.wildcard ? [filterLabel(s.wildcard.filter)] : [])].join(" + ");

/** 练习用的主卡组：代表卡（白板）不在卡组里时放一张进去，好让它进起手。 */
export const practiceMain = (study: DeckStudy, s: Pick<Starter, "wildcard">) =>
  s.wildcard && !study.main.includes(s.wildcard.representative) ? [...study.main, s.wildcard.representative] : study.main;

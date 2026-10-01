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

/** 只按字段（没有种族、属性、等级）时魔法、陷阱也算。 */
const monstersOnly = (f: CardFilter) => !f.setcode || !!(f.race || f.attribute || f.maxLevel);

/** 比如「任意 4 星以下暗属性魔法师族怪兽」「任意「Dark Magician」卡」。 */
export function filterLabel(f: CardFilter): string {
  const set = f.setcode ? `「${f.setname ?? `0x${f.setcode.toString(16)}`}」` : "";
  const level = f.maxLevel ? ` ${f.maxLevel} 星以下的` : "";
  const attr = f.attribute ? `${attrName.get(f.attribute) ?? "?"}属性` : "";
  const race = f.race ? (raceName.get(f.race) ?? "?") : "";
  return `任意${set}${level}${attr}${race}${monstersOnly(f) ? "怪兽" : "卡"}`;
}

/** 字段判断，规则同 ygopro 的 IsSetCard（子字段也算，比如 Dark Magician 0x10a2 属于 0xa2）。 */
export const inSet = (c: EngineCard, set: number) => c.data.setcodes.some((s) => (s & 0xfff) === (set & 0xfff) && (s & set) === set);

/** 主卡组的卡是否符合条件（额外卡组的怪兽不会在手里）。 */
export function matches(c: EngineCard, f: CardFilter): boolean {
  if (c.type & TYPE.TOKEN) return false;
  if (monstersOnly(f) && !(c.type & TYPE.MONSTER)) return false;
  if (f.setcode && !inSet(c, f.setcode)) return false;
  if (f.race && (c.data.race & BigInt(f.race)) === 0n) return false;
  if (f.attribute && (c.data.attribute & f.attribute) === 0) return false;
  if (f.maxLevel && (c.data.level === 0 || c.data.level > f.maxLevel)) return false;
  return true;
}

/** 卡组里符合条件的卡（去重，排除这一手里已经指定的卡）。 */
export function deckMatches(data: EngineData, study: DeckStudy, f: CardFilter, exclude: number[] = []): number[] {
  return [...new Set(study.main)].filter((id) => !exclude.includes(id) && matches(data.cards.get(id)!, f));
}

/** 卡组里出现的字段（按卡组里张数从多到少），给「任意某字段的卡」用。 */
export function deckArchetypes(data: EngineData, main: number[]): { setcode: number; name: string; cards: number }[] {
  // 低 12 位相同的有名字的字段：Dark Magician Girl（0x30a2）同时属于 Dark Magician（0x10a2）和 Magician（0xa2）
  const named = new Map<number, number[]>();
  for (const k of Object.keys(data.setnames)) {
    const set = Number(k);
    named.set(set & 0xfff, [...(named.get(set & 0xfff) ?? []), set]);
  }
  const out = new Map<number, number>();
  for (const id of main) {
    const sets = new Set<number>();
    for (const s of data.cards.get(id)?.data.setcodes ?? []) {
      const parents = (named.get(s & 0xfff) ?? []).filter((t) => (s & t) === t);
      // 引擎的字段表里没有名字的字段（比如 Fairy Tail）也列出来，名字从卡名里找
      for (const t of parents.length ? parents : [s]) sets.add(t);
    }
    for (const set of sets) out.set(set, (out.get(set) ?? 0) + 1);
  }
  return [...out]
    .map(([setcode, cards]) => ({ setcode, name: data.setnames[setcode] ?? guessSetName(data, setcode), cards }))
    .sort((a, b) => b.cards - a.cards || a.name.localeCompare(b.name));
}

const guessed = new WeakMap<EngineData, Map<number, string>>();

/**
 * 没有名字的字段：取这个字段所有卡名里都出现的最长一串词（Fairy Tail - Snow、Fairy Tail Ball、
 * Once Upon a Fairy Tail → Fairy Tail）。找不到时显示字段代码。
 */
export function guessSetName(data: EngineData, set: number): string {
  const cache = guessed.get(data) ?? guessed.set(data, new Map()).get(data)!;
  const hit = cache.get(set);
  if (hit) return hit;
  const names = [...data.cards.values()]
    .filter((c) => !c.alias && c.data.setcodes.some((s) => (s & 0xfff) === (set & 0xfff) && (s & set) === set))
    .map((c) => c.name);
  let best = "";
  if (names.length) {
    const lower = names.map((n) => n.toLowerCase());
    const words = names.reduce((a, b) => (b.length < a.length ? b : a)).split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      for (let j = words.length; j > i; j--) {
        const cand = words.slice(i, j).join(" ").replace(/(\s+(the|of|a|an|and))+$/i, "").replace(/[\s\-–:,"]+$/, "");
        if (cand.length <= best.length) break;
        if (lower.every((n) => n.includes(cand.toLowerCase()))) best = cand;
      }
    }
  }
  const name = best.length >= 3 ? best : `字段 0x${set.toString(16)}`;
  cache.set(set, name);
  return name;
}

/**
 * 练习用的代表卡：符合条件的通常怪兽（没有效果，只提供种族、属性、等级），
 * 这样打出来的就是「随便哪一张都行」的路线。找不到白板时返回 null。
 */
export function blankFor(data: EngineData, f: CardFilter): number | null {
  // 字段卡大多有自己的效果，白板很少；只有字段里有通常怪兽时才用
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

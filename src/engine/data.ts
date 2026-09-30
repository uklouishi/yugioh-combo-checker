/** 引擎数据：卡片数值、公共脚本、卡片脚本、系统文字（由 scripts/sync-engine.ts 生成到 public/engine/）。 */
import type { OcgCardData } from "ocgcore-wasm";

type CardRow = [number, number, string, number, number, number, string, number, number, string, string[]];

export interface EngineCard {
  code: number;
  alias: number;
  name: string;
  type: number;
  /** 效果说明文字（str1..str16），效果描述 = code * 16 + 序号。 */
  strs: string[];
  data: OcgCardData;
}

export const TYPE = {
  MONSTER: 0x1,
  SPELL: 0x2,
  TRAP: 0x4,
  FUSION: 0x40,
  RITUAL: 0x80,
  SYNCHRO: 0x2000,
  TOKEN: 0x4000,
  XYZ: 0x800000,
  PENDULUM: 0x1000000,
  LINK: 0x4000000,
} as const;
const EXTRA_TYPES = TYPE.FUSION | TYPE.SYNCHRO | TYPE.XYZ | TYPE.LINK;

export const isExtraDeckCard = (c: EngineCard) => (c.type & TYPE.MONSTER) !== 0 && (c.type & EXTRA_TYPES) !== 0;

function toCard(r: CardRow): EngineCard {
  const [code, alias, setcode, type, level, attribute, race, atk, def, name, strs] = r;
  const setcodes: number[] = [];
  for (let s = BigInt(setcode); s > 0n; s >>= 16n) {
    const v = Number(s & 0xffffn);
    if (v) setcodes.push(v);
  }
  const isLink = (type & TYPE.LINK) !== 0;
  return {
    code,
    alias,
    name,
    type,
    strs,
    data: {
      code,
      alias,
      setcodes,
      type,
      level: level & 0xff,
      attribute,
      race: BigInt(race),
      attack: atk,
      defense: isLink ? 0 : def,
      lscale: (level >>> 24) & 0xff,
      rscale: (level >>> 16) & 0xff,
      link_marker: isLink ? def : 0,
    },
  };
}

export type Fetcher = (path: string) => Promise<string | null>;

export class EngineData {
  readonly cards = new Map<number, EngineCard>();
  readonly scripts = new Map<string, string | null>();
  constructor(
    rows: CardRow[],
    readonly base: Record<string, string>,
    readonly sys: Record<string, string>,
    private readonly fetcher: Fetcher,
  ) {
    for (const r of rows) this.cards.set(r[0], toCard(r));
  }

  static async load(fetcher: Fetcher): Promise<EngineData> {
    const [cards, base, sys] = await Promise.all([fetcher("cards.json"), fetcher("base.json"), fetcher("strings.json")]);
    if (!cards || !base || !sys) throw new Error("引擎数据加载失败");
    return new EngineData(JSON.parse(cards).cards, JSON.parse(base), JSON.parse(sys), fetcher);
  }

  /** 卡组里用的是异画（alias 指向本体且卡号相近）时换成本体卡号，脚本只有本体有。 */
  canonical(code: number): number {
    const c = this.cards.get(code);
    return c && c.alias && Math.abs(c.alias - code) < 20 ? c.alias : code;
  }

  name(code: number): string {
    return this.cards.get(code)?.name ?? `#${code}`;
  }

  /** 引擎同步读取脚本；卡片脚本要先 prefetch，没取到的返回 null（由 session 记下来补取后重跑）。 */
  readScript(name: string): string | null | undefined {
    if (name in this.base) return this.base[name];
    return this.scripts.get(name);
  }

  async prefetch(names: Iterable<string>) {
    const todo = [...new Set(names)].filter((n) => !(n in this.base) && !this.scripts.has(n));
    await Promise.all(
      todo.map(async (n) => {
        const text = await this.fetcher(`scripts/${n}`).catch(() => null);
        this.scripts.set(n, text);
      }),
    );
  }

  /** 效果描述：code*16+i 是卡片自己的说明文字，小数字是系统文字。 */
  describe(desc: bigint | number): string {
    const d = BigInt(desc);
    if (d === 0n) return "";
    if (d < 10000n) return this.sys[String(d)] ?? "";
    const code = Number(d >> 4n);
    const i = Number(d & 0xfn);
    return this.cards.get(code)?.strs[i] ?? "";
  }
}

/** 浏览器里：从网站的 engine/ 目录读取。 */
export const browserFetcher: Fetcher = async (path) => {
  const res = await fetch(`${import.meta.env.BASE_URL}engine/${path}`);
  if (!res.ok) return null;
  const text = await res.text();
  // Vite 开发服务器找不到文件时会返回 index.html
  return text.startsWith("<!doctype") || text.startsWith("<!DOCTYPE") ? null : text;
};

let shared: Promise<EngineData> | undefined;
export const loadEngineData = () => (shared ??= EngineData.load(browserFetcher));

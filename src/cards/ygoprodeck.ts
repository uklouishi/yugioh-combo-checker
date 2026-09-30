/**
 * YGOPRODeck 卡牌数据客户端。
 * API 文档：https://ygoprodeck.com/api-guide/
 * - 限流 20 次/秒，官方要求本地缓存，所以这里按 id 批量请求并缓存。
 * - 官方不允许直接盗链卡图，正式上线前需要把用到的卡图下载到自己的存储（见 scripts/sync-cards.ts）。
 * - 优先读 public/cards.json 快照（npm run sync-cards 生成），快照里没有的再请求 API。
 */
export interface CardImage {
  id: number;
  image_url: string;
  image_url_small: string;
  image_url_cropped: string;
}

/** YGOPRODeck cardinfo 返回的字段（只列出用到的）。 */
export interface CardInfo {
  id: number;
  name: string;
  type: string;
  frameType: string;
  desc: string;
  race: string;
  attribute?: string;
  level?: number;
  linkval?: number;
  atk?: number;
  def?: number;
  archetype?: string;
  card_images: CardImage[];
}

const API = "https://db.ygoprodeck.com/api/v7/cardinfo.php";
const BATCH = 50;
const STORAGE_KEY = "ygoprodeck-cache-v1";

export class CardStore {
  private cards = new Map<number, CardInfo>();
  private pending = new Map<number, Promise<CardInfo | undefined>>();

  constructor(private fetchImpl: typeof fetch = (...args) => fetch(...args)) {
    this.loadLocal();
  }

  get(id: number): CardInfo | undefined {
    return this.cards.get(id);
  }

  /** 已缓存的全部卡（去掉异画重复）。 */
  all(): CardInfo[] {
    return [...new Map([...this.cards.values()].map((c) => [c.id, c])).values()];
  }

  add(cards: CardInfo[]) {
    for (const c of cards) {
      this.cards.set(c.id, c);
      // 同一张卡的异画 id 也指向它，方便用任意 passcode 查询。
      for (const img of c.card_images ?? []) this.cards.set(img.id, c);
    }
  }

  /** 加载 public/cards.json 快照（没有就跳过）。 */
  async loadSnapshot(url = "/cards.json") {
    try {
      const res = await this.fetchImpl(url);
      if (res.ok) this.add((await res.json()) as CardInfo[]);
    } catch {
      // 没有快照时直接走 API
    }
  }

  /** 批量获取，已缓存的直接返回，缺的按 50 张一批请求。 */
  async getMany(ids: number[]): Promise<Map<number, CardInfo>> {
    const missing = [...new Set(ids)].filter((id) => !this.cards.has(id) && !this.pending.has(id));
    for (let i = 0; i < missing.length; i += BATCH) {
      const chunk = missing.slice(i, i + BATCH);
      const req = this.fetchBatch(chunk);
      for (const id of chunk) this.pending.set(id, req.then(() => this.cards.get(id)));
    }
    await Promise.all(ids.map((id) => this.pending.get(id)));
    for (const id of missing) this.pending.delete(id);
    this.saveLocal();
    const out = new Map<number, CardInfo>();
    for (const id of ids) {
      const c = this.cards.get(id);
      if (c) out.set(id, c);
    }
    return out;
  }

  private async fetchBatch(ids: number[]) {
    const res = await this.fetchImpl(`${API}?id=${ids.join(",")}&misc=yes`);
    // 只要有一个 id 不存在，YGOPRODeck 会返回 400；这时逐张重试，找出坏 id。
    if (res.status === 400 && ids.length > 1) {
      await Promise.all(ids.map((id) => this.fetchBatch([id])));
      return;
    }
    if (!res.ok) return;
    const body = (await res.json()) as { data?: CardInfo[] };
    this.add(body.data ?? []);
  }

  private loadLocal() {
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
      if (raw) this.add(JSON.parse(raw) as CardInfo[]);
    } catch {
      // 隐私模式等情况下 localStorage 不可用
    }
  }

  private saveLocal() {
    try {
      const unique = [...new Map([...this.cards.values()].map((c) => [c.id, c])).values()];
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(unique));
    } catch {
      // 忽略
    }
  }
}

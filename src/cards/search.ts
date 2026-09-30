/**
 * 按英文卡名搜索卡片：优先 YGOPRODeck 模糊搜索（fname），请求失败时退回本地卡牌快照。
 */
import type { CardInfo } from "./ygoprodeck";

const API = "https://db.ygoprodeck.com/api/v7/cardinfo.php";

export async function searchCards(
  query: string,
  local: CardInfo[],
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<CardInfo[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const lower = q.toLowerCase();
  const localHits = local.filter((c) => c.name.toLowerCase().includes(lower));
  try {
    const res = await fetchImpl(`${API}?fname=${encodeURIComponent(q)}`);
    // 没有匹配时 YGOPRODeck 返回 400
    if (res.status === 400) return localHits;
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { data?: CardInfo[] };
    const remote = body.data ?? [];
    // 完全匹配和前缀匹配排在前面
    const rank = (c: CardInfo) => {
      const n = c.name.toLowerCase();
      return n === lower ? 0 : n.startsWith(lower) ? 1 : 2;
    };
    return [...remote].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, 30);
  } catch {
    return localHits;
  }
}

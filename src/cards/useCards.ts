import { useEffect, useState } from "react";
import { CardStore, type CardInfo } from "./ygoprodeck";

const store = new CardStore();
let snapshot: Promise<void> | undefined;

/** 读取卡牌资料：先用本地快照，缺的再请求 YGOPRODeck。 */
export function useCards(ids: number[]): Map<number, CardInfo> {
  const key = [...new Set(ids)].sort().join(",");
  const [cards, setCards] = useState<Map<number, CardInfo>>(new Map());
  useEffect(() => {
    let alive = true;
    snapshot ??= store.loadSnapshot(`${import.meta.env.BASE_URL}cards.json`);
    snapshot
      .then(() => store.getMany(key ? key.split(",").map(Number) : []))
      .catch(() => new Map<number, CardInfo>())
      .then((m) => alive && setCards(m));
    return () => {
      alive = false;
    };
  }, [key]);
  return cards;
}

export const imageUrl = (id: number) => `${import.meta.env.BASE_URL}card-images/${id}.jpg`;

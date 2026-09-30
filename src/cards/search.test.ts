import { describe, expect, it } from "vitest";
import { searchCards } from "./search";
import type { CardInfo } from "./ygoprodeck";

const card = (id: number, name: string) => ({ id, name, card_images: [] }) as unknown as CardInfo;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("searchCards", () => {
  it("用 YGOPRODeck 结果，完全匹配和前缀匹配排在前面", async () => {
    const fetchMock = async () => json(200, { data: [card(1, "The Ash"), card(2, "Ash Blossom"), card(3, "Ash")] });
    const r = await searchCards("ash", [], fetchMock as unknown as typeof fetch);
    expect(r.map((c) => c.name)).toEqual(["Ash", "Ash Blossom", "The Ash"]);
  });

  it("网络失败时退回本地快照", async () => {
    const fetchMock = async () => {
      throw new Error("offline");
    };
    const r = await searchCards("oak", [card(1, "Snake-Eye Oak"), card(2, "Poplar")], fetchMock as unknown as typeof fetch);
    expect(r.map((c) => c.id)).toEqual([1]);
  });

  it("少于 2 个字符不搜索", async () => {
    expect(await searchCards("a", [card(1, "Ash")])).toEqual([]);
  });
});

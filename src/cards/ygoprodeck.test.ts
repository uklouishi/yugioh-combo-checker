import { describe, expect, it, vi } from "vitest";
import { CardStore, type CardInfo } from "./ygoprodeck";

const card = (id: number, name: string): CardInfo => ({
  id, name, type: "Effect Monster", frameType: "effect", desc: "", race: "Pyro",
  card_images: [{ id, image_url: "", image_url_small: "", image_url_cropped: "" }],
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("CardStore", () => {
  it("批量请求并缓存", async () => {
    const fetchMock = vi.fn(async () => json(200, { data: [card(1, "A"), card(2, "B")] }));
    const store = new CardStore(fetchMock as unknown as typeof fetch);
    const got = await store.getMany([1, 2]);
    expect(got.get(2)?.name).toBe("B");
    await store.getMany([1, 2]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("批量里有不存在的 id 返回 400 时逐张重试", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const ids = new URL(url).searchParams.get("id")!.split(",").map(Number);
      if (ids.includes(999)) return json(400, { error: "No card matching your query was found" });
      return json(200, { data: ids.map((id) => card(id, `c${id}`)) });
    });
    const store = new CardStore(fetchMock as unknown as typeof fetch);
    const got = await store.getMany([1, 999, 3]);
    expect([...got.keys()].sort()).toEqual([1, 3]);
  });
});

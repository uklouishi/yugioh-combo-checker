import { describe, expect, it } from "vitest";
import { DeckParseError, parseDeck, parseYdk, parseYdke, toYdke } from "./deck";

describe("deck import", () => {
  it("reads YDK sections", () => {
    const d = parseYdk("#created by X\r\n#main\r\n9674034\r\n9674034\r\n#extra\r\n2772337\r\n!side\r\n14558127\r\n");
    expect(d).toEqual({ main: [9674034, 9674034], extra: [2772337], side: [14558127] });
  });

  it("round-trips ydke links", () => {
    const d = { main: [9674034, 14558127, 14558127], extra: [2772337], side: [] };
    const url = toYdke(d);
    expect(url.startsWith("ydke://")).toBe(true);
    expect(parseYdke(url)).toEqual(d);
  });

  it("finds a ydke link inside pasted text", () => {
    const url = toYdke({ main: [1], extra: [], side: [2] });
    expect(parseDeck(`我的牌组 ${url} 谢谢`)).toEqual({ main: [1], extra: [], side: [2] });
  });

  it("rejects text with no cards", () => {
    expect(() => parseDeck("hello")).toThrow(DeckParseError);
    expect(() => parseDeck("ydke://abc!!!")).toThrow(DeckParseError);
  });
});

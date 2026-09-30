/** 牌组导入：YDK 文本（#main / #extra / !side）和 ydke:// 链接。 */

export interface Deck {
  main: number[];
  extra: number[];
  side: number[];
}

export class DeckParseError extends Error {}

export function parseYdk(text: string): Deck {
  const deck: Deck = { main: [], extra: [], side: [] };
  let section: keyof Deck = "main";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#main/i.test(line)) section = "main";
    else if (/^#extra/i.test(line)) section = "extra";
    else if (/^!side/i.test(line)) section = "side";
    else if (/^\d+$/.test(line)) deck[section].push(Number(line));
  }
  return deck;
}

function decodeIds(b64: string): number[] {
  if (!b64) return [];
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new DeckParseError("ydke 链接里的内容不是有效的 base64");
  }
  if (bin.length % 4) throw new DeckParseError("ydke 链接长度不对，可能复制不完整");
  const ids: number[] = [];
  for (let i = 0; i < bin.length; i += 4) {
    ids.push(
      (bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8) | (bin.charCodeAt(i + 2) << 16) | (bin.charCodeAt(i + 3) << 24)) >>> 0,
    );
  }
  return ids;
}

function encodeIds(ids: number[]): string {
  let bin = "";
  for (const id of ids) bin += String.fromCharCode(id & 0xff, (id >>> 8) & 0xff, (id >>> 16) & 0xff, (id >>> 24) & 0xff);
  return btoa(bin);
}

export function parseYdke(url: string): Deck {
  const m = url.trim().match(/^ydke:\/\/([^!]*)!([^!]*)!([^!]*)!?$/);
  if (!m) throw new DeckParseError("ydke 链接格式不对，应该是 ydke://…!…!…!");
  return { main: decodeIds(m[1]), extra: decodeIds(m[2]), side: decodeIds(m[3]) };
}

export const toYdke = (d: Deck) => `ydke://${encodeIds(d.main)}!${encodeIds(d.extra)}!${encodeIds(d.side)}!`;

export function toYdk(d: Deck): string {
  return ["#created by Combo Checker", "#main", ...d.main, "#extra", ...d.extra, "!side", ...d.side, ""].join("\n");
}

/** 自动识别粘贴的是 ydke 链接还是 YDK 文本。 */
export function parseDeck(text: string): Deck {
  const ydke = text.match(/ydke:\/\/\S+/);
  const deck = ydke ? parseYdke(ydke[0]) : parseYdk(text);
  if (deck.main.length + deck.extra.length === 0) {
    throw new DeckParseError("没有读到卡片。请粘贴 .ydk 文件的内容或 ydke:// 链接");
  }
  return deck;
}

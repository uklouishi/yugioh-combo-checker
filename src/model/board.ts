/**
 * 场地模拟：从起手局面开始，按顺序执行每一步的 moves，得到每一步之后的局面。
 * 只模拟自己一方（先攻展开时对手场上为空）。
 */
import type { CardRef, Combo, Move, Zone } from "./schema";

export interface PlacedCard {
  card: CardRef;
  faceDown?: boolean;
  defense?: boolean;
}

/** 有格子的区域：null 表示空格。 */
type Slots = Array<PlacedCard | null>;

export interface Board {
  monster: Slots; // 5
  emz: Slots; // 2
  spell_trap: Slots; // 5
  field_zone: Slots; // 1
  hand: PlacedCard[];
  /** 起手里 starter 之外的无关手卡张数。 */
  otherHand: number;
  gy: PlacedCard[];
  banished: PlacedCard[];
  extra: PlacedCard[];
  /** 主卡组剩余张数。 */
  deckCount: number;
}

export interface Frame {
  /** 对应的 step 索引，-1 是起手局面。 */
  stepIndex: number;
  board: Board;
  /** 这一步移动过的卡（用于高亮）。 */
  moved: Move[];
}

const SLOTTED = ["monster", "emz", "spell_trap", "field_zone"] as const;
type SlottedZone = (typeof SLOTTED)[number];
const isSlotted = (z: Zone): z is SlottedZone => (SLOTTED as readonly string[]).includes(z);

export function initialBoard(combo: Combo): Board {
  return {
    monster: Array(5).fill(null),
    emz: Array(2).fill(null),
    spell_trap: Array(5).fill(null),
    field_zone: [null],
    hand: combo.starter.map((card) => ({ card })),
    otherHand: Math.max(0, combo.handSize - combo.starter.length),
    gy: [],
    banished: [],
    extra: combo.requires.extra.map((card) => ({ card })),
    deckCount: combo.deckSize - combo.handSize,
  };
}

export const clone = (b: Board): Board => ({
  ...b,
  monster: [...b.monster],
  emz: [...b.emz],
  spell_trap: [...b.spell_trap],
  field_zone: [...b.field_zone],
  hand: [...b.hand],
  gy: [...b.gy],
  banished: [...b.banished],
  extra: [...b.extra],
});

export class BoardError extends Error {}

/** 卡在场地上的位置：有格子的区域和手卡带序号，卡组、墓地、除外、额外卡组只看区域。 */
export interface Loc {
  zone: Zone;
  index?: number;
}

/**
 * 宽松模式：卡不在记录的位置时不报错，而是去别的区域找；哪里都没有就当它凭空出现；
 * 目标格子被占时换一个空格。播放页用它，这样数据有小问题也能看，问题记在 warnings 里。
 */
export interface Leniency {
  warnings: string[];
}

function take(b: Board, m: Move): PlacedCard {
  return takeAt(b, m)[0];
}

function takeAt(b: Board, m: Move, lenient?: Leniency): [PlacedCard, Loc] {
  try {
    return takeStrict(b, m);
  } catch (e) {
    if (!lenient || !(e instanceof BoardError)) throw e;
    lenient.warnings.push(e.message);
    const loc = locate(b, m.card.id, m.from);
    if (loc && loc.zone !== "deck") return takeStrict(b, { ...m, from: loc.zone, fromSlot: loc.index, slot: undefined });
    return [{ card: m.card }, { zone: m.from }];
  }
}

function takeStrict(b: Board, m: Move): [PlacedCard, Loc] {
  const { from, card } = m;
  if (from === "deck") {
    if (b.deckCount <= 0) throw new BoardError(`卡组已经没有卡了，无法取出 ${card.name}`);
    b.deckCount -= 1;
    return [{ card }, { zone: "deck" }];
  }
  if (isSlotted(from)) {
    const slots = b[from];
    const i =
      m.fromSlot !== undefined && slots[m.fromSlot]?.card.id === card.id
        ? m.fromSlot
        : m.slot !== undefined && slots[m.slot]?.card.id === card.id
          ? m.slot
          : slots.findIndex((p) => p?.card.id === card.id);
    if (i < 0) throw new BoardError(`${zoneName(from)}里没有 ${card.name}`);
    const placed = slots[i]!;
    slots[i] = null;
    return [placed, { zone: from, index: i }];
  }
  const pile = b[from];
  const i = pile.findIndex((p) => p.card.id === card.id);
  if (i < 0) throw new BoardError(`${zoneName(from)}里没有 ${card.name}`);
  return [pile.splice(i, 1)[0], from === "hand" ? { zone: from, index: i } : { zone: from }];
}

function put(b: Board, m: Move, placed: PlacedCard, lenient?: Leniency): Loc {
  try {
    return putStrict(b, m, placed);
  } catch (e) {
    if (!lenient || !(e instanceof BoardError) || !isSlotted(m.to)) throw e;
    lenient.warnings.push(e.message);
    // 指定的格子被占了：换第一个空格；整个区域都满了就不放（这张卡暂时不显示）
    const free = b[m.to].findIndex((p) => p === null);
    return free < 0 ? { zone: m.to } : putStrict(b, { ...m, slot: free }, placed);
  }
}

function putStrict(b: Board, m: Move, placed: PlacedCard): Loc {
  const card: PlacedCard = { card: placed.card, faceDown: m.faceDown, defense: m.defense };
  const { to } = m;
  if (to === "deck") {
    b.deckCount += 1;
    return { zone: "deck" };
  }
  if (isSlotted(to)) {
    const slots = b[to];
    const i = m.slot ?? slots.findIndex((p) => p === null);
    if (i < 0 || i >= slots.length) throw new BoardError(`${zoneName(to)}已满，放不下 ${card.card.name}`);
    if (slots[i]) throw new BoardError(`${zoneName(to)}第 ${i + 1} 格已经有 ${slots[i]!.card.name}`);
    slots[i] = card;
    return { zone: to, index: i };
  }
  // 墓地、除外、手卡：新来的放在最上面（数组末尾）。
  b[to].push(card);
  return to === "hand" ? { zone: to, index: b.hand.length - 1 } : { zone: to };
}

/** 在局面上执行一次移动（直接修改 b），返回卡从哪里来、到了哪里。 */
export function applyMove(b: Board, m: Move, lenient?: Leniency): { from: Loc; to: Loc } {
  const [placed, from] = takeAt(b, m, lenient);
  return { from, to: put(b, m, placed, lenient) };
}

/** 找一张卡现在在哪：先看给定区域，找不到再找全场。 */
export function locate(b: Board, id: number, prefer?: Zone): Loc | null {
  const zones: Zone[] = ["hand", "monster", "emz", "spell_trap", "field_zone", "gy", "banished", "extra"];
  for (const zone of prefer ? [prefer, ...zones.filter((z) => z !== prefer)] : zones) {
    if (zone === "deck") continue;
    const list = b[zone as Exclude<Zone, "deck">] as Array<PlacedCard | null>;
    const i = list.findIndex((p) => p?.card.id === id);
    if (i < 0) continue;
    return isSlotted(zone) || zone === "hand" ? { zone, index: i } : { zone };
  }
  return prefer === "deck" ? { zone: "deck" } : null;
}

/** 计算每一步之后的局面。第 0 帧是起手局面。 */
export function simulate(combo: Combo): Frame[] {
  let board = initialBoard(combo);
  const frames: Frame[] = [{ stepIndex: -1, board, moved: [] }];
  combo.steps.forEach((step, stepIndex) => {
    board = clone(board);
    for (const m of step.moves) {
      try {
        put(board, m, take(board, m));
      } catch (e) {
        if (e instanceof BoardError) throw new BoardError(`步骤 ${stepIndex + 1}（${step.id}）：${e.message}`);
        throw e;
      }
    }
    frames.push({ stepIndex, board, moved: step.moves });
  });
  return frames;
}

export function zoneName(z: Zone): string {
  return {
    hand: "手卡",
    deck: "卡组",
    extra: "额外卡组",
    monster: "怪兽区",
    emz: "额外怪兽区",
    spell_trap: "魔陷区",
    field_zone: "场地区",
    gy: "墓地",
    banished: "除外区",
  }[z];
}

/** 播放页用：宽松模式算出每一步之后的局面，对不上的地方记在 warnings 里（带步骤号）。 */
export function simulateLenient(combo: Combo): { frames: Frame[]; warnings: string[] } {
  let board = initialBoard(combo);
  const frames: Frame[] = [{ stepIndex: -1, board, moved: [] }];
  const warnings: string[] = [];
  combo.steps.forEach((step, stepIndex) => {
    board = clone(board);
    const lenient: Leniency = { warnings: [] };
    for (const m of step.moves) applyMove(board, m, lenient);
    warnings.push(...lenient.warnings.map((w) => `步骤 ${stepIndex + 1}：${w}`));
    frames.push({ stepIndex, board, moved: step.moves });
  });
  return { frames, warnings };
}

/** 编辑时用：遇到错误就停下，返回已经算出的局面和错误信息。 */
export function simulatePartial(combo: Combo): { frames: Frame[]; error?: string } {
  let board = initialBoard(combo);
  const frames: Frame[] = [{ stepIndex: -1, board, moved: [] }];
  for (const [stepIndex, step] of combo.steps.entries()) {
    board = clone(board);
    for (const m of step.moves) {
      try {
        put(board, m, take(board, m));
      } catch (e) {
        if (e instanceof BoardError) return { frames, error: `步骤 ${stepIndex + 1}：${e.message}` };
        throw e;
      }
    }
    frames.push({ stepIndex, board, moved: step.moves });
  }
  return { frames };
}

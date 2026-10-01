/**
 * 上手率：随机抽很多手起手，统计动点、多个动点（补点）、手坑、废件的上手率，
 * 并按实际抽到的起手重新估计手坑优先级和卡组的「轴」。
 *
 * - 一手里有 2 个不同的动点、用到的卡不重叠（同一个动点抽到两份不算），算「多个动点」。
 * - 手里有多条已打过的路线时，对手的一张手坑按损失最小的那条算：被打断后还能用另一个动点补。
 * - 「绕不开的动作」：一手里所有能用的路线都要做这个动作，打它就躲不掉。
 */
import type { StudyComparison } from "./compare";
import type { DeckStudy, Starter } from "./model";

export interface HandOptions {
  /** 起手张数：先攻 5，后攻 6。 */
  size: number;
  /** 模拟多少手。 */
  hands?: number;
  seed?: number;
  /** 这张卡是不是手坑。 */
  isHandtrap: (id: number) => boolean;
  /** 这张卡是不是解牌。没有时不统计。 */
  isBreaker?: (id: number) => boolean;
  /** 用这副主卡组代替研究里的（换 side 后）。 */
  main?: number[];
  /** 这张卡能不能当这个动点的通配卡。 */
  wildcardOk: (starter: Starter, id: number) => boolean;
}

export interface HandtrapOutcome {
  /** 一张重要终端都打不出来。 */
  stop: number;
  /** 重要终端变少。 */
  cut: number;
  /** 重要终端不受影响。 */
  none: number;
}

export interface HandStats {
  size: number;
  hands: number;
  /** 至少有 1 个动点。 */
  anyStarter: number;
  /** 有 2 个以上不重叠的动点（补点上手）。 */
  multiStarter: number;
  /** 至少 1 张、2 张以上手坑（卡组自己的手坑）。 */
  handtrap1: number;
  handtrap2: number;
  /** 至少 1 张、2 张以上解牌。 */
  breaker1: number;
  breaker2: number;
  /** 至少 1 张手坑或解牌（后攻能干扰/破场）。 */
  interaction: number;
  /** 至少 1 张、2 张以上废件。 */
  brick1: number;
  brick2: number;
  /** 每个动点的上手率。 */
  perStarter: Record<string, number>;
  /** 有已打过路线的起手占比（下面两项的分母）。 */
  played: number;
  /** 手坑 → 按起手加权、考虑补点后平均打掉的重要终端占比。 */
  weighted: Record<number, number>;
  /** 手坑 → 在所有起手里的结果分布（占全部起手的比例）。 */
  outcomes: Record<number, HandtrapOutcome>;
  /** 动作签名 → 在有路线的起手里绕不开它的占比。 */
  unavoidable: Record<string, number>;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 这手牌能不能用这个动点，能的话返回用到的手牌位置。 */
function useStarter(s: Starter, hand: number[], wildcardOk: HandOptions["wildcardOk"], taken = new Set<number>()): Set<number> | null {
  const used = new Set<number>();
  for (const c of s.cards) {
    const i = hand.findIndex((x, j) => x === c && !used.has(j) && !taken.has(j));
    if (i < 0) return null;
    used.add(i);
  }
  if (s.wildcard) {
    const i = hand.findIndex((x, j) => !used.has(j) && !taken.has(j) && wildcardOk(s, x));
    if (i < 0) return null;
    used.add(i);
  }
  return used;
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 1000 : 0);

export function simulateHands(study: DeckStudy, cmp: StudyComparison, opts: HandOptions): HandStats {
  const n = opts.hands ?? 20000;
  const next = rng(opts.seed ?? 20261001);
  const deck = [...(opts.main ?? study.main)];
  const size = Math.min(opts.size, deck.length);
  const bricks = new Set(study.bricks);
  const routes = new Map(cmp.routes.map((r) => [r.starter.id, r]));
  const c = { any: 0, multi: 0, ht1: 0, ht2: 0, bk1: 0, bk2: 0, inter: 0, b1: 0, b2: 0, played: 0 };
  const isBreaker = opts.isBreaker ?? (() => false);
  const per: Record<string, number> = {};
  const weighted: Record<number, number> = {};
  const unavoidable: Record<string, number> = {};
  const outcomes: Record<number, HandtrapOutcome> = {};

  for (let k = 0; k < n; k++) {
    // 部分洗牌：只洗出前 size 张
    for (let i = 0; i < size; i++) {
      const j = i + Math.floor(next() * (deck.length - i));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const hand = deck.slice(0, size);

    const ht = hand.filter(opts.isHandtrap).length;
    const br = hand.filter((x) => bricks.has(x)).length;
    if (ht >= 1) c.ht1++;
    if (ht >= 2) c.ht2++;
    const bk = hand.filter(isBreaker).length;
    if (bk >= 1) c.bk1++;
    if (bk >= 2) c.bk2++;
    if (ht + bk >= 1) c.inter++;
    if (br >= 1) c.b1++;
    if (br >= 2) c.b2++;

    const avail: { s: Starter; used: Set<number> }[] = [];
    for (const s of study.starters) {
      const used = useStarter(s, hand, opts.wildcardOk);
      if (used) avail.push({ s, used });
    }
    for (const a of avail) per[a.s.id] = (per[a.s.id] ?? 0) + 1;
    if (avail.length) c.any++;
    // 两个不同的动点，用到的卡不重叠：先用一个，剩下的牌还能再组另一个
    if (avail.some((a) => avail.some((b) => b.s.id !== a.s.id && useStarter(b.s, hand, opts.wildcardOk, a.used)))) c.multi++;

    // 已打过路线的动点：手坑按损失最小的那条路线算；所有路线都有的动作就是绕不开的
    const played = avail.map((a) => routes.get(a.s.id)).filter((r): r is NonNullable<typeof r> => !!r && r.keyEnd.length > 0);
    if (!played.length) continue;
    c.played++;
    // 每条路线能接上的补点：卡不重叠，两边不都用通常召唤
    const playable = avail.filter((a) => played.some((r) => r.starter.id === a.s.id));
    const backups = new Map(
      playable.map((a) => {
        const ra = routes.get(a.s.id)!;
        const bs = playable
          .filter((b) => b.s.id !== a.s.id && !(ra.normalSummon && routes.get(b.s.id)!.normalSummon) && useStarter(b.s, hand, opts.wildcardOk, a.used))
          .map((b) => routes.get(b.s.id)!);
        return [a.s.id, bs];
      }),
    );
    const baseline = Math.max(...played.map((r) => r.keyEnd.length));
    for (const h of cmp.handtraps) {
      let after = 0;
      for (const r of played) {
        const options = h.options[r.starter.id] ?? [];
        let worst = r.keyEnd.length;
        for (const o of options) {
          let best = r.keyEnd.length - o.keyLost;
          for (const b of backups.get(r.starter.id) ?? []) best = Math.max(best, b.keyEnd.length - (b.sigLoss[o.sig] ?? 0));
          worst = Math.min(worst, best);
        }
        after = Math.max(after, worst);
      }
      weighted[h.handtrap] = (weighted[h.handtrap] ?? 0) + 1 - after / baseline;
      const out = (outcomes[h.handtrap] ??= { stop: 0, cut: 0, none: 0 });
      if (after === 0) out.stop++;
      else if (after < baseline) out.cut++;
      else out.none++;
    }
    const common = played.slice(1).reduce((acc, r) => acc.filter((x) => r.sigs.includes(x)), played[0].sigs);
    for (const sig of common) unavoidable[sig] = (unavoidable[sig] ?? 0) + 1;
  }

  const norm = (m: Record<string | number, number>, d: number) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, pct(v, d)]));
  return {
    size,
    hands: n,
    anyStarter: pct(c.any, n),
    multiStarter: pct(c.multi, n),
    handtrap1: pct(c.ht1, n),
    handtrap2: pct(c.ht2, n),
    breaker1: pct(c.bk1, n),
    breaker2: pct(c.bk2, n),
    interaction: pct(c.inter, n),
    brick1: pct(c.b1, n),
    brick2: pct(c.b2, n),
    perStarter: norm(per, n),
    played: pct(c.played, n),
    weighted: norm(weighted, c.played),
    outcomes: Object.fromEntries(Object.entries(outcomes).map(([k, o]) => [k, { stop: pct(o.stop, n), cut: pct(o.cut, n), none: pct(o.none, n) }])),
    unavoidable: norm(unavoidable, c.played),
  };
}

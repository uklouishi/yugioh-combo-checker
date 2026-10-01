/**
 * 卡组研究的对比分析：把每个动点打出来的路线放在一起，
 * 按「这张手坑最痛的一下能让多少重要终端出不来」给手坑排优先级。
 *
 * - 每条路线的重要终端 = 终场卡里玩家选的重要终端（没选时整个终场都算）。
 * - 每张手坑在每条路线上挑打掉重要终端最多的那一下（同样多时按通用分数）。
 * - 分数 = 各路线被打掉的重要终端占比的平均（终场没有重要终端的路线不计）。
 * - Maxx "C" 类不打断展开，单独按平均让对手抽几张列出来。
 */
import { handtraps } from "../data";
import type { Interruption } from "../model/interruptions";
import { evaluateHits, FUWALOS, lossIfNegated, MEOWLS, PURULIA } from "../model/priority";
import { HT } from "../model/interruptions";
import type { Combo } from "../model/schema";
import type { DeckStudy, Starter } from "./model";

const DRAWERS = new Set<number>([HT.MAXX_C, FUWALOS, PURULIA, MEOWLS]);

export interface RouteSummary {
  starter: Starter;
  combo: Combo;
  /** 终场里的重要终端（同名多张就列多次）。 */
  keyEnd: number[];
  endCount: number;
  normalSummon: boolean;
}

export interface RouteHit {
  starterId: string;
  hit: Interruption;
  step: number;
  /** 被打掉的重要终端。 */
  keyLost: number[];
  reason: string;
}

export interface HandtrapRank {
  handtrap: number;
  /** 0–1：平均打掉的重要终端占比。 */
  score: number;
  /** 能打掉至少一张重要终端的路线数。 */
  routesHurt: number;
  /** 能打（有吃坑点）的路线数。 */
  routesHit: number;
  /** 每条路线上最痛的一下，按打掉的多少排序。 */
  hits: RouteHit[];
  /** 通用分数（步骤和整个终场的损失）之和，重要终端分数一样时用来排先后。 */
  generic: number;
}

export interface DrawRank {
  handtrap: number;
  /** 平均让对手抽几张。 */
  draws: number;
  routesHit: number;
}

export interface KeyEffect {
  /** 这一步发动效果或召唤的卡。 */
  card: number;
  /** 它在几条路线里出现，并且被无效会让重要终端出不来。 */
  routes: string[];
  /** 各路线打掉的重要终端占比之和 / 有重要终端的路线数。 */
  score: number;
  /** 最痛的那条路线和那一步。 */
  worst: { starterId: string; step: number; keyLost: number[] };
}

export interface StudyComparison {
  routes: RouteSummary[];
  /** 玩家没选重要终端，整个终场都算。 */
  fallback: boolean;
  /** 有重要终端的路线数（分数的分母）。 */
  scored: number;
  handtraps: HandtrapRank[];
  drawers: DrawRank[];
  /** 不能打任何路线的手坑。 */
  unused: number[];
  keyEffects: KeyEffect[];
}

/** 终场列表里有哪些落在 lost 里（同名多张都算）。 */
const lostOf = (keyEnd: number[], lost: Set<number>) => keyEnd.filter((c) => lost.has(c));

function actorOf(combo: Combo, i: number): number {
  const a = combo.steps[i].actions[0];
  return a.type === "activate" ? a.activation.card.id : a.summon.card.id;
}

export function compareStudy(study: DeckStudy): StudyComparison {
  const fallback = study.keyCards.length === 0;
  const key = new Set(study.keyCards);
  const routes: RouteSummary[] = study.starters.flatMap((starter) => {
    const combo = study.routes[starter.id];
    if (!combo) return [];
    const end = combo.endboard.cards.map((c) => c.id);
    return [
      {
        starter,
        combo,
        keyEnd: fallback ? end : end.filter((c) => key.has(c)),
        endCount: end.length,
        normalSummon: combo.steps.some((s) => s.actions.some((a) => a.type === "summon" && a.summon.method === "normal")),
      },
    ];
  });
  const scored = routes.filter((r) => r.keyEnd.length > 0).length;

  const ranks = new Map<number, HandtrapRank>();
  const draws = new Map<number, { total: number; routes: number }>();
  const effects = new Map<number, KeyEffect>();

  for (const r of routes) {
    const evals = evaluateHits(r.combo);
    const best = new Map<number, { e: (typeof evals)[number]; keyLost: number[] }>();
    for (const e of evals) {
      const h = e.hit.handtrap;
      if (DRAWERS.has(h)) {
        const d = draws.get(h) ?? { total: 0, routes: 0 };
        const prev = best.get(h);
        if (!prev || (e.draws ?? 0) > (prev.e.draws ?? 0)) best.set(h, { e, keyLost: [] });
        draws.set(h, d);
        continue;
      }
      const keyLost = lostOf(r.keyEnd, e.lost);
      const prev = best.get(h);
      if (!prev || keyLost.length > prev.keyLost.length || (keyLost.length === prev.keyLost.length && e.score > prev.e.score + 1e-9)) best.set(h, { e, keyLost });
    }
    for (const [h, { e, keyLost }] of best) {
      if (DRAWERS.has(h)) {
        const d = draws.get(h)!;
        d.total += e.draws ?? 0;
        d.routes += 1;
        continue;
      }
      const rank = ranks.get(h) ?? { handtrap: h, score: 0, routesHurt: 0, routesHit: 0, hits: [], generic: 0 };
      rank.routesHit += 1;
      rank.generic += e.score;
      if (keyLost.length) rank.routesHurt += 1;
      if (r.keyEnd.length) rank.score += keyLost.length / r.keyEnd.length;
      rank.hits.push({ starterId: r.starter.id, hit: e.hit, step: e.step, keyLost, reason: e.reason });
      ranks.set(h, rank);
    }

    // 每一步被无效会让哪些重要终端出不来：按发动/召唤的卡汇总
    if (!r.keyEnd.length) continue;
    r.combo.steps.forEach((_, i) => {
      const keyLost = lostOf(r.keyEnd, lossIfNegated(r.combo, i));
      if (!keyLost.length) return;
      const card = actorOf(r.combo, i);
      const ke = effects.get(card) ?? { card, routes: [], score: 0, worst: { starterId: r.starter.id, step: i + 1, keyLost } };
      const frac = keyLost.length / r.keyEnd.length;
      if (!ke.routes.includes(r.starter.id)) {
        ke.routes.push(r.starter.id);
        ke.score += frac;
      }
      if (keyLost.length > ke.worst.keyLost.length) ke.worst = { starterId: r.starter.id, step: i + 1, keyLost };
      effects.set(card, ke);
    });
  }

  const handtrapRanks = [...ranks.values()]
    .map((r) => ({
      ...r,
      score: scored ? Math.round((r.score / scored) * 100) / 100 : 0,
      hits: r.hits.sort((a, b) => b.keyLost.length - a.keyLost.length),
    }))
    .sort((a, b) => b.score - a.score || b.routesHurt - a.routesHurt || b.generic - a.generic);
  const drawers = [...draws]
    .map(([handtrap, d]) => ({ handtrap, draws: Math.round((d.total / Math.max(1, d.routes)) * 10) / 10, routesHit: d.routes }))
    .sort((a, b) => b.draws - a.draws);
  const hitSet = new Set([...ranks.keys(), ...draws.keys()]);
  const keyEffects = [...effects.values()]
    .map((k) => ({ ...k, score: scored ? Math.round((k.score / scored) * 100) / 100 : 0 }))
    .sort((a, b) => b.score - a.score || b.routes.length - a.routes.length);

  return {
    routes,
    fallback,
    scored,
    handtraps: handtrapRanks,
    drawers,
    unused: routes.length ? handtraps.map((h) => h.id).filter((id) => !hitSet.has(id)) : [],
    keyEffects,
  };
}

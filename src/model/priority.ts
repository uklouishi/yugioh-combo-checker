/**
 * 手坑优先级自动分析：估计每张手坑在它最痛的时点打下去，这条 combo 会损失多少。
 *
 * 思路：把每一步看成「用掉哪些卡、拿到哪些卡」。某一步的效果被无效后，这一步拿到的卡就没了，
 * 后面凡是要用到这些卡的步骤也做不了（连带拿不到它们的卡），一直传递下去。
 * 损失 = 做不了的步骤占比 + 终场少掉的卡占比。不同手坑按各自的打法算：
 * - 无效类（Ash Blossom、Infinite Impermanence、Effect Veiler、Ghost Belle、D.D. Crow、Called by the Grave 等）：无效这一步
 * - Ghost Ogre / Fydraulis Harmonia：效果照常处理，但发动的那张卡离场
 * - Droll & Lock Bird：之后所有从卡组检索的效果都拿不到卡
 * - Nibiru：场上怪兽全部解放
 * - Maxx "C" / Mulcharmy：不打断，按之后对手能抽几张算
 * 作者在 combo 里写了影响（直接断 / 终场变弱…）时以作者为准。
 */
import { analyzeCombo } from "./analysis";
import { HT, type Interruption } from "./interruptions";
import type { Combo, InterruptionImpact, Step, Zone } from "./schema";

export const FUWALOS = 42141493;
export const PURULIA = 84192580;
export const MEOWLS = 87126721;
export const HARMONIA = 70088809;

export interface HandtrapPriority {
  handtrap: number;
  /** 0–1，越大越该防。 */
  score: number;
  impact: InterruptionImpact;
  /** 影响来自作者说明（不是算法估的）。 */
  authored: boolean;
  /** 最痛的那一步（1 起）。 */
  step: number;
  /** 最痛的那一次命中，分析页用来显示详情。 */
  hit: Interruption;
  /** 中文说明，卡名用英文。 */
  reason: string;
  lostSteps: number;
  endLost: number;
  endTotal: number;
  /** Maxx "C" 类：之后对手大约能抽几张。 */
  draws?: number;
}

const FIELD: Zone[] = ["monster", "emz", "spell_trap", "field_zone"];
const GAIN_FROM: Zone[] = ["deck", "extra", "gy", "banished"];
const DRAW_CAP = 6;

interface StepIO {
  uses: Set<number>;
  gains: Set<number>;
  summons: { id: number; from: Zone; special: boolean }[];
  searches: boolean;
  firstActivation?: number;
}

function stepIO(step: Step): StepIO {
  const uses = new Set<number>();
  const gains = new Set<number>();
  const summons: StepIO["summons"] = [];
  let searches = false;
  let firstActivation: number | undefined;
  for (const a of step.actions) {
    if (a.type === "activate") {
      uses.add(a.activation.card.id);
      firstActivation ??= a.activation.card.id;
      if (a.activation.effects.includes("add_from_deck")) searches = true;
    } else {
      summons.push({ id: a.summon.card.id, from: a.summon.from, special: a.summon.method !== "normal" });
      if (a.type === "resolve_summon") gains.add(a.summon.card.id);
    }
  }
  for (const m of step.moves) {
    if (m.from !== "deck" && m.from !== "extra") uses.add(m.card.id);
    if (GAIN_FROM.includes(m.from) && (m.to === "hand" || FIELD.includes(m.to) || (m.from === "deck" && m.to === "gy"))) gains.add(m.card.id);
  }
  // 召唤出来的怪兽本身就是这一步的成果（比如连接召唤）
  for (const s of summons) gains.add(s.id);
  return { uses, gains, summons, searches, firstActivation };
}

interface Loss {
  steps: Set<number>;
  cards: Set<number>;
}

/**
 * 从某些卡丢失开始往后传递：after 之后的步骤用到丢失的卡就做不了，它拿到的卡也跟着丢。
 * negated 是直接被无效的步骤（它拿到的卡算丢失）。
 */
function propagate(io: StepIO[], after: number, lostCards: Iterable<number>, negated: number[] = []): Loss {
  const cards = new Set(lostCards);
  const steps = new Set<number>();
  for (const i of negated) {
    steps.add(i);
    for (const g of io[i].gains) cards.add(g);
  }
  for (let j = after + 1; j < io.length; j++) {
    if (steps.has(j)) continue;
    if ([...io[j].uses].some((c) => cards.has(c))) {
      steps.add(j);
      for (const g of io[j].gains) cards.add(g);
    }
  }
  return { steps, cards };
}

/** 某一步结束时场上的怪兽（按移动模拟）。 */
function monstersAfter(combo: Combo, idx: number): number[] {
  const on = new Map<number, number>();
  for (let i = 0; i <= idx; i++) {
    for (const m of combo.steps[i].moves) {
      const was = m.from === "monster" || m.from === "emz";
      const now = m.to === "monster" || m.to === "emz";
      if (was) on.set(m.card.id, Math.max(0, (on.get(m.card.id) ?? 0) - 1));
      if (now) on.set(m.card.id, (on.get(m.card.id) ?? 0) + 1);
    }
  }
  return [...on].filter(([, n]) => n > 0).map(([id]) => id);
}

function drawsAfter(handtrap: number, io: StepIO[], from: number): number {
  let n = 0;
  for (let j = from; j < io.length; j++) {
    for (const s of io[j].summons) {
      if (handtrap === FUWALOS) n += Number(s.special && (s.from === "deck" || s.from === "extra"));
      else if (handtrap === PURULIA) n += Number(s.from === "hand");
      else if (handtrap === MEOWLS) n += Number(s.special && (s.from === "gy" || s.from === "banished"));
      else n += Number(s.special);
    }
  }
  return n;
}

const AUTHOR_SCORE: Record<InterruptionImpact, number> = { combo_ends: 0.9, reroute: 0.5, reduced_endboard: 0.4, minor: 0.1 };

export function impactFromScore(score: number): InterruptionImpact {
  return score >= 0.6 ? "combo_ends" : score >= 0.3 ? "reduced_endboard" : "minor";
}

interface Eval {
  score: number;
  reason: string;
  lostSteps: number;
  endLost: number;
  /** 这一下打掉的卡（拿不到或离场），用来算终场里少了哪些。 */
  lost: Set<number>;
  draws?: number;
}

function evaluate(combo: Combo, io: StepIO[], hit: Interruption): Eval {
  const n = combo.steps.length;
  const i = combo.steps.findIndex((s) => s.id === hit.stepId);
  const end = combo.endboard.cards.map((c) => c.id);
  const step = combo.steps[i];
  const actor = step.actions[hit.actionIndex];
  const actorName = actor ? (actor.type === "activate" ? actor.activation.card.name : actor.summon.card.name) : step.title;
  const h = hit.handtrap;

  const lossScore = (loss: Loss) => {
    const endLost = end.filter((c) => loss.cards.has(c)).length;
    const stepFrac = loss.steps.size / Math.max(1, n);
    const score = end.length ? 0.55 * (endLost / end.length) + 0.45 * stepFrac : stepFrac;
    return { score, endLost, lostSteps: loss.steps.size };
  };
  const tail = (r: { endLost: number; lostSteps: number }) => {
    const parts = [];
    parts.push(r.lostSteps ? `之后 ${r.lostSteps} / ${n} 步做不了` : "后面的步骤基本不受影响");
    if (end.length) parts.push(r.endLost ? `终场 ${end.length} 张里少 ${r.endLost} 张` : "终场不变");
    return parts.join("，");
  };

  if (h === HT.MAXX_C || h === FUWALOS || h === PURULIA || h === MEOWLS) {
    const draws = drawsAfter(h, io, i);
    const score = Math.min(1, draws / DRAW_CAP) * 0.85;
    const reason = draws ? `第 ${i + 1} 步丢出后，这条路线之后还会让对手抽约 ${draws} 张（不打断展开，但对手资源变多）` : `第 ${i + 1} 步之后没有会让对手抽卡的召唤，基本没用`;
    return { score, draws, lostSteps: 0, endLost: 0, lost: new Set(), reason };
  }
  if (h === HT.NIBIRU) {
    const loss = propagate(io, i, monstersAfter(combo, i));
    // 终场怪兽如果在这之后才召唤出来就不受影响；已经在场上的全部解放
    const r = lossScore(loss);
    return { ...r, lost: loss.cards, reason: `第 ${i + 1} 步召唤后发动，场上怪兽全部解放：${tail(r)}` };
  }
  if (h === HT.DROLL) {
    const later = io.map((x, j) => (j > i && x.searches ? j : -1)).filter((j) => j >= 0);
    const loss = later.reduce<Loss>(
      (acc, j) => {
        const l = propagate(io, j, [], [j]);
        l.steps.forEach((s) => acc.steps.add(s));
        l.cards.forEach((c) => acc.cards.add(c));
        return acc;
      },
      { steps: new Set(), cards: new Set() },
    );
    const r = lossScore(loss);
    return { ...r, lost: loss.cards, reason: later.length ? `${actorName} 检索后发动，之后 ${later.length} 次检索全部落空：${tail(r)}` : `${actorName} 检索后发动，但之后没有再从卡组检索，影响不大` };
  }
  if (h === HT.GHOST_OGRE || h === HARMONIA) {
    const card = actor?.type === "activate" ? actor.activation.card.id : io[i].firstActivation;
    const loss = propagate(io, i, card ? [card] : []);
    const r = lossScore(loss);
    const how = h === HT.GHOST_OGRE ? "被破坏（效果照常处理）" : "被 Harmonia 的效果处理掉";
    return { ...r, lost: loss.cards, reason: `第 ${i + 1} 步 ${actorName} ${how}：${tail(r)}` };
  }
  // 其余按「这一步的效果被无效」算
  const loss = propagate(io, i, [], [i]);
  const r = lossScore(loss);
  const verb = h === HT.DD_CROW || h === HT.CALLED_BY ? "因为墓地的卡被除外而落空" : "被无效";
  return { ...r, lost: loss.cards, reason: `第 ${i + 1} 步 ${actorName} 的效果${verb}：${tail(r)}` };
}

export interface HitEval {
  hit: Interruption;
  /** 第几步（1 起）。 */
  step: number;
  score: number;
  reason: string;
  /** 打掉的卡：终场卡在这里面就是被这一下打没了。 */
  lost: Set<number>;
  draws?: number;
}

/** 每一个吃坑点单独估算（卡组研究页按「打掉了哪些重要终端」重新挑最痛的一下）。 */
export function evaluateHits(combo: Combo): HitEval[] {
  const io = combo.steps.map(stepIO);
  const stepNo = new Map(combo.steps.map((s, i) => [s.id, i + 1]));
  return analyzeCombo(combo).hits.map((hit) => {
    const e = evaluate(combo, io, hit);
    return { hit, step: stepNo.get(hit.stepId)!, score: e.score, reason: e.reason, lost: e.lost, ...(e.draws !== undefined && { draws: e.draws }) };
  });
}

/** 某一步的效果被无效时打掉的卡（重要终端依赖哪几步）。 */
export function lossIfNegated(combo: Combo, stepIndex: number): Set<number> {
  const io = combo.steps.map(stepIO);
  return propagate(io, stepIndex, [], [stepIndex]).cards;
}

/** 每张能打的手坑的优先级，从最该防的开始排。 */
export function handtrapPriorities(combo: Combo): HandtrapPriority[] {
  const io = combo.steps.map(stepIO);
  const endTotal = combo.endboard.cards.length;
  const stepNo = new Map(combo.steps.map((s, i) => [s.id, i + 1]));
  const out: HandtrapPriority[] = [];
  for (const t of analyzeCombo(combo).handtraps) {
    let best: { hit: Interruption; e: Eval } | null = null;
    for (const hit of t.hits) {
      const e = evaluate(combo, io, hit);
      if (!best || e.score > best.e.score + 1e-9) best = { hit, e };
    }
    if (!best) continue;
    const authored = t.worst.impact !== undefined;
    const impact = authored ? t.worst.impact! : impactFromScore(best.e.score);
    const hit = authored ? t.worst : best.hit;
    // 作者写了影响时，分数向作者的判断靠拢，排序才和标签一致
    const score = authored ? (AUTHOR_SCORE[impact] + best.e.score) / 2 : best.e.score;
    out.push({
      handtrap: t.handtrap,
      score: Math.round(score * 100) / 100,
      impact,
      authored,
      step: stepNo.get(hit.stepId)!,
      hit,
      reason: authored && hit.note ? `${hit.note}（算法估计：${best.e.reason}）` : best.e.reason,
      lostSteps: best.e.lostSteps,
      endLost: best.e.endLost,
      endTotal,
      ...(best.e.draws !== undefined && { draws: best.e.draws }),
    });
  }
  return out.sort((a, b) => b.score - a.score || a.step - b.step);
}

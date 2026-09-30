/** Combo 分析：把逐步的吃坑点汇总成「每张手坑最早在哪一步、最坏造成什么后果」。 */
import { deriveInterruptions, type Interruption } from "./interruptions";
import type { Combo, InterruptionImpact } from "./schema";

/** 数值越小越严重；自动推导（作者没写影响）排在确定的影响之后。 */
export const SEVERITY: Record<InterruptionImpact | "unknown", number> = {
  combo_ends: 0,
  reroute: 1,
  reduced_endboard: 2,
  unknown: 3,
  minor: 4,
};

export const severityOf = (i: Interruption) => SEVERITY[i.impact ?? "unknown"];

export interface HandtrapSummary {
  handtrap: number;
  /** 最坏的一次（严重度最高，同级取最早）。 */
  worst: Interruption;
  /** 第一次能打的步骤序号（1 起）。 */
  firstStep: number;
  /** 能打的所有步骤序号。 */
  steps: number[];
  hits: Interruption[];
}

export interface ComboAnalysis {
  stepCount: number;
  normalSummons: number;
  specialSummons: number;
  hits: Interruption[];
  /** 按严重度、再按最早步骤排序。 */
  handtraps: HandtrapSummary[];
  /** 每一步的最坏影响（没有手坑能打时为 null）。 */
  stepWorst: Array<Interruption | null>;
  /** 能让展开直接断掉的最早一步（1 起），没有则为 null。 */
  firstComboEnd: number | null;
}

export function analyzeCombo(combo: Combo): ComboAnalysis {
  const hits = deriveInterruptions(combo);
  const stepNo = new Map(combo.steps.map((s, i) => [s.id, i + 1]));
  let normalSummons = 0;
  let specialSummons = 0;
  for (const step of combo.steps) {
    for (const a of step.actions) {
      if (a.type === "activate") continue;
      if (a.summon.method === "normal") normalSummons += 1;
      else specialSummons += 1;
    }
  }

  const byHandtrap = new Map<number, Interruption[]>();
  for (const h of hits) byHandtrap.set(h.handtrap, [...(byHandtrap.get(h.handtrap) ?? []), h]);

  const worseThan = (a: Interruption, b: Interruption) =>
    severityOf(a) - severityOf(b) || stepNo.get(a.stepId)! - stepNo.get(b.stepId)!;

  const handtraps: HandtrapSummary[] = [...byHandtrap].map(([handtrap, list]) => {
    const steps = [...new Set(list.map((h) => stepNo.get(h.stepId)!))].sort((a, b) => a - b);
    return { handtrap, worst: [...list].sort(worseThan)[0], firstStep: steps[0], steps, hits: list };
  });
  handtraps.sort((a, b) => worseThan(a.worst, b.worst));

  const stepWorst = combo.steps.map((s) => {
    const list = hits.filter((h) => h.stepId === s.id).sort(worseThan);
    return list[0] ?? null;
  });
  const endIdx = stepWorst.findIndex((w) => w?.impact === "combo_ends");

  return {
    stepCount: combo.steps.length,
    normalSummons,
    specialSummons,
    hits,
    handtraps,
    stepWorst,
    firstComboEnd: endIdx < 0 ? null : endIdx + 1,
  };
}

/**
 * 吃坑推导：根据 step 里标注的发动/召唤，算出每一步哪些手坑能打、在什么时点打。
 * 作者在 step.interruptions 里手写的说明会覆盖同一手坑的自动结果。
 */
import type { Activation, Combo, EffectTag, InterruptionImpact, Step, StepAction } from "./schema";

export const HT = {
  ASH: 14558127,
  MAXX_C: 23434538,
  IMPERM: 10045474,
  VEILER: 97268402,
  GHOST_OGRE: 59438930,
  DROLL: 94145021,
  NIBIRU: 27204311,
  GHOST_BELLE: 73642296,
  DD_CROW: 24508238,
  CALLED_BY: 24224830,
} as const;

export type Timing =
  | "chain_to_activation" // 连锁这次发动
  | "after_summon" // 召唤成功后
  | "after_resolution"; // 效果处理完之后

export interface Interruption {
  handtrap: number;
  stepId: string;
  /** 命中的是 step.actions 里的第几个动作。 */
  actionIndex: number;
  timing: Timing;
  reason: string;
  /** 作者排的重要性（0 最重要）；没排过的没有这个字段。 */
  rank?: number;
  /** 以下字段只有作者写了说明时才有。 */
  impact?: InterruptionImpact;
  note?: string;
  fallbackStepId?: string;
  fallbackComboId?: string;
}

const has = (a: Activation, ...tags: EffectTag[]) => tags.some((t) => a.effects.includes(t));

const isSpecial = (action: StepAction) =>
  (action.type === "summon" || action.type === "resolve_summon") && action.summon.method !== "normal";

const isSummon = (action: StepAction) => action.type === "summon" || action.type === "resolve_summon";

/** 单个发动能被哪些「连锁型」手坑命中。 */
function activationHits(a: Activation): Array<{ handtrap: number; reason: string }> {
  const hits: Array<{ handtrap: number; reason: string }> = [];
  const name = a.card.name;

  if (has(a, "add_from_deck", "ss_from_deck", "send_from_deck_to_gy")) {
    hits.push({ handtrap: HT.ASH, reason: `${name} 的效果包含从卡组检索/特召/送墓` });
  }
  if (has(a, "add_from_gy", "ss_from_gy", "banish_from_gy")) {
    hits.push({ handtrap: HT.GHOST_BELLE, reason: `${name} 的效果包含从墓地回收/特召/除外` });
  }
  if (a.kind === "monster_effect" && a.from === "monster") {
    hits.push({ handtrap: HT.IMPERM, reason: `${name} 在场上发动效果，可以被无效` });
    hits.push({ handtrap: HT.VEILER, reason: `${name} 在场上发动效果，可以被无效` });
    hits.push({ handtrap: HT.GHOST_OGRE, reason: `${name} 在场上发动效果，可以被破坏（效果仍处理）` });
  }
  if (a.kind === "spell_trap_effect" && a.from === "spell_trap") {
    hits.push({ handtrap: HT.GHOST_OGRE, reason: `${name} 是场上表侧魔陷发动效果，可以被破坏` });
  }
  if (a.from === "gy" || has(a, "target_in_gy")) {
    const why = a.from === "gy" ? `${name} 在墓地发动` : `${name} 以墓地的卡为对象`;
    hits.push({ handtrap: HT.DD_CROW, reason: `${why}，除外相关的卡可以让效果落空` });
    hits.push({ handtrap: HT.CALLED_BY, reason: `${why}，除外相关的怪兽可以让效果落空（需要事先盖放）` });
  }
  return hits;
}

/** 推导整条 combo 的吃坑点，按 step 顺序返回。 */
export function deriveInterruptions(combo: Combo): Interruption[] {
  const out: Interruption[] = [];
  let summons = 0;
  let maxxFlagged = false;
  let nibiruFlagged = false;

  for (const step of combo.steps) {
    const auto: Interruption[] = [];
    step.actions.forEach((action, actionIndex) => {
      if (action.type === "activate") {
        for (const h of activationHits(action.activation)) {
          auto.push({ ...h, stepId: step.id, actionIndex, timing: "chain_to_activation" });
        }
        if (has(action.activation, "add_from_deck")) {
          auto.push({
            handtrap: HT.DROLL,
            stepId: step.id,
            actionIndex,
            timing: "after_resolution",
            reason: `${action.activation.card.name} 从卡组加卡入手后，之后的检索全部被锁`,
          });
        }
      }
      if (isSpecial(action) && !maxxFlagged) {
        maxxFlagged = true;
        auto.push({
          handtrap: HT.MAXX_C,
          stepId: step.id,
          actionIndex,
          timing: "after_summon",
          reason: "本回合第一次特殊召唤，之后每次特召对手都会抽卡",
        });
      }
      if (isSummon(action)) {
        summons += 1;
        if (summons >= 5 && !nibiruFlagged) {
          nibiruFlagged = true;
          auto.push({
            handtrap: HT.NIBIRU,
            stepId: step.id,
            actionIndex,
            timing: "after_summon",
            reason: `这是本回合第 ${summons} 次召唤，从这里开始 Nibiru 可以发动`,
          });
        }
      }
    });
    out.push(...mergeNotes(step, auto));
  }
  return out;
}

const SEVERITY: Record<InterruptionImpact | "unknown", number> = {
  combo_ends: 0,
  reroute: 1,
  reduced_endboard: 2,
  unknown: 3,
  minor: 4,
};

/**
 * 合并作者说明和自动结果：
 * - 作者说明覆盖同一手坑的自动结果，applies=false 的会被移除；只在说明里出现的手坑也会加进来。
 * - 排序：作者排过的按说明顺序在前，其余按影响严重度排在后面。
 */
function mergeNotes(step: Step, auto: Interruption[]): Interruption[] {
  const ranked: Interruption[] = [];
  step.interruptions.forEach((n, rank) => {
    if (!n.applies) return;
    const base: Interruption = auto.find((i) => i.handtrap === n.handtrap) ?? {
      handtrap: n.handtrap,
      stepId: step.id,
      actionIndex: 0,
      timing: "chain_to_activation",
      reason: "作者手动标注",
    };
    ranked.push({
      ...base,
      rank,
      impact: n.impact,
      note: n.note || undefined,
      fallbackStepId: n.fallbackStepId,
      fallbackComboId: n.fallbackComboId,
    });
  });
  const noted = new Set(step.interruptions.map((n) => n.handtrap));
  const seen = new Set<number>();
  const rest = auto
    .filter((i) => !noted.has(i.handtrap) && !seen.has(i.handtrap) && seen.add(i.handtrap))
    .sort((a, b) => SEVERITY[a.impact ?? "unknown"] - SEVERITY[b.impact ?? "unknown"]);
  return [...ranked, ...rest];
}

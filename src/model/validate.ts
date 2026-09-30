/** 结构校验之外的一致性检查：step id、fallback 引用、手坑是否在目录里、卡名是否与 id 对得上。 */
import { BoardError, simulate } from "./board";
import type { CardRef, Combo, Handtrap } from "./schema";

export function collectCardRefs(combo: Combo): CardRef[] {
  const refs: CardRef[] = [...combo.starter, ...combo.requires.deck, ...combo.requires.extra, ...combo.endboard.cards];
  for (const step of combo.steps) {
    for (const a of step.actions) {
      if (a.type === "activate") refs.push(a.activation.card, ...(a.activation.result ?? []));
      else refs.push(a.summon.card, ...(a.summon.materials ?? []));
    }
    for (const m of step.moves) refs.push(m.card);
  }
  return refs;
}

export function checkCombos(combos: Combo[], handtraps: Handtrap[], names?: Map<number, string>): string[] {
  const errors: string[] = [];
  const comboIds = new Set(combos.map((c) => c.id));
  const htIds = new Set(handtraps.map((h) => h.id));
  if (comboIds.size !== combos.length) errors.push("combo id 重复");

  for (const combo of combos) {
    const at = (s: string) => `[${combo.id}] ${s}`;
    const stepIds = new Set(combo.steps.map((s) => s.id));
    if (stepIds.size !== combo.steps.length) errors.push(at("step id 重复"));
    for (const step of combo.steps) {
      for (const n of step.interruptions) {
        if (!htIds.has(n.handtrap)) errors.push(at(`${step.id}: 手坑 ${n.handtrap} 不在 handtraps.json`));
        if (n.fallbackStepId && !stepIds.has(n.fallbackStepId)) errors.push(at(`${step.id}: fallbackStepId ${n.fallbackStepId} 不存在`));
        if (n.fallbackComboId && !comboIds.has(n.fallbackComboId)) errors.push(at(`${step.id}: fallbackComboId ${n.fallbackComboId} 不存在`));
      }
    }
    try {
      simulate(combo);
    } catch (e) {
      if (!(e instanceof BoardError)) throw e;
      errors.push(at(e.message));
    }
    if (names) {
      for (const ref of collectCardRefs(combo)) {
        const real = names.get(ref.id);
        if (real === undefined) errors.push(at(`卡片 ${ref.id}（${ref.name}）在卡牌数据里找不到`));
        else if (real !== ref.name) errors.push(at(`卡片 ${ref.id} 名字不符：写的是「${ref.name}」，实际是「${real}」`));
      }
    }
  }
  if (names) {
    for (const h of handtraps) {
      const real = names.get(h.id);
      if (real !== h.name) errors.push(`handtraps.json: ${h.id} 名字不符：「${h.name}」 vs 「${real}」`);
    }
  }
  return errors;
}

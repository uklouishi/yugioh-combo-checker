import type { EffectTag, InterruptionImpact, SummonMethod, Zone } from "../model/schema";

export const ZONES: Zone[] = ["hand", "deck", "extra", "monster", "emz", "spell_trap", "field_zone", "gy", "banished"];

export const EFFECT_LABEL: Record<EffectTag, string> = {
  add_from_deck: "从卡组加入手卡",
  ss_from_deck: "从卡组特召",
  send_from_deck_to_gy: "从卡组送墓",
  set_from_deck: "从卡组盖放",
  add_from_gy: "从墓地回收",
  ss_from_gy: "从墓地特召",
  banish_from_gy: "除外墓地的卡",
  ss_from_hand: "从手卡特召",
  ss_from_banished: "从除外特召",
  place_as_continuous_spell: "当作永续魔法放置",
  negate: "无效",
  destroy: "破坏",
  banish: "除外",
  draw: "抽卡",
  target_in_gy: "以墓地的卡为对象",
};

export const METHOD_LABEL: Record<SummonMethod, string> = {
  normal: "通常召唤",
  special: "特殊召唤",
  link: "连接召唤",
  xyz: "超量召唤",
  synchro: "同调召唤",
  fusion: "融合召唤",
  ritual: "仪式召唤",
  pendulum: "灵摆召唤",
};

export const KIND_LABEL = {
  monster_effect: "怪兽效果",
  spell_card: "魔法卡发动",
  trap_card: "陷阱卡发动",
  spell_trap_effect: "魔陷的效果",
} as const;

export const IMPACT_OPTIONS: Array<[InterruptionImpact, string]> = [
  ["combo_ends", "直接断"],
  ["reroute", "有备用路线"],
  ["reduced_endboard", "终场变弱"],
  ["minor", "影响小"],
];

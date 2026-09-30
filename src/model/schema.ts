/**
 * Combo 数据模型（单一事实来源）。
 *
 * 一条 combo = 某卡组在某个 starter（起手）下的一条展开路线，由有序的 step 组成。
 * 每个 step 描述「做了什么」以及「这一步里有哪些对手可以响应的时点」，
 * 手坑能否命中由 ./interruptions.ts 根据这些标签自动推导，
 * 作者也可以在 step.interruptions 里手写补充说明（被打断后的影响、备用路线）。
 *
 * 卡牌统一用 passcode（卡片密码，YGOPRODeck 的 id）引用。
 */
import { z } from "zod";

/** 卡片密码。YGOPRODeck / ygopro 数据库通用。 */
export const CardId = z.number().int().positive();
export type CardId = z.infer<typeof CardId>;

/** 卡牌所在区域。 */
export const Zone = z.enum([
  "hand",
  "deck",
  "extra",
  "monster", // 主要怪兽区（5 格）
  "emz", // 额外怪兽区（2 格）
  "spell_trap", // 魔陷区（含当作永续魔法放置的怪兽）
  "field_zone",
  "gy",
  "banished",
]);
export type Zone = z.infer<typeof Zone>;

/**
 * 一次「发动」中包含的效果处理，用来判断哪些手坑能命中。
 * 按卡片文本如实标注：比如 Ash Blossom 只看「是否包含从卡组检索/特召/送墓」。
 */
export const EffectTag = z.enum([
  "add_from_deck", // 从卡组加入手卡（检索）
  "ss_from_deck", // 从卡组特殊召唤
  "send_from_deck_to_gy", // 从卡组送去墓地
  "set_from_deck", // 从卡组盖放（Ash Blossom 不命中）
  "add_from_gy", // 从墓地回收到手卡/卡组/额外
  "ss_from_gy", // 从墓地特殊召唤
  "banish_from_gy", // 除外墓地的卡
  "ss_from_hand",
  "ss_from_banished",
  "place_as_continuous_spell",
  "negate",
  "destroy",
  "banish",
  "draw",
  "target_in_gy", // 以墓地的卡为对象
]);
export type EffectTag = z.infer<typeof EffectTag>;

export const SummonMethod = z.enum([
  "normal",
  "special", // 效果特召 / 自身规则特召
  "link",
  "xyz",
  "synchro",
  "fusion",
  "ritual",
  "pendulum",
]);
export type SummonMethod = z.infer<typeof SummonMethod>;

/** 卡牌引用：id 是必须的，name 只为了 JSON 可读性，校验脚本会核对它。 */
export const CardRef = z.object({
  id: CardId,
  name: z.string(),
});
export type CardRef = z.infer<typeof CardRef>;

/** 一次召唤（算入 Nibiru 的 5 次计数）。 */
export const Summon = z.object({
  card: CardRef,
  method: SummonMethod,
  from: Zone,
  /** 素材 / 解放 / cost，按顺序。 */
  materials: z.array(CardRef).optional(),
});
export type Summon = z.infer<typeof Summon>;

/** 一次卡片发动（怪兽效果 / 魔陷发动 / 魔陷效果）。 */
export const Activation = z.object({
  card: CardRef,
  /** 发动时卡片所在区域：决定 Ghost Ogre、Infinite Impermanence、Effect Veiler 等能否命中。 */
  from: Zone,
  kind: z.enum(["monster_effect", "spell_card", "trap_card", "spell_trap_effect"]),
  /** 这张卡的第几个效果（按卡片文本顺序，1 起），方便 UI 高亮文本。 */
  effectIndex: z.number().int().positive().optional(),
  /** 该效果包含的处理，决定哪些手坑能命中。 */
  effects: z.array(EffectTag),
  /** cost（发动时就已支付，无效发动也拿不回来）。 */
  cost: z.string().optional(),
  /** 这次发动是连锁的第几环（1 起）。不写时播放按同一步里发动的先后顺序编号。 */
  chainLink: z.number().int().positive().optional(),
  /** 效果处理结果，比如检索到的卡。 */
  result: z.array(CardRef).optional(),
});
export type Activation = z.infer<typeof Activation>;

export const StepAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("summon"), summon: Summon }),
  z.object({ type: z.literal("activate"), activation: Activation }),
  /** 效果处理后产生的召唤，与 activate 分开写，便于 Nibiru/Maxx "C" 计数。 */
  z.object({ type: z.literal("resolve_summon"), summon: Summon }),
]);
export type StepAction = z.infer<typeof StepAction>;

/** 被某张手坑打断后的后果。 */
export const InterruptionImpact = z.enum([
  "combo_ends", // 展开直接断掉
  "reduced_endboard", // 能继续，但终场变弱
  "minor", // 基本无影响
  "reroute", // 有备用路线（见 fallbackComboId / fallbackStepId）
]);
export type InterruptionImpact = z.infer<typeof InterruptionImpact>;

/** 作者手写的吃坑说明，覆盖/补充自动推导结果。 */
/**
 * 作者对某一步某张手坑的说明。同一步里说明的先后顺序就是重要性排序（越靠前越重要）。
 */
export const InterruptionNote = z.object({
  handtrap: CardId,
  /** 不写表示还没评估。 */
  impact: InterruptionImpact.optional(),
  /** 为什么能/不能打，打了之后怎么办。留空时显示自动推导的理由。 */
  note: z.string().default(""),
  /** false 表示「自动推导说能打，但实际上不值得/不能」。 */
  applies: z.boolean().default(true),
  fallbackStepId: z.string().optional(),
  fallbackComboId: z.string().optional(),
});
export type InterruptionNote = z.infer<typeof InterruptionNote>;

/**
 * 一次卡片移动，场地界面按顺序执行这些移动得到每一步之后的局面。
 * slot 是格子编号（怪兽区/魔陷区 0-4 从左到右，额外怪兽区 0-1），不写就放进第一个空格。
 */
export const Move = z.object({
  card: CardRef,
  from: Zone,
  to: Zone,
  slot: z.number().int().min(0).max(4).optional(),
  /** 从有格子的区域移走时，原来在第几格（同名卡在多个格子里时用来分清是哪一张）。 */
  fromSlot: z.number().int().min(0).max(4).optional(),
  /** 里侧（盖放）。 */
  faceDown: z.boolean().optional(),
  /** 守备表示。 */
  defense: z.boolean().optional(),
  /**
   * 这次移动发生在这一步的第几个 action 之后（0 = 第一个 action 之前）。
   * 不写时播放把它放在所有 action 之后。实战练习导出时会记下。
   */
  afterAction: z.number().int().min(0).optional(),
  /** 移动发生时正在处理的连锁环（比如 2 表示 CHAIN 2 的效果处理中）。 */
  resolving: z.number().int().positive().optional(),
});
export type Move = z.infer<typeof Move>;

export const Step = z.object({
  id: z.string(),
  /** 一句话描述，UI 直接展示。 */
  title: z.string(),
  actions: z.array(StepAction).min(1),
  /** 这一步里卡片的移动，按发生顺序。 */
  moves: z.array(Move).default([]),
  interruptions: z.array(InterruptionNote).default([]),
  notes: z.string().optional(),
});
export type Step = z.infer<typeof Step>;

export const Combo = z.object({
  id: z.string(),
  deck: z.string(),
  title: z.string(),
  /** 起手：必须在手的卡（其余手卡视为无关卡）。 */
  starter: z.array(CardRef).min(1),
  /** 展开会用到、需要在卡组/额外里的卡。 */
  requires: z
    .object({
      deck: z.array(CardRef).default([]),
      extra: z.array(CardRef).default([]),
    })
    .default({ deck: [], extra: [] }),
  /** 起手手卡数（starter 之外的视为无关卡），主卡组张数。 */
  handSize: z.number().int().min(1).default(5),
  deckSize: z.number().int().min(40).max(60).default(40),
  steps: z.array(Step).min(1),
  endboard: z.object({
    cards: z.array(CardRef),
    description: z.string(),
  }),
  /** 数据来源 / 参考链接，以及可信度说明。 */
  sources: z.array(z.string()).default([]),
  format: z.enum(["TCG", "OCG", "MD"]).default("TCG"),
  updatedAt: z.string(),
});
export type Combo = z.infer<typeof Combo>;

/** 手坑目录条目：命中规则在 interruptions.ts 里按 id 实现。 */
export const Handtrap = z.object({
  id: CardId,
  name: z.string(),
  /** 一句话中文说明：什么时候能打。 */
  summary: z.string(),
});
export type Handtrap = z.infer<typeof Handtrap>;

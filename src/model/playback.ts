/**
 * 播放一步时的分镜：把一个 step 拆成一拍一拍（发动、召唤、每一次卡片移动），
 * 每一拍带着那一刻的局面、一句说明和正在连锁中的卡，界面按顺序播放。
 */
import { applyMove, clone, locate, zoneName, type Board, type Loc } from "./board";
import type { CardRef, Move, Step, StepAction, SummonMethod, Zone } from "./schema";

export interface ChainMark {
  link: number;
  card: CardRef;
  /** 这张卡现在在哪（跟着移动更新）；找不到时为 null。 */
  loc: Loc | null;
}

export interface Beat {
  kind: "activate" | "summon" | "resolve" | "move";
  /** 这一拍之后的局面。 */
  board: Board;
  caption: string;
  /** 当前连锁里的卡（CHAIN 1 在前）。 */
  chain: ChainMark[];
  /** 刚发动的那一环。 */
  active?: number;
  /** kind 为 move 时：这次移动和卡的起点、终点。 */
  move?: Move;
  from?: Loc;
  to?: Loc;
}

const CIRCLED = "①②③④⑤⑥⑦⑧⑨";

const SUMMON: Record<SummonMethod, string> = {
  normal: "通常召唤",
  special: "特殊召唤",
  link: "连接召唤",
  xyz: "超量召唤",
  synchro: "同调召唤",
  fusion: "融合召唤",
  ritual: "仪式召唤",
  pendulum: "灵摆召唤",
};

const onField = (z: Zone) => z === "monster" || z === "emz";

/** 用新手能看懂的话描述一次移动。 */
export function describeMove(m: Move): string {
  const name = m.card.name;
  if (m.to === "gy") return `${name} 从${zoneName(m.from)}送去墓地`;
  if (m.to === "banished") return `${name} 从${zoneName(m.from)}除外`;
  if (m.from === "deck" && m.to === "hand") return `${name} 从卡组加入手卡`;
  if (m.to === "hand") return `${name} 从${zoneName(m.from)}回到手卡`;
  if (onField(m.to)) return `${name} 从${zoneName(m.from)}${m.faceDown ? "里侧" : ""}出场到${zoneName(m.to)}`;
  if (m.to === "spell_trap") {
    if (m.faceDown) return `${name} 盖放到魔陷区`;
    return m.from === "hand" ? `${name} 从手卡放到魔陷区` : `${name} 从${zoneName(m.from)}放到魔陷区`;
  }
  if (m.to === "field_zone") return `${name} 放到场地区`;
  return `${name} 从${zoneName(m.from)}回到${zoneName(m.to)}`;
}

/** 一次发动的说明：哪张卡、第几个效果、在哪里发动。 */
export function describeActivation(a: Extract<StepAction, { type: "activate" }>["activation"]): string {
  const eff = a.effectIndex ? ` ${CIRCLED[a.effectIndex - 1] ?? a.effectIndex} 效果` : "效果";
  if (a.kind === "spell_card") return `从手卡发动魔法卡 ${a.card.name}`;
  if (a.kind === "trap_card") return `发动陷阱卡 ${a.card.name}`;
  return `${a.card.name} 在${zoneName(a.from)}发动${eff}`;
}

export function describeSummon(s: Extract<StepAction, { type: "summon" }>["summon"]): string {
  const mats = s.materials?.length ? `（素材：${s.materials.map((c) => c.name).join("、")}）` : "";
  return `${SUMMON[s.method]} ${s.card.name}${mats}`;
}

/** 从 before 局面开始，把 step 拆成一拍一拍。最后一拍的局面等于这一步之后的局面。 */
export function buildBeats(step: Step, before: Board): Beat[] {
  const board = clone(before);
  const beats: Beat[] = [];
  let chain: ChainMark[] = [];
  let resolveAnnounced = false;
  // 当前连锁一共几环（处理时标记会一环环去掉，说明里仍按这个判断要不要写 CHAIN n）
  let chainSize = 0;
  const done = new Set<number>();
  const timed = step.moves.some((m) => m.afterAction !== undefined);
  const materials = new Set(step.actions.flatMap((a) => (a.type === "activate" ? [] : (a.summon.materials ?? []).map((c) => c.id))));

  const push = (b: Omit<Beat, "board" | "chain">) => beats.push({ ...b, board: clone(board), chain: chain.map((c) => ({ ...c })) });

  const announceResolve = () => {
    if (resolveAnnounced || chain.length === 0) return;
    resolveAnnounced = true;
    const top = Math.max(...chain.map((c) => c.link));
    push({
      kind: "resolve",
      caption: top > 1 ? `连锁从 CHAIN ${top} 开始倒着处理，最后处理 CHAIN 1` : "没有被连锁，开始处理效果",
    });
  };

  const doMove = (i: number, caption?: string) => {
    const m = step.moves[i];
    done.add(i);
    if (m.resolving !== undefined) {
      announceResolve();
      // 处理到这一环时，后面的环已经处理完了
      chain = chain.filter((c) => c.link <= m.resolving!);
    }
    const { from, to } = applyMove(board, m);
    for (const c of chain) {
      if (c.card.id === m.card.id && c.loc?.zone === from.zone && c.loc.index === from.index) c.loc = to;
    }
    const prefix = m.resolving !== undefined && chainSize > 1 ? `CHAIN ${m.resolving} 处理：` : "";
    const text = materials.has(m.card.id) && m.to === "gy" && onField(m.from) ? `${m.card.name} 作为素材送去墓地` : describeMove(m);
    push({ kind: "move", caption: caption ?? prefix + text, move: m, from, to });
  };

  const movesAfter = (k: number) => {
    step.moves.forEach((m, i) => {
      if (!done.has(i) && m.afterAction === k) doMove(i);
    });
  };

  step.actions.forEach((action, k) => {
    // 召唤先报出来再演示素材和出场；发动前的移动（比如魔陷放到场上）先演示
    if (timed && action.type !== "summon") movesAfter(k);
    if (action.type === "activate") {
      const a = action.activation;
      // 从手卡发动的魔陷先放到场上
      if (!timed && (a.kind === "spell_card" || a.kind === "trap_card")) {
        const i = step.moves.findIndex((m, j) => !done.has(j) && m.card.id === a.card.id && m.from === "hand" && (m.to === "spell_trap" || m.to === "field_zone"));
        if (i >= 0) doMove(i, `${a.card.name} 从手卡放到场上`);
      }
      const link = a.chainLink ?? chain.length + 1;
      if (link === 1) {
        chain = [];
        resolveAnnounced = false;
      }
      chain.push({ link, card: a.card, loc: locate(board, a.card.id, a.from) });
      chainSize = link;
      const cost = a.cost ? `，代价：${a.cost}` : "";
      push({ kind: "activate", caption: `CHAIN ${link}　${describeActivation(a)}${cost}`, active: link });
      // 没记时点时：代价里写到的卡在发动时就送走了
      if (!timed && a.cost) {
        step.moves.forEach((m, i) => {
          if (!done.has(i) && (m.to === "gy" || m.to === "banished") && a.cost!.includes(m.card.name)) doMove(i, `支付代价：${describeMove(m)}`);
        });
      }
    } else if (action.type === "summon") {
      push({ kind: "summon", caption: describeSummon(action.summon) });
      if (timed) movesAfter(k);
    }
  });

  // 没有记时点的移动：都当作效果处理（或召唤）时发生
  const rest = step.moves.map((_, i) => i).filter((i) => !done.has(i));
  if (!timed && rest.length && step.actions.some((a) => a.type === "activate")) announceResolve();
  for (const i of rest) doMove(i);

  if (beats.length === 0) push({ kind: "summon", caption: step.title });
  return beats;
}

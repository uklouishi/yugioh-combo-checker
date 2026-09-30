import type { CardInfo } from "../cards/ygoprodeck";
import type { Board, Loc, PlacedCard } from "../model/board";
import type { ChainMark } from "../model/playback";
import type { Move, Zone } from "../model/schema";
import { CardView } from "./CardView";

interface Ctx {
  cards: Map<number, CardInfo>;
  moved: Move[];
  onOpen: (id: number) => void;
  /** 播放时正在连锁中的卡，显示 CHAIN 序号。 */
  chain?: ChainMark[];
  /** 刚发动的那一环。 */
  active?: number;
}

const sameLoc = (a: Loc | null, zone: Zone, index?: number) => !!a && a.zone === zone && a.index === index;

/** 这个格子上的连锁标记：CHAIN 序号，刚发动的那张加光圈。 */
function ChainBadges({ ctx, zone, index }: { ctx: Ctx; zone: Zone; index?: number }) {
  const marks = (ctx.chain ?? []).filter((c) => sameLoc(c.loc, zone, index));
  if (!marks.length) return null;
  return (
    <span className="link-badges">
      {marks.map((c) => (
        <span key={c.link} className={`link-badge${c.link === ctx.active ? " active" : ""}`}>
          CHAIN {c.link}
        </span>
      ))}
    </span>
  );
}

const slotClass = (ctx: Ctx, base: string, zone: Zone, index?: number) =>
  (ctx.chain ?? []).some((c) => c.link === ctx.active && sameLoc(c.loc, zone, index)) ? `${base} activating` : base;

const movedTo = (ctx: Ctx, zone: Zone, id: number) => ctx.moved.some((m) => m.to === zone && m.card.id === id);

function Placed({ ctx, placed, zone, hidden }: { ctx: Ctx; placed: PlacedCard; zone: Zone; hidden?: boolean }) {
  return (
    <CardView
      id={placed.card.id}
      name={placed.card.name}
      info={ctx.cards.get(placed.card.id)}
      faceDown={hidden || placed.faceDown}
      defense={placed.defense}
      moved={movedTo(ctx, zone, placed.card.id)}
      onOpen={ctx.onOpen}
    />
  );
}

function Slot({ ctx, placed, zone, index, label }: { ctx: Ctx; placed: PlacedCard | null; zone: Zone; index: number; label: string }) {
  return (
    <div className={slotClass(ctx, "slot", zone, index)} data-z={`${zone}:${index}`}>
      {placed ? <Placed ctx={ctx} placed={placed} zone={zone} /> : <span className="zlabel">{label}</span>}
      <ChainBadges ctx={ctx} zone={zone} index={index} />
    </div>
  );
}

/** 墓地、除外、额外卡组：显示最上面一张和张数。 */
function Pile({ ctx, pile, zone, label, hidden }: { ctx: Ctx; pile: PlacedCard[]; zone: Zone; label: string; hidden?: boolean }) {
  const top = pile.at(-1);
  return (
    <div className={slotClass(ctx, "slot pile", zone)} title={`${label}（${pile.length}）`} data-z={zone}>
      {top ? <Placed ctx={ctx} placed={top} zone={zone} hidden={hidden} /> : <span className="zlabel">{label}</span>}
      {pile.length > 0 && <span className="count">{pile.length}</span>}
      <ChainBadges ctx={ctx} zone={zone} />
    </div>
  );
}

function Deck({ count, label, mine }: { count: number; label: string; mine?: boolean }) {
  return (
    <div className="slot pile" title={`${label}（${count}）`} data-z={mine ? "deck" : undefined}>
      {count > 0 ? (
        <div className="card">
          <div className="back" />
        </div>
      ) : (
        <span className="zlabel">{label}</span>
      )}
      {count > 0 && <span className="count">{count}</span>}
    </div>
  );
}

const Empty = ({ label }: { label: string }) => (
  <div className="slot">
    <span className="zlabel">{label}</span>
  </div>
);
const Gap = () => <div className="slot empty-col" aria-hidden />;
const FIVE = [0, 1, 2, 3, 4];

interface Props extends Ctx {
  board: Board;
}

/** 双方场地：对手在上（与自己点对称），中间是额外怪兽区，自己在下，再下面是手卡。 */
export function Field({ board, ...ctx }: Props) {
  return (
    <>
      <div className="mat-scroll">
        <div className="mat" aria-label="决斗场地">
          <div className="side-label">对手（先攻展开时为空）</div>
          {/* 对手魔陷行：卡组 | 魔陷×5 | 额外 */}
          <Deck count={0} label="卡组" />
          {FIVE.map((i) => (
            <Empty key={`os${i}`} label="魔陷" />
          ))}
          <Empty label="额外" />
          {/* 对手怪兽行：墓地 | 怪兽×5 | 场地 */}
          <Empty label="墓地" />
          {FIVE.map((i) => (
            <Empty key={`om${i}`} label="怪兽" />
          ))}
          <Empty label="场地" />

          {/* 中间：对手除外 | 额外怪兽区×2 | 自己除外 */}
          <div className="divider" />
          <Empty label="除外" />
          <Gap />
          <Slot ctx={ctx} placed={board.emz[0]} zone="emz" index={0} label="额外怪兽" />
          <Gap />
          <Slot ctx={ctx} placed={board.emz[1]} zone="emz" index={1} label="额外怪兽" />
          <Gap />
          <Pile ctx={ctx} pile={board.banished} zone="banished" label="除外" />
          <div className="divider" />

          {/* 自己怪兽行：场地 | 怪兽×5 | 墓地 */}
          <Slot ctx={ctx} placed={board.field_zone[0]} zone="field_zone" index={0} label="场地" />
          {FIVE.map((i) => (
            <Slot key={`m${i}`} ctx={ctx} placed={board.monster[i]} zone="monster" index={i} label="怪兽" />
          ))}
          <Pile ctx={ctx} pile={board.gy} zone="gy" label="墓地" />
          {/* 自己魔陷行：额外卡组 | 魔陷×5 | 卡组 */}
          <Pile ctx={ctx} pile={board.extra} zone="extra" label="额外" hidden />
          {FIVE.map((i) => (
            <Slot key={`s${i}`} ctx={ctx} placed={board.spell_trap[i]} zone="spell_trap" index={i} label="魔陷" />
          ))}
          <Deck count={board.deckCount} label="卡组" mine />
          <div className="side-label">自己</div>
        </div>
      </div>

      <div className="hand-row">
        <span className="label">手卡（{board.hand.length + board.otherHand} 张）</span>
        {board.hand.map((p, i) => (
          <div className={slotClass(ctx, "slot", "hand", i)} key={`${p.card.id}-${i}`} data-z={`hand:${i}`}>
            <Placed ctx={ctx} placed={p} zone="hand" />
            <ChainBadges ctx={ctx} zone="hand" index={i} />
          </div>
        ))}
        {Array.from({ length: board.otherHand }, (_, i) => (
          <div className="slot" key={`other-${i}`} title="其他手卡">
            <div className="card">
              <div className="back" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

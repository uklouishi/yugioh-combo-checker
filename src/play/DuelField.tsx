import { OcgLocation } from "ocgcore-wasm";
import { useRef } from "react";
import type { EngineData } from "../engine/data";
import type { FieldCard, PlayerField } from "../engine/session";
import { CardView } from "../ui/CardView";

export interface CardLoc {
  controller: number;
  location: number;
  sequence: number;
}

export const locKey = (l: CardLoc) => `${l.controller}-${l.location}-${l.sequence}`;

interface Ctx {
  data: EngineData;
  /** 当前提示里可以点的卡（locKey）。 */
  active: Set<string>;
  /** 点了场上 / 手里的卡。el 用来把操作按钮放在卡上。 */
  onCard: (loc: CardLoc, code: number, el: HTMLElement) => void;
  onPile: (title: string, cards: FieldCard[], controller: number, location: number) => void;
  /** 当前选中的卡（显示操作按钮的那张）。 */
  selected?: string | null;
  /** 选择放置区域时可以点的空格（locKey）。 */
  places?: Set<string>;
  onZone?: (loc: CardLoc) => void;
  /** 手卡按下时开始拖拽；返回 false 表示这张卡现在不能拖。 */
  onDragStart?: (loc: CardLoc, code: number, e: React.PointerEvent<HTMLElement>) => boolean;
  /** 可以拖出去的手卡（locKey）。 */
  draggable?: Set<string>;
  /** 拖拽中手指 / 鼠标下面的区域。 */
  dropHover?: string | null;
  /** 可以从额外卡组特殊召唤的怪兽数，大于 0 时额外卡组区域发光提示。 */
  extraReady?: number;
}

const FACEDOWN = 0x2 | 0x8;
const DEFENSE = 0x4 | 0x8;

function Card({ ctx, card, loc, hidden }: { ctx: Ctx; card: FieldCard; loc: CardLoc; hidden?: boolean }) {
  const key = locKey(loc);
  const isActive = ctx.active.has(key);
  const ref = useRef<HTMLDivElement>(null);
  const onField = loc.location === OcgLocation.MZONE || loc.location === OcgLocation.SZONE;
  const faceDown = onField && (card.position & FACEDOWN) !== 0;
  const name = ctx.data.name(card.code);
  return (
    <div
      ref={ref}
      className={`fcard${isActive ? " active" : ""}${ctx.selected === key ? " selected" : ""}${faceDown && !hidden ? " set" : ""}`}
      onPointerDown={loc.location === OcgLocation.HAND && ctx.onDragStart ? (e) => ctx.onDragStart!(loc, card.code, e) : undefined}
    >
      <CardView
        id={card.code}
        name={name}
        faceDown={hidden}
        defense={loc.location === OcgLocation.MZONE && (card.position & DEFENSE) !== 0}
        onOpen={() => ref.current && ctx.onCard(loc, card.code, ref.current)}
      />
      {card.overlays.length > 0 && <span className="count">{card.overlays.length}</span>}
    </div>
  );
}

function Zone({ ctx, card, loc, label }: { ctx: Ctx; card: FieldCard | null; loc: CardLoc; label: string }) {
  const key = locKey(loc);
  const placeable = ctx.places?.has(key);
  const cls = `slot${placeable ? " placeable" : ""}${ctx.dropHover === key ? " drop-hover" : ""}`;
  if (placeable)
    return (
      <div
        className={cls}
        data-zone={key}
        role="button"
        tabIndex={0}
        aria-label={`放到${label}`}
        onClickCapture={(e) => {
          e.stopPropagation();
          ctx.onZone?.(loc);
        }}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && ctx.onZone?.(loc)}
      >
        {card ? <Card ctx={ctx} card={card} loc={loc} /> : <span className="zlabel">{label}</span>}
      </div>
    );
  return (
    <div className={cls} data-zone={key}>
      {card ? <Card ctx={ctx} card={card} loc={loc} /> : <span className="zlabel">{label}</span>}
    </div>
  );
}

function Pile({ ctx, cards, controller, location, label, hidden }: { ctx: Ctx; cards: FieldCard[]; controller: number; location: number; label: string; hidden?: boolean }) {
  const top = cards.at(-1);
  const anyActive = cards.some((_, i) => ctx.active.has(locKey({ controller, location, sequence: i })));
  const guide = controller === 0 && location === OcgLocation.EXTRA && (ctx.extraReady ?? 0) > 0;
  return (
    <button
      className={`slot pile${anyActive ? " has-active" : ""}${guide ? " guide" : ""}`}
      title={`${label}（${cards.length}）`}
      onClick={() => ctx.onPile(label, cards, controller, location)}
      disabled={cards.length === 0}
    >
      {top ? <div className="card">{hidden ? <div className="back" /> : <CardView id={top.code} name={ctx.data.name(top.code)} />}</div> : <span className="zlabel">{label}</span>}
      {cards.length > 0 && <span className="count">{cards.length}</span>}
      {guide && <span className="guide-tip">可特召 {ctx.extraReady}</span>}
    </button>
  );
}

function DeckPile({ count, label }: { count: number; label: string }) {
  return (
    <div className="slot pile" title={`${label}（${count}）`}>
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

const Gap = () => <div className="slot empty-col" aria-hidden />;
const FIVE = [0, 1, 2, 3, 4];

interface Props extends Ctx {
  me: PlayerField;
  opp: PlayerField;
  lp: [number, number];
}

/** 双方场地。对手在上且点对称：对手的额外怪兽区 5/6 分别在我方视角的右/左。 */
export function DuelField({ me, opp, lp, ...ctx }: Props) {
  const M = OcgLocation.MZONE;
  const S = OcgLocation.SZONE;
  const emz = (mine: 5 | 6, theirs: 5 | 6) => {
    if (opp.monsters[theirs]) return <Zone ctx={ctx} card={opp.monsters[theirs]} loc={{ controller: 1, location: M, sequence: theirs }} label="额外怪兽" />;
    return <Zone ctx={ctx} card={me.monsters[mine]} loc={{ controller: 0, location: M, sequence: mine }} label="额外怪兽" />;
  };
  return (
    <div className="duel-field">
      <div className="opp-hand">
        <span className="label">
          对手 LP {lp[1]} · 手卡 {opp.hand.length}
        </span>
        {opp.hand.map((c, i) => (
          <div className="slot" key={`oh${i}`}>
            <Card ctx={ctx} card={c} loc={{ controller: 1, location: OcgLocation.HAND, sequence: i }} />
          </div>
        ))}
      </div>
      <div className="mat-scroll">
        <div className="mat" aria-label="决斗场地" data-zone="mat">
          <DeckPile count={opp.deck} label="卡组" />
          {FIVE.map((i) => (
            <Zone key={`os${i}`} ctx={ctx} card={opp.spells[4 - i]} loc={{ controller: 1, location: S, sequence: 4 - i }} label="魔陷" />
          ))}
          <Pile ctx={ctx} cards={opp.extra} controller={1} location={OcgLocation.EXTRA} label="额外" hidden />
          <Pile ctx={ctx} cards={opp.grave} controller={1} location={OcgLocation.GRAVE} label="墓地" />
          {FIVE.map((i) => (
            <Zone key={`om${i}`} ctx={ctx} card={opp.monsters[4 - i]} loc={{ controller: 1, location: M, sequence: 4 - i }} label="怪兽" />
          ))}
          <Zone ctx={ctx} card={opp.spells[5]} loc={{ controller: 1, location: S, sequence: 5 }} label="场地" />

          <div className="divider" />
          <Pile ctx={ctx} cards={opp.banished} controller={1} location={OcgLocation.REMOVED} label="除外" />
          <Gap />
          {emz(5, 6)}
          <Gap />
          {emz(6, 5)}
          <Gap />
          <Pile ctx={ctx} cards={me.banished} controller={0} location={OcgLocation.REMOVED} label="除外" />
          <div className="divider" />

          <Zone ctx={ctx} card={me.spells[5]} loc={{ controller: 0, location: S, sequence: 5 }} label="场地" />
          {FIVE.map((i) => (
            <Zone key={`m${i}`} ctx={ctx} card={me.monsters[i]} loc={{ controller: 0, location: M, sequence: i }} label="怪兽" />
          ))}
          <Pile ctx={ctx} cards={me.grave} controller={0} location={OcgLocation.GRAVE} label="墓地" />
          <Pile ctx={ctx} cards={me.extra} controller={0} location={OcgLocation.EXTRA} label="额外" />
          {FIVE.map((i) => (
            <Zone key={`s${i}`} ctx={ctx} card={me.spells[i]} loc={{ controller: 0, location: S, sequence: i }} label="魔陷" />
          ))}
          <DeckPile count={me.deck} label="卡组" />
        </div>
      </div>
      <div className="hand-row">
        <span className="label">
          自己 LP {lp[0]} · 手卡 {me.hand.length}
        </span>
        {me.hand.map((c, i) => (
          <div className={`slot${ctx.draggable?.has(locKey({ controller: 0, location: OcgLocation.HAND, sequence: i })) ? " draggable" : ""}`} key={`h${i}`}>
            <Card ctx={ctx} card={c} loc={{ controller: 0, location: OcgLocation.HAND, sequence: i }} />
          </div>
        ))}
      </div>
    </div>
  );
}

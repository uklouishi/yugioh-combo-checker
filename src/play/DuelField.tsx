import { OcgLocation } from "ocgcore-wasm";
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
  onCard: (loc: CardLoc, code: number) => void;
  onPile: (title: string, cards: FieldCard[], controller: number, location: number) => void;
}

const FACEDOWN = 0x2 | 0x8;
const DEFENSE = 0x4 | 0x8;

function Card({ ctx, card, loc, hidden }: { ctx: Ctx; card: FieldCard; loc: CardLoc; hidden?: boolean }) {
  const key = locKey(loc);
  const isActive = ctx.active.has(key);
  const onField = loc.location === OcgLocation.MZONE || loc.location === OcgLocation.SZONE;
  const faceDown = onField && (card.position & FACEDOWN) !== 0;
  const name = ctx.data.name(card.code);
  return (
    <div className={`fcard${isActive ? " active" : ""}${faceDown && !hidden ? " set" : ""}`}>
      <CardView
        id={card.code}
        name={name}
        faceDown={hidden}
        defense={loc.location === OcgLocation.MZONE && (card.position & DEFENSE) !== 0}
        onOpen={() => ctx.onCard(loc, card.code)}
      />
      {card.overlays.length > 0 && <span className="count">{card.overlays.length}</span>}
    </div>
  );
}

function Zone({ ctx, card, loc, label }: { ctx: Ctx; card: FieldCard | null; loc: CardLoc; label: string }) {
  return <div className="slot">{card ? <Card ctx={ctx} card={card} loc={loc} /> : <span className="zlabel">{label}</span>}</div>;
}

function Pile({ ctx, cards, controller, location, label, hidden }: { ctx: Ctx; cards: FieldCard[]; controller: number; location: number; label: string; hidden?: boolean }) {
  const top = cards.at(-1);
  const anyActive = cards.some((_, i) => ctx.active.has(locKey({ controller, location, sequence: i })));
  return (
    <button
      className={`slot pile${anyActive ? " has-active" : ""}`}
      title={`${label}（${cards.length}）`}
      onClick={() => ctx.onPile(label, cards, controller, location)}
      disabled={cards.length === 0}
    >
      {top ? (
        <div className="card">{hidden ? <div className="back" /> : <CardView id={top.code} name={ctx.data.name(top.code)} />}</div>
      ) : (
        <span className="zlabel">{label}</span>
      )}
      {cards.length > 0 && <span className="count">{cards.length}</span>}
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
    if (me.monsters[mine]) return <Zone ctx={ctx} card={me.monsters[mine]} loc={{ controller: 0, location: M, sequence: mine }} label="额外怪兽" />;
    return <Zone ctx={ctx} card={opp.monsters[theirs]} loc={{ controller: 1, location: M, sequence: theirs }} label="额外怪兽" />;
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
        <div className="mat" aria-label="决斗场地">
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
          <div className="slot" key={`h${i}`}>
            <Card ctx={ctx} card={c} loc={{ controller: 0, location: OcgLocation.HAND, sequence: i }} />
          </div>
        ))}
      </div>
    </div>
  );
}

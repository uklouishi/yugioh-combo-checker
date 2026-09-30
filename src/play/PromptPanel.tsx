import { OcgMessageType, OcgResponseType, type OcgResponse } from "ocgcore-wasm";
import { useEffect, useMemo, useState } from "react";
import type { EngineData } from "../engine/data";
import { autoRespond, freePlaces, locName, type Prompt } from "../engine/session";
import { CardView } from "../ui/CardView";
import { activationText, cardActions } from "./cardActions";
import { locKey, type CardLoc } from "./DuelField";
import { ATTRIBUTES, describe, placeLabel, POSITION_LABEL, RACES } from "./text";

interface Props {
  data: EngineData;
  prompt: Prompt;
  /** 在场上点过的卡，空闲时把它的操作排到最前面。 */
  focus: string | null;
  /** 在场上点卡时，如果是当前可选的卡，直接交给这里处理。 */
  pickRef: { current: ((loc: CardLoc) => boolean) | null };
  onRespond: (r: OcgResponse) => void;
  /** 标题栏右侧额外的按钮（悬浮窗的收起）。 */
  headerExtra?: React.ReactNode;
  className?: string;
}

interface Choice {
  label: string;
  response: OcgResponse;
}

function Thumb({ data, code }: { data: EngineData; code: number }) {
  return (
    <span className="pthumb">
      <CardView id={code} name={data.name(code)} />
    </span>
  );
}

/** 当前要做的选择。每种引擎提示对应一种界面；任何时候都可以点「自动」交给默认选择。 */
export function PromptPanel({ data, prompt, focus, pickRef, onRespond, headerExtra, className }: Props) {
  const m = prompt.msg;
  const [picked, setPicked] = useState<number[]>([]);
  useEffect(() => setPicked([]), [prompt]);
  const auto = () => onRespond(autoRespond(m));
  const title = (prompt.hint && describe(data, prompt.hint)) || defaultTitle(m.type);

  // 场上点卡 → 选择
  useEffect(() => {
    pickRef.current = null;
    if (m.type === OcgMessageType.SELECT_CARD || m.type === OcgMessageType.SELECT_TRIBUTE) {
      pickRef.current = (loc) => {
        const i = m.selects.findIndex((c) => locKey(c) === locKey(loc));
        if (i < 0) return false;
        if (m.max === 1) onRespond({ type: m.type === OcgMessageType.SELECT_CARD ? OcgResponseType.SELECT_CARD : OcgResponseType.SELECT_TRIBUTE, indicies: [i] });
        else setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]));
        return true;
      };
    } else if (m.type === OcgMessageType.SELECT_UNSELECT_CARD) {
      pickRef.current = (loc) => {
        const all = [...m.select_cards, ...m.unselect_cards];
        const i = all.findIndex((c) => locKey(c) === locKey(loc));
        if (i < 0) return false;
        onRespond({ type: OcgResponseType.SELECT_UNSELECT_CARD, index: i });
        return true;
      };
    }
    return () => {
      pickRef.current = null;
    };
  }, [m, pickRef, onRespond]);

  let body: React.ReactNode;
  switch (m.type) {
    case OcgMessageType.SELECT_IDLECMD:
    case OcgMessageType.SELECT_BATTLECMD: {
      const groups = [...cardActions(data, prompt).values()].map((g) => ({ ...g, choices: g.actions as Choice[] }));
      const list = groups.sort((a, b) => Number(locKey(b.loc) === focus) - Number(locKey(a.loc) === focus));
      const end: Choice[] = [];
      if (m.type === OcgMessageType.SELECT_IDLECMD) {
        if (m.to_bp) end.push({ label: "进入战斗阶段", response: { type: OcgResponseType.SELECT_IDLECMD, action: 6, index: null } });
        if (m.to_ep) end.push({ label: "结束回合", response: { type: OcgResponseType.SELECT_IDLECMD, action: 7, index: null } });
      } else {
        if (m.to_m2) end.push({ label: "进入主要阶段 2", response: { type: OcgResponseType.SELECT_BATTLECMD, action: 2, index: null } });
        if (m.to_ep) end.push({ label: "结束回合", response: { type: OcgResponseType.SELECT_BATTLECMD, action: 3, index: null } });
      }
      body = (
        <>
          {list.length === 0 && <p className="muted">现在没有可以做的操作。</p>}
          <ul className="choice-groups">
            {list.map((g) => (
              <li key={locKey(g.loc)} className={locKey(g.loc) === focus ? "focus" : undefined}>
                <Thumb data={data} code={g.code} />
                <div className="cg-info">
                  <div className="cg-name">{data.name(g.code)}</div>
                  <div className="muted">{locName(g.loc.location)}</div>
                  <div className="cg-actions">
                    {g.choices.map((c, i) => (
                      <button key={i} className="btn small" onClick={() => onRespond(c.response)} title={c.label}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="prompt-foot">
            {end.map((c) => (
              <button key={c.label} className="btn" onClick={() => onRespond(c.response)}>
                {c.label}
              </button>
            ))}
          </div>
        </>
      );
      break;
    }
    case OcgMessageType.SELECT_EFFECTYN:
    case OcgMessageType.SELECT_YESNO: {
      const yn = m.type === OcgMessageType.SELECT_EFFECTYN ? OcgResponseType.SELECT_EFFECTYN : OcgResponseType.SELECT_YESNO;
      const text = describe(data, m.description);
      body = (
        <>
          {m.type === OcgMessageType.SELECT_EFFECTYN && (
            <div className="prompt-card">
              <Thumb data={data} code={m.code} />
              <div>
                <div className="cg-name">是否发动 {data.name(m.code)} 的效果？</div>
                {text && !/""|\[\]/.test(text) && <div className="muted">{text}</div>}
              </div>
            </div>
          )}
          {m.type === OcgMessageType.SELECT_YESNO && <p>{text || "是否执行？"}</p>}
          <div className="prompt-foot">
            <button className="btn primary" onClick={() => onRespond({ type: yn, yes: true } as OcgResponse)}>
              是
            </button>
            <button className="btn" onClick={() => onRespond({ type: yn, yes: false } as OcgResponse)}>
              否
            </button>
          </div>
        </>
      );
      break;
    }
    case OcgMessageType.SELECT_OPTION:
      body = (
        <div className="option-list">
          {m.options.map((o, i) => (
            <button key={i} className="btn" onClick={() => onRespond({ type: OcgResponseType.SELECT_OPTION, index: i })}>
              {describe(data, o) || `选项 ${i + 1}`}
            </button>
          ))}
        </div>
      );
      break;
    case OcgMessageType.SELECT_CARD:
    case OcgMessageType.SELECT_TRIBUTE: {
      const R = m.type === OcgMessageType.SELECT_CARD ? OcgResponseType.SELECT_CARD : OcgResponseType.SELECT_TRIBUTE;
      const ok = picked.length >= m.min && picked.length <= m.max;
      body = (
        <>
          <p className="muted">
            {m.min === m.max ? `选 ${m.min} 张` : `选 ${m.min} 到 ${m.max} 张`}
            {m.max > 1 && `，已选 ${picked.length} 张`}
          </p>
          <CardGrid
            data={data}
            cards={m.selects}
            picked={picked}
            onPick={(i) => {
              if (m.max === 1) onRespond({ type: R, indicies: [i] } as OcgResponse);
              else setPicked(picked.includes(i) ? picked.filter((x) => x !== i) : [...picked, i]);
            }}
          />
          <div className="prompt-foot">
            {m.max > 1 && (
              <button className="btn primary" disabled={!ok} onClick={() => onRespond({ type: R, indicies: picked } as OcgResponse)}>
                确定
              </button>
            )}
            {m.can_cancel && (
              <button className="btn" onClick={() => onRespond({ type: R, indicies: null } as OcgResponse)}>
                取消
              </button>
            )}
          </div>
        </>
      );
      break;
    }
    case OcgMessageType.SELECT_UNSELECT_CARD: {
      const n = m.select_cards.length;
      body = (
        <>
          <p className="muted">点卡片选择，已选的再点一次取消。</p>
          <CardGrid data={data} cards={m.select_cards} picked={[]} onPick={(i) => onRespond({ type: OcgResponseType.SELECT_UNSELECT_CARD, index: i })} />
          {m.unselect_cards.length > 0 && (
            <>
              <div className="field-label">已选</div>
              <CardGrid data={data} cards={m.unselect_cards} picked={m.unselect_cards.map((_, i) => i)} onPick={(i) => onRespond({ type: OcgResponseType.SELECT_UNSELECT_CARD, index: n + i })} />
            </>
          )}
          <div className="prompt-foot">
            {m.can_finish && (
              <button className="btn primary" onClick={() => onRespond({ type: OcgResponseType.SELECT_UNSELECT_CARD, index: null })}>
                完成
              </button>
            )}
            {m.can_cancel && !m.can_finish && (
              <button className="btn" onClick={() => onRespond({ type: OcgResponseType.SELECT_UNSELECT_CARD, index: null })}>
                取消
              </button>
            )}
          </div>
        </>
      );
      break;
    }
    case OcgMessageType.SELECT_CHAIN:
      body = (
        <>
          <p className="muted">可以连锁发动：</p>
          <ul className="choice-groups">
            {m.selects.map((c, i) => (
              <li key={i}>
                <Thumb data={data} code={c.code} />
                <div className="cg-info">
                  <div className="cg-name">{data.name(c.code)}</div>
                  <div className="muted">{locName(c.location)}</div>
                  <div className="cg-actions">
                    <button className="btn small" onClick={() => onRespond({ type: OcgResponseType.SELECT_CHAIN, index: i })}>
                      发动{activationText(data, c.description)}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {!m.forced && (
            <div className="prompt-foot">
              <button className="btn primary" onClick={() => onRespond({ type: OcgResponseType.SELECT_CHAIN, index: null })}>
                不连锁
              </button>
            </div>
          )}
        </>
      );
      break;
    case OcgMessageType.SELECT_PLACE:
    case OcgMessageType.SELECT_DISFIELD: {
      const R = m.type === OcgMessageType.SELECT_PLACE ? OcgResponseType.SELECT_PLACE : OcgResponseType.SELECT_DISFIELD;
      const places = freePlaces(m.player, m.field_mask);
      const need = Math.max(1, m.count);
      const choose = (i: number) => {
        const next = picked.includes(i) ? picked.filter((x) => x !== i) : [...picked, i];
        if (next.length >= need) onRespond({ type: R, places: next.map((j) => places[j]) } as OcgResponse);
        else setPicked(next);
      };
      body = (
        <div className="option-list places">
          {places.map((p, i) => (
            <button key={i} className={`btn small${picked.includes(i) ? " on" : ""}`} onClick={() => choose(i)}>
              {p.player === m.player ? "" : "对方 "}
              {placeLabel(p.location, p.sequence)}
            </button>
          ))}
        </div>
      );
      break;
    }
    case OcgMessageType.SELECT_POSITION:
      body = (
        <>
          <div className="prompt-card">
            <Thumb data={data} code={m.code} />
            <div className="cg-name">{data.name(m.code)}</div>
          </div>
          <div className="option-list">
            {[1, 4, 8, 2]
              .filter((p) => m.positions & p)
              .map((p) => (
                <button key={p} className="btn" onClick={() => onRespond({ type: OcgResponseType.SELECT_POSITION, position: p } as OcgResponse)}>
                  {POSITION_LABEL[p]}
                </button>
              ))}
          </div>
        </>
      );
      break;
    case OcgMessageType.SELECT_SUM:
      body = <SumPicker data={data} m={m} onRespond={onRespond} />;
      break;
    case OcgMessageType.ANNOUNCE_ATTRIB:
    case OcgMessageType.ANNOUNCE_RACE: {
      const isAttr = m.type === OcgMessageType.ANNOUNCE_ATTRIB;
      const opts: [number | bigint, string][] = isAttr ? ATTRIBUTES.filter(([v]) => m.available & v) : RACES.filter(([v]) => BigInt(m.available) & v);
      const choose = (i: number) => {
        const next = picked.includes(i) ? picked.filter((x) => x !== i) : [...picked, i];
        if (next.length >= m.count) {
          const vals = next.map((j) => opts[j][0]);
          onRespond(isAttr ? ({ type: OcgResponseType.ANNOUNCE_ATTRIB, attributes: vals } as OcgResponse) : ({ type: OcgResponseType.ANNOUNCE_RACE, races: vals } as OcgResponse));
        } else setPicked(next);
      };
      body = (
        <div className="option-list">
          {opts.map(([, label], i) => (
            <button key={label} className={`btn small${picked.includes(i) ? " on" : ""}`} onClick={() => choose(i)}>
              {label}
            </button>
          ))}
        </div>
      );
      break;
    }
    case OcgMessageType.ANNOUNCE_NUMBER:
      body = (
        <div className="option-list">
          {m.options.map((o, i) => (
            <button key={i} className="btn small" onClick={() => onRespond({ type: OcgResponseType.ANNOUNCE_NUMBER, value: i })}>
              {String(o)}
            </button>
          ))}
        </div>
      );
      break;
    case OcgMessageType.ANNOUNCE_CARD:
      body = <AnnounceCard data={data} onRespond={onRespond} />;
      break;
    default:
      body = <p className="muted">这一步交给默认选择即可。</p>;
  }

  return (
    <section className={`prompt${className ? ` ${className}` : ""}`} aria-live="polite">
      <header>
        <h2>{title}</h2>
        <span className="prompt-tools">
          <button className="mini" onClick={auto} title="按默认方式选择">
            自动
          </button>
          {headerExtra}
        </span>
      </header>
      {prompt.retry && <p className="errors-inline">刚才的选择不符合要求，请重新选择。</p>}
      {body}
    </section>
  );
}

function defaultTitle(type: number): string {
  switch (type) {
    case OcgMessageType.SELECT_IDLECMD:
      return "你的回合：选择操作";
    case OcgMessageType.SELECT_BATTLECMD:
      return "战斗阶段";
    case OcgMessageType.SELECT_CHAIN:
      return "要连锁吗？";
    case OcgMessageType.SELECT_PLACE:
      return "选择放置的区域";
    case OcgMessageType.SELECT_POSITION:
      return "选择表示形式";
    case OcgMessageType.SELECT_OPTION:
      return "选择一项";
    case OcgMessageType.SELECT_EFFECTYN:
      return "要发动效果吗？";
    default:
      return "请选择";
  }
}

function CardGrid({ data, cards, picked, onPick }: { data: EngineData; cards: (CardLoc & { code: number })[]; picked: number[]; onPick: (i: number) => void }) {
  return (
    <ul className="pick-grid">
      {cards.map((c, i) => (
        <li key={i}>
          <button className={picked.includes(i) ? "on" : undefined} onClick={() => onPick(i)} title={data.name(c.code)}>
            <Thumb data={data} code={c.code} />
            <span className="pg-name">{data.name(c.code)}</span>
            <span className="pg-loc">
              {c.controller === 1 ? "对方" : ""}
              {locName(c.location)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function SumPicker({ data, m, onRespond }: { data: EngineData; m: Extract<Prompt["msg"], { type: OcgMessageType.SELECT_SUM }>; onRespond: (r: OcgResponse) => void }) {
  const [picked, setPicked] = useState<number[]>([]);
  const lv = (a: number) => a & 0xffff;
  const base = m.selects_must.reduce((s, c) => s + lv(c.amount), 0);
  const total = base + picked.reduce((s, i) => s + lv(m.selects[i].amount), 0);
  return (
    <>
      <p className="muted">
        合计要等于 {m.amount}，当前 {total}
      </p>
      {m.selects_must.length > 0 && <CardGrid data={data} cards={m.selects_must} picked={m.selects_must.map((_, i) => i)} onPick={() => {}} />}
      <CardGrid data={data} cards={m.selects} picked={picked} onPick={(i) => setPicked(picked.includes(i) ? picked.filter((x) => x !== i) : [...picked, i])} />
      <div className="prompt-foot">
        <button className="btn primary" disabled={picked.length === 0} onClick={() => onRespond({ type: OcgResponseType.SELECT_SUM, indicies: picked })}>
          确定
        </button>
      </div>
    </>
  );
}

function AnnounceCard({ data, onRespond }: { data: EngineData; onRespond: (r: OcgResponse) => void }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const out: number[] = [];
    for (const c of data.cards.values()) {
      if (c.alias && Math.abs(c.alias - c.code) < 20) continue;
      if (c.name.toLowerCase().includes(s)) out.push(c.code);
      if (out.length >= 20) break;
    }
    return out;
  }, [q, data]);
  return (
    <>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="输入英文卡名" aria-label="宣言卡名" />
      <div className="option-list">
        {results.map((code) => (
          <button key={code} className="btn small" onClick={() => onRespond({ type: OcgResponseType.ANNOUNCE_CARD, card: code })}>
            {data.name(code)}
          </button>
        ))}
      </div>
    </>
  );
}

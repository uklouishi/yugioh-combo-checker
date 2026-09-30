import { OcgLocation, OcgMessageType, OcgResponseType, type OcgResponse } from "ocgcore-wasm";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadEngineData, type EngineData } from "../engine/data";
import { freePlaces, type DuelSession, type DuelSetup, type FieldCard } from "../engine/session";
import { comboStore } from "../data/store";
import { href, navigate } from "../router";
import { actionsForDrop, cardActions, extraSummons, phaseChoices, type CardAction } from "../play/cardActions";
import { CardMenu, type MenuState } from "../play/CardMenu";
import { DeckSetup } from "../play/DeckSetup";
import { DuelField, locKey, type CardLoc } from "../play/DuelField";
import { GainsPanel } from "../play/GainsPanel";
import { HitWindow } from "../play/HitWindow";
import { PromptPanel } from "../play/PromptPanel";
import { canExport, toCombo } from "../play/toCombo";
import { forgetDuel, savedDuel, useDuel } from "../play/useDuel";
import { useHandDrag } from "../play/useHandDrag";
import { CardView } from "../ui/CardView";
import { downloadCombo } from "../ui/download";

interface PileView {
  title: string;
  cards: FieldCard[];
  controller: number;
  location: number;
}

/** 实战练习：导入牌组，规则引擎自动处理卡片效果，悬浮窗提示吃坑点。 */
export default function PlayPage() {
  const [data, setData] = useState<EngineData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const duel = useDuel(data);
  const { session } = duel;

  useEffect(() => {
    loadEngineData().then(setData, (e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);

  // 从分析页回来（或刷新）时接着上次的对局
  const resumed = useRef(false);
  useEffect(() => {
    if (!data || resumed.current) return;
    resumed.current = true;
    const saved = savedDuel();
    if (saved) {
      setPlaying(true);
      void duel.run(saved.setup, saved.responses);
    }
  }, [data, duel]);

  const start = (setup: DuelSetup) => {
    setPlaying(true);
    void duel.run(setup);
  };

  if (loadError) {
    return (
      <main className="page">
        <h1>实战练习</h1>
        <p className="errors-inline">规则引擎数据加载失败：{loadError}。请刷新重试。</p>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="page">
        <h1>实战练习</h1>
        <p className="muted">正在加载规则引擎的卡片数据…</p>
      </main>
    );
  }
  if (!playing || (!session && !duel.busy)) {
    return (
      <main className="page play-setup">
        <div className="toolbar">
          <div className="eyebrow">实战练习</div>
          <h1>导入牌组，直接打 combo</h1>
          <p className="lede">卡片效果由 EDOPro 的规则引擎自动处理：检索、特殊召唤、连锁和时点都按真实规则来。对手手里放着手坑，能打断你的地方会实时提示。</p>
        </div>
        {duel.error && <p className="errors-inline">{duel.error}</p>}
        <DeckSetup data={data} onStart={start} />
        <Credits />
      </main>
    );
  }
  return (
    <Duel
      data={data}
      duel={duel}
      onBack={() => {
        forgetDuel();
        setPlaying(false);
      }}
    />
  );
}

function Duel({ data, duel, onBack }: { data: EngineData; duel: ReturnType<typeof useDuel>; onBack: () => void }) {
  const { session, busy } = duel;
  const [focus, setFocus] = useState<string | null>(null);
  const [pile, setPile] = useState<PileView | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [floatHidden, setFloatHidden] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const pickRef = useRef<((loc: CardLoc) => boolean) | null>(null);
  const logRef = useRef<HTMLOListElement>(null);
  /** 拖到了哪一格：接下来引擎问放在哪里时直接用这一格。 */
  const placeRef = useRef<CardLoc | null>(null);

  const prompt = session?.status === "prompt" ? session.prompt : null;
  const acts = useMemo(() => cardActions(data, prompt), [data, prompt, duel.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const { respond } = duel;
  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [duel.version, session]);

  useEffect(() => {
    setMenu(null);
    setFloatHidden(false);
    const want = placeRef.current;
    if (!prompt) return;
    const m = prompt.msg;
    if (m.type === OcgMessageType.SELECT_IDLECMD) placeRef.current = null;
    if (!want || m.type !== OcgMessageType.SELECT_PLACE || m.player !== 0 || m.count > 1) return;
    placeRef.current = null;
    const p = freePlaces(m.player, m.field_mask).find((p) => p.player === want.controller && p.location === want.location && p.sequence === want.sequence);
    if (p) void respond({ type: OcgResponseType.SELECT_PLACE, places: [p] } as OcgResponse);
  }, [prompt, duel.version, respond]);

  const perform = useCallback(
    (a: CardAction, place: CardLoc | null = null) => {
      placeRef.current = place;
      setMenu(null);
      void respond(a.response);
    },
    [respond],
  );

  const drag = useHandDrag(
    useCallback((loc: CardLoc) => acts.has(locKey(loc)), [acts]),
    (loc, code, zone, pt) => {
      const entry = acts.get(locKey(loc));
      if (!entry) return;
      const { list, exact } = actionsForDrop(entry.actions, zone);
      const place = exact ? zone : null;
      if (exact && list.length === 1) perform(list[0], place);
      else {
        setMenu({ key: locKey(loc), name: data.name(code), rect: { left: pt.x, top: pt.y, width: 0, height: 0 }, actions: list, place });
      }
    },
  );

  const onCard = useCallback(
    (loc: CardLoc, code: number, el?: HTMLElement) => {
      if (drag.wasDrag()) return;
      if (pickRef.current?.(loc)) return;
      const key = locKey(loc);
      setFocus(key);
      const entry = acts.get(key);
      if (!entry || !el) return setMenu(null);
      if (menu?.key === key) {
        // 再点一次：只有一件事可做时直接做，否则收起
        if (entry.actions.length === 1) perform(entry.actions[0]);
        else setMenu(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setMenu({ key, name: data.name(code), rect: { left: r.left, top: r.top, width: r.width, height: r.height }, actions: entry.actions, place: null });
    },
    [acts, data, drag, menu, perform],
  );

  if (!session) return <main className="page play">{busy ? <p className="muted">正在开局…</p> : null}</main>;

  const [me, opp] = session.field();
  const active = new Set<string>(acts.keys());
  const places = new Set<string>();
  if (prompt) {
    const m = prompt.msg as unknown as Record<string, unknown>;
    for (const key of ["selects", "select_cards", "unselect_cards"]) {
      const list = m[key];
      if (Array.isArray(list)) for (const c of list) active.add(locKey(c as CardLoc));
    }
    const pm = prompt.msg;
    if ((pm.type === OcgMessageType.SELECT_PLACE || pm.type === OcgMessageType.SELECT_DISFIELD) && pm.count <= 1)
      for (const p of freePlaces(pm.player, pm.field_mask)) places.add(locKey({ controller: p.player, location: p.location, sequence: p.sequence }));
  }
  const onZone = (loc: CardLoc) => {
    const pm = prompt?.msg;
    if (!pm || (pm.type !== OcgMessageType.SELECT_PLACE && pm.type !== OcgMessageType.SELECT_DISFIELD)) return;
    const type = pm.type === OcgMessageType.SELECT_PLACE ? OcgResponseType.SELECT_PLACE : OcgResponseType.SELECT_DISFIELD;
    void respond({ type, places: [{ player: loc.controller, location: loc.location, sequence: loc.sequence }] } as OcgResponse);
  };
  const idle = prompt && (prompt.msg.type === OcgMessageType.SELECT_IDLECMD || prompt.msg.type === OcgMessageType.SELECT_BATTLECMD);
  const floating = prompt && !idle;
  const extraReady = prompt?.msg.type === OcgMessageType.SELECT_IDLECMD ? extraSummons(acts).length : 0;

  const byAction = new Map<number, typeof session.log>();
  for (const l of session.log) byAction.set(l.action, [...(byAction.get(l.action) ?? []), l]);

  const canUndo = !busy && session.ownResponseIndices().length > 0;
  const tools = (
    <>
      <button className="btn" onClick={onBack}>
        ← 牌组设置
      </button>
      <button className="btn" onClick={duel.undo} disabled={!canUndo}>
        撤销
      </button>
      <button className="btn" onClick={() => void duel.run(session.setup)} disabled={busy} title="用同一手牌从头开始">
        重来
      </button>
      {!session.setup.hand && (
        <button className="btn" onClick={() => void duel.run({ ...session.setup, seed: Math.floor(Math.random() * 2 ** 31) })} disabled={busy} title="重新洗牌抽 5 张">
          换一手
        </button>
      )}
      <button
        className="btn primary"
        onClick={() => saveCombo(session)}
        disabled={busy || !canExport(session)}
        title={canExport(session) ? "把这一回合的操作保存成 combo 文件，可以在「打开」页上传查看" : "打完这一回合（结束回合）后才能保存"}
      >
        保存为 combo
      </button>
      <button
        className="btn primary"
        onClick={() => analyzeCombo(session)}
        disabled={busy || !canExport(session)}
        title={canExport(session) ? "打开这条 combo 的分析页：手坑优先级、每一步能吃哪些手坑" : "打完这一回合（结束回合）后才能分析"}
      >
        分析这条 combo
      </button>
    </>
  );
  const closeDrawer = () => setDrawer(false);
  const phases = phaseChoices(prompt);

  return (
    <main className={`page play dueling${drag.drag ? " dragging" : ""}`}>
      <div className="play-bar">
        {tools}
        {busy && <span className="muted">引擎计算中…</span>}
        <span className="muted play-hint">把发光的手卡拖到场上出牌，点发光的卡发动效果</span>
      </div>

      <div className="play-grid">
        <div className="play-main">
          <DuelField
            data={data}
            me={me}
            opp={opp}
            lp={session.lp}
            active={active}
            onCard={onCard}
            onPile={(title, cards, controller, location) => {
              setMenu(null);
              setPile({ title, cards, controller, location });
            }}
            selected={menu?.key ?? null}
            places={places}
            onZone={onZone}
            onDragStart={drag.start}
            draggable={new Set(acts.keys())}
            dropHover={drag.drag?.hover ?? null}
            extraReady={extraReady}
          />
        </div>
        <div className={`play-side${drawer ? " open" : ""}`} aria-label="菜单">
          <div className="drawer-head">
            <strong>菜单</strong>
            <button className="mini" onClick={closeDrawer}>
              关闭
            </button>
          </div>
          <div className="drawer-tools" onClick={(e) => (e.target as HTMLElement).closest("button") && closeDrawer()}>
            {tools}
          </div>
          <p className="muted drawer-only">拖手卡到场上出牌；点发光的卡弹出按钮，再点一次直接发动。</p>
          {prompt && idle && (
            <PromptPanel
              data={data}
              prompt={prompt}
              focus={focus}
              pickRef={pickRef}
              onRespond={(r) => {
                closeDrawer();
                void respond(r);
              }}
            />
          )}
          {session.status === "turn_over" && (
            <section className="prompt done">
              <header>
                <h2>回合结束</h2>
              </header>
              <p>
                这就是你的终场：场上 {me.monsters.filter(Boolean).length} 只怪兽、{me.spells.filter(Boolean).length} 张魔陷，手卡 {me.hand.length} 张。
              </p>
              <p className="muted">可以撤销回去换一条路线，或者在吃坑点让对手发动手坑，看被打断后还能做什么。「保存为 combo」把这条路线存成文件；「分析这条 combo」直接打开分析页，看手坑优先级。</p>
              <div className="prompt-foot">
                <button className="btn primary" onClick={() => analyzeCombo(session)}>
                  分析这条 combo
                </button>
              </div>
            </section>
          )}
          {session.status === "error" && (
            <section className="prompt">
              <p className="errors-inline">引擎出错：{session.errors.at(-1)}</p>
            </section>
          )}
          <GainsPanel data={data} gains={session.gains} actions={session.actions} oppHand={opp.hand.length} />
          <section className="log">
            <h2>操作记录</h2>
            <ol ref={logRef}>
              {[...byAction].map(([a, lines]) => (
                <li key={a}>
                  <div className="log-action">{a < 0 ? "开局" : `${a + 1}. ${session.actions[a]?.label ?? ""}`}</div>
                  <ul>
                    {lines.map((l, i) => (
                      <li key={i} className={l.who === 1 ? "opp" : undefined}>
                        {l.who === 1 && "对手 · "}
                        {l.text}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </section>
          <div className="drawer-only">
            <Credits />
          </div>
        </div>
      </div>
      {drawer && <div className="drawer-scrim" onClick={closeDrawer} />}

      <Credits />

      <nav className="mobile-bar" aria-label="对局操作">
        <button className="btn" onClick={() => setDrawer(true)}>
          ☰ 菜单
        </button>
        <button className="btn" onClick={duel.undo} disabled={!canUndo}>
          撤销
        </button>
        <span className="mb-status">{busy ? "计算中…" : session.status === "turn_over" ? "回合结束" : ""}</span>
        {session.status === "turn_over" && canExport(session) && (
          <button className="btn primary" onClick={() => analyzeCombo(session)}>
            分析
          </button>
        )}
        {phases.map((c) => (
          <button key={c.label} className="btn primary" disabled={busy} onClick={() => void respond(c.response)}>
            {c.label}
          </button>
        ))}
      </nav>

      <HitWindow data={data} hits={session.hits} actions={session.actions} busy={busy} onActivate={duel.activate} />

      {floating && (
        <div className={`prompt-float${floatHidden ? " hidden" : ""}`}>
          <PromptPanel
            data={data}
            prompt={prompt}
            focus={focus}
            pickRef={pickRef}
            onRespond={(r) => void respond(r)}
            headerExtra={
              <button className="mini" onClick={() => setFloatHidden(!floatHidden)} title={floatHidden ? "展开" : "收起，先看场地"}>
                {floatHidden ? "展开" : "收起"}
              </button>
            }
          />
        </div>
      )}

      {menu && <CardMenu menu={menu} onPick={(a) => perform(a, menu.place)} onClose={closeMenu} />}

      {drag.drag && (
        <div className="drag-ghost" style={{ left: drag.drag.x, top: drag.drag.y }} aria-hidden>
          <CardView id={drag.drag.code} name={data.name(drag.drag.code)} />
        </div>
      )}

      {pile && (
        <div className="overlay" onClick={() => setPile(null)}>
          <div className="dialog" role="dialog" aria-modal="true" aria-label={pile.title} onClick={(e) => e.stopPropagation()}>
            <h2>
              {pile.controller === 1 ? "对手的" : ""}
              {pile.title}（{pile.cards.length}）
            </h2>
            {pile.cards.some((_, i) => acts.has(locKey({ controller: pile.controller, location: pile.location, sequence: i }))) && (
              <p className="muted">{pile.location === OcgLocation.EXTRA ? "发光的怪兽现在满足特殊召唤条件，点下面的按钮召唤。" : "发光的卡现在可以发动，点下面的按钮。"}</p>
            )}
            <div className="deck-grid pile-grid">
              {pile.cards
                .map((c, i) => ({ c, i, has: acts.has(locKey({ controller: pile.controller, location: pile.location, sequence: i })) }))
                .sort((a, b) => Number(b.has) - Number(a.has))
                .map(({ c, i }) => {
                  const loc = { controller: pile.controller, location: pile.location, sequence: i };
                  const key = locKey(loc);
                  const on = active.has(key);
                  const entry = acts.get(key);
                  return (
                    <div key={i} className={`pile-item${entry ? " has-acts" : ""}`}>
                      <button
                        className={`deck-card${on ? " active" : ""}`}
                        title={data.name(c.code)}
                        onClick={() => {
                          if (pickRef.current?.(loc)) setPile(null);
                        }}
                      >
                        <span className="thumb">
                          <CardView id={c.code} name={data.name(c.code)} />
                        </span>
                      </button>
                      {entry?.actions.map((a, j) => (
                        <button
                          key={j}
                          className="btn small"
                          onClick={() => {
                            setPile(null);
                            perform(a);
                          }}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  );
                })}
            </div>
            <div className="row">
              <button className="btn" onClick={() => setPile(null)} autoFocus>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/** 同一局同一条路线重复点「分析」时沿用同一个 id，分析页上的手动调整不会丢。 */
const analyzed = new WeakMap<DuelSession, { at: number; id: string }>();

/** 存进「我的 combo」并打开分析页。对局存在 sessionStorage，从分析页回来还能接着打。 */
function analyzeCombo(session: DuelSession) {
  try {
    const combo = toCombo(session);
    const prev = analyzed.get(session);
    if (prev && prev.at === session.responses.length) combo.id = prev.id;
    analyzed.set(session, { at: session.responses.length, id: combo.id });
    comboStore.save([combo]);
    navigate(href.analyze(combo.id));
  } catch (e) {
    window.alert(`分析失败：${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 导出成 combo JSON 并下载。 */
function saveCombo(session: Parameters<typeof toCombo>[0]) {
  try {
    downloadCombo(toCombo(session));
  } catch (e) {
    window.alert(`保存失败：${e instanceof Error ? e.message : String(e)}`);
  }
}

function Credits() {
  return (
    <p className="muted credits">
      规则引擎：<a href="https://github.com/edo9300/ygopro-core">EDOPro ygopro-core</a>（经 <a href="https://github.com/n1xx1/ocgcore-wasm">ocgcore-wasm</a> 编译为 WebAssembly）；卡片数据和效果脚本：
      <a href="https://github.com/ProjectIgnis/BabelCDB">ProjectIgnis BabelCDB</a>、<a href="https://github.com/ProjectIgnis/CardScripts">ProjectIgnis CardScripts</a>。以上项目按 AGPL-3.0
      发布，本站未作修改。
    </p>
  );
}

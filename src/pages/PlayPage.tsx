import { useCallback, useEffect, useRef, useState } from "react";
import { loadEngineData, type EngineData } from "../engine/data";
import type { DuelSetup, FieldCard } from "../engine/session";
import { DeckSetup } from "../play/DeckSetup";
import { DuelField, locKey, type CardLoc } from "../play/DuelField";
import { GainsPanel } from "../play/GainsPanel";
import { HitWindow } from "../play/HitWindow";
import { PromptPanel } from "../play/PromptPanel";
import { canExport, toCombo } from "../play/toCombo";
import { useDuel } from "../play/useDuel";
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
          <p className="lede">
            卡片效果由 EDOPro 的规则引擎自动处理：检索、特殊召唤、连锁和时点都按真实规则来。对手手里放着手坑，能打断你的地方会实时提示。
          </p>
        </div>
        {duel.error && <p className="errors-inline">{duel.error}</p>}
        <DeckSetup data={data} onStart={start} />
        <Credits />
      </main>
    );
  }
  return <Duel data={data} duel={duel} onBack={() => setPlaying(false)} />;
}

function Duel({ data, duel, onBack }: { data: EngineData; duel: ReturnType<typeof useDuel>; onBack: () => void }) {
  const { session, busy } = duel;
  const [focus, setFocus] = useState<string | null>(null);
  const [pile, setPile] = useState<PileView | null>(null);
  const pickRef = useRef<((loc: CardLoc) => boolean) | null>(null);
  const logRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [duel.version, session]);

  const onCard = useCallback((loc: CardLoc) => {
    if (pickRef.current?.(loc)) return;
    setFocus(locKey(loc));
  }, []);

  if (!session) return <main className="page play">{busy ? <p className="muted">正在开局…</p> : null}</main>;

  const [me, opp] = session.field();
  const prompt = session.status === "prompt" ? session.prompt : null;
  const active = new Set<string>();
  if (prompt) {
    const m = prompt.msg as unknown as Record<string, unknown>;
    for (const key of ["summons", "special_summons", "monster_sets", "spell_sets", "pos_changes", "activates", "selects", "select_cards", "unselect_cards", "chains"]) {
      const list = m[key];
      if (Array.isArray(list)) for (const c of list) active.add(locKey(c as CardLoc));
    }
  }

  const byAction = new Map<number, typeof session.log>();
  for (const l of session.log) byAction.set(l.action, [...(byAction.get(l.action) ?? []), l]);

  return (
    <main className="page play">
      <div className="play-bar">
        <button className="btn" onClick={onBack}>
          ← 牌组设置
        </button>
        <button className="btn" onClick={duel.undo} disabled={busy || session.ownResponseIndices().length === 0}>
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
        {busy && <span className="muted">引擎计算中…</span>}
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
            onPile={(title, cards, controller, location) => setPile({ title, cards, controller, location })}
          />
        </div>
        <div className="play-side">
          {prompt && <PromptPanel data={data} prompt={prompt} focus={focus} pickRef={pickRef} onRespond={(r) => void duel.respond(r)} />}
          {session.status === "turn_over" && (
            <section className="prompt done">
              <header>
                <h2>回合结束</h2>
              </header>
              <p>
                这就是你的终场：场上 {me.monsters.filter(Boolean).length} 只怪兽、{me.spells.filter(Boolean).length} 张魔陷，手卡 {me.hand.length} 张。
              </p>
              <p className="muted">可以撤销回去换一条路线，或者在吃坑点让对手发动手坑，看被打断后还能做什么。点上面的「保存为 combo」可以把这条路线存成文件，之后在「打开」页上传查看。</p>
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
        </div>
      </div>

      <Credits />

      <HitWindow data={data} hits={session.hits} actions={session.actions} busy={busy} onActivate={duel.activate} />

      {pile && (
        <div className="overlay" onClick={() => setPile(null)}>
          <div className="dialog" role="dialog" aria-modal="true" aria-label={pile.title} onClick={(e) => e.stopPropagation()}>
            <h2>
              {pile.controller === 1 ? "对手的" : ""}
              {pile.title}（{pile.cards.length}）
            </h2>
            <div className="deck-grid">
              {pile.cards.map((c, i) => {
                const loc = { controller: pile.controller, location: pile.location, sequence: i };
                const on = active.has(locKey(loc));
                return (
                  <button
                    key={i}
                    className={`deck-card${on ? " active" : ""}`}
                    title={data.name(c.code)}
                    onClick={() => {
                      onCard(loc);
                      setPile(null);
                    }}
                  >
                    <span className="thumb">
                      <CardView id={c.code} name={data.name(c.code)} />
                    </span>
                  </button>
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
      规则引擎：<a href="https://github.com/edo9300/ygopro-core">EDOPro ygopro-core</a>（经{" "}
      <a href="https://github.com/n1xx1/ocgcore-wasm">ocgcore-wasm</a> 编译为 WebAssembly）；卡片数据和效果脚本：
      <a href="https://github.com/ProjectIgnis/BabelCDB">ProjectIgnis BabelCDB</a>、
      <a href="https://github.com/ProjectIgnis/CardScripts">ProjectIgnis CardScripts</a>。以上项目按 AGPL-3.0 发布，本站未作修改。
    </p>
  );
}

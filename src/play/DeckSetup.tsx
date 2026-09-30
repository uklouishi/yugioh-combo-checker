import { useEffect, useMemo, useState } from "react";
import { handtraps } from "../data";
import { isExtraDeckCard, type EngineData } from "../engine/data";
import { DeckParseError, parseDeck, toYdk, type Deck } from "../engine/deck";
import type { DuelSetup } from "../engine/session";
import { CardView } from "../ui/CardView";
import { SAMPLE_DECK } from "./sample";

const STORE = "play-setup-v1";

interface Saved {
  text: string;
  mode: "random" | "pick";
  hand: number[];
  opponent: number[];
}

/** Called by the Grave 是速攻魔法，对手回合只能从盖放发动，默认不放。 */
const DEFAULT_OPPONENT = handtraps.filter((h) => h.id !== 24224830).map((h) => h.id);

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function save(s: Saved) {
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    // 本地存储不可用时只是不记住设置
  }
}

interface Props {
  data: EngineData;
  onStart: (setup: DuelSetup) => void;
}

const count = (ids: number[]) => {
  const m = new Map<number, number>();
  for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
};

export function DeckSetup({ data, onStart }: Props) {
  const saved = useMemo(load, []);
  const [text, setText] = useState(saved?.text ?? "");
  const [mode, setMode] = useState<"random" | "pick">(saved?.mode ?? "random");
  const [hand, setHand] = useState<number[]>(saved?.hand ?? []);
  const [opponent, setOpponent] = useState<number[]>(saved?.opponent ?? DEFAULT_OPPONENT);
  const [clipError, setClipError] = useState<string | null>(null);

  const parsed = useMemo((): { deck: Deck | null; error: string | null } => {
    if (!text.trim()) return { deck: null, error: null };
    try {
      return { deck: parseDeck(text), error: null };
    } catch (e) {
      return { deck: null, error: e instanceof DeckParseError ? e.message : "读取失败" };
    }
  }, [text]);

  // 按卡片类型放进主卡组或额外卡组（导出的牌组偶尔放错）；引擎里没有的卡单独列出
  const deck = useMemo(() => {
    const d = parsed.deck;
    if (!d) return null;
    const main: number[] = [];
    const extra: number[] = [];
    const unknown: number[] = [];
    for (const id of [...d.main, ...d.extra]) {
      const c = data.cards.get(id);
      if (!c) unknown.push(id);
      else (isExtraDeckCard(c) ? extra : main).push(id);
    }
    return { main, extra, unknown };
  }, [parsed.deck, data]);

  // 牌组变了以后，起手里不在牌组的卡去掉
  const validHand = useMemo(() => {
    if (!deck) return [];
    const left = count(deck.main);
    return hand.filter((id) => {
      const n = left.get(id) ?? 0;
      if (n <= 0) return false;
      left.set(id, n - 1);
      return true;
    });
  }, [hand, deck]);

  useEffect(() => save({ text, mode, hand: validHand, opponent }), [text, mode, validHand, opponent]);

  const paste = async () => {
    setClipError(null);
    try {
      const t = await navigator.clipboard.readText();
      if (!t.trim()) setClipError("剪贴板是空的");
      else setText(t);
    } catch {
      setClipError("浏览器没有允许读取剪贴板，请直接粘贴到下面的框里");
    }
  };

  const toggleHand = (id: number) => {
    const inHand = validHand.filter((x) => x === id).length;
    const inDeck = deck?.main.filter((x) => x === id).length ?? 0;
    if (inHand < inDeck && validHand.length < 6) setHand([...validHand, id]);
  };

  const canStart = !!deck && deck.main.length > 0 && (mode === "random" || validHand.length > 0);
  const start = () => {
    if (!deck) return;
    onStart({
      main: deck.main,
      extra: deck.extra,
      hand: mode === "pick" ? validHand : null,
      opponentHand: opponent,
      seed: Math.floor(Math.random() * 2 ** 31),
    });
  };

  const mainCounts = deck ? [...count(deck.main)] : [];
  const extraCounts = deck ? [...count(deck.extra)] : [];

  return (
    <div className="setup">
      <section className="panel">
        <div className="sub-head">
          <h2 className="section-title">1. 导入牌组</h2>
          <div className="adds">
            <button className="btn" onClick={paste}>
              从剪贴板粘贴
            </button>
            <button className="btn" onClick={() => setText(toYdk(SAMPLE_DECK))}>
              用示例牌组
            </button>
          </div>
        </div>
        <p className="muted">支持 .ydk 文件内容和 ydke:// 链接（EDOPro、Dueling Book、YGOPRODeck 都能导出）。</p>
        <textarea
          className="deck-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"#main\n9674034\n…\n#extra\n…\n!side\n\n或 ydke://…"}
          aria-label="牌组内容"
          spellCheck={false}
        />
        {clipError && <p className="errors-inline">{clipError}</p>}
        {parsed.error && <p className="errors-inline">{parsed.error}</p>}
        {deck && (
          <>
            <p className="muted">
              主卡组 {deck.main.length} 张 · 额外卡组 {deck.extra.length} 张
              {mode === "pick" && " · 点主卡组的卡加入起手"}
            </p>
            {deck.unknown.length > 0 && (
              <p className="errors-inline">
                有 {deck.unknown.length} 张卡规则引擎里还没有（卡号 {[...new Set(deck.unknown)].join("、")}），会被跳过。
              </p>
            )}
            <div className="deck-grid" aria-label="主卡组">
              {mainCounts.map(([id, n]) => (
                <button key={id} className="deck-card" onClick={() => mode === "pick" && toggleHand(id)} title={data.name(id)} disabled={mode !== "pick"}>
                  <span className="thumb">
                    <CardView id={id} name={data.name(id)} />
                  </span>
                  {n > 1 && <span className="count">×{n}</span>}
                </button>
              ))}
            </div>
            {extraCounts.length > 0 && (
              <div className="deck-grid extra" aria-label="额外卡组">
                {extraCounts.map(([id, n]) => (
                  <div key={id} className="deck-card" title={data.name(id)}>
                    <span className="thumb">
                      <CardView id={id} name={data.name(id)} />
                    </span>
                    {n > 1 && <span className="count">×{n}</span>}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <section className="panel">
        <h2 className="section-title">2. 起手</h2>
        <div className="seg" role="radiogroup" aria-label="起手方式">
          <label className={mode === "random" ? "on" : undefined}>
            <input type="radio" name="mode" checked={mode === "random"} onChange={() => setMode("random")} />
            随机抽 5 张
          </label>
          <label className={mode === "pick" ? "on" : undefined}>
            <input type="radio" name="mode" checked={mode === "pick"} onChange={() => setMode("pick")} />
            指定起手
          </label>
        </div>
        {mode === "pick" && (
          <div className="hand-pick">
            {validHand.length === 0 && <span className="muted">在上面的主卡组里点卡片加入起手（最多 6 张）。</span>}
            {validHand.map((id, i) => (
              <button key={`${id}-${i}`} className="deck-card" onClick={() => setHand(validHand.filter((_, j) => j !== i))} title={`移除 ${data.name(id)}`}>
                <span className="thumb">
                  <CardView id={id} name={data.name(id)} />
                </span>
                <span className="x">✕</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <h2 className="section-title">3. 对手手里的手坑</h2>
        <p className="muted">对手每次能连锁这些卡时，悬浮窗会提示吃坑点。你可以随时回到那个时点，让对手真的发动。</p>
        <div className="chips-edit">
          {handtraps.map((h) => {
            const on = opponent.includes(h.id);
            return (
              <label key={h.id} className={`tag-toggle${on ? " on" : ""}`} title={h.summary}>
                <input type="checkbox" checked={on} onChange={() => setOpponent(on ? opponent.filter((x) => x !== h.id) : [...opponent, h.id])} />
                {h.name}
              </label>
            );
          })}
        </div>
      </section>

      <div className="start-row">
        <button className="btn primary big" disabled={!canStart} onClick={start}>
          开始练习
        </button>
        {!deck && <span className="muted">先导入一个牌组。</span>}
      </div>
    </div>
  );
}

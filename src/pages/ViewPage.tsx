import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCards } from "../cards/useCards";
import { handtrapById, handtraps } from "../data";
import { useCombos } from "../data/store";
import { simulate } from "../model/board";
import { deriveInterruptions } from "../model/interruptions";
import { buildBeats, type ChainMark } from "../model/playback";
import type { Combo } from "../model/schema";
import { collectCardRefs } from "../model/validate";
import { href } from "../router";
import { CardDetail } from "../ui/CardDetail";
import { Field } from "../ui/Field";
import { StepPanel } from "../ui/StepPanel";
import { useFlight } from "../ui/useFlight";
import { NotFound } from "./NotFound";

export function ViewPage({ id, initialStep }: { id: string; initialStep: number }) {
  const { all } = useCombos();
  const combo = all.find((c) => c.id === id);
  if (!combo) return <NotFound what="这个 combo" />;
  return <Viewer combo={combo} initialStep={initialStep} />;
}

export function Viewer({ combo, initialStep }: { combo: Combo; initialStep: number }) {
  const [frame, setFrame] = useState(Math.min(initialStep, combo.steps.length));
  const [openCard, setOpenCard] = useState<number | null>(null);
  const frameRef = useRef(frame);
  frameRef.current = frame;

  const frames = useMemo(() => simulate(combo), [combo]);
  const hits = useMemo(() => deriveInterruptions(combo), [combo]);
  const refs = useMemo(() => collectCardRefs(combo), [combo]);
  const cards = useCards([...refs.map((r) => r.id), ...handtraps.map((h) => h.id)]);
  const names = useMemo(() => new Map(refs.map((r) => [r.id, r.name])), [refs]);

  // 正在播放的一步（step 下标）和播到第几拍；播放时 frame 已经是这一步之后
  const [play, setPlay] = useState<{ step: number; beat: number } | null>(null);
  const beats = useMemo(() => (play ? buildBeats(combo.steps[play.step], frames[play.step].board) : null), [combo, frames, play?.step]);
  const beat = play && beats ? beats[play.beat] : null;
  const fieldRef = useRef<HTMLDivElement>(null);
  useFlight(
    fieldRef,
    beat,
    useCallback(() => setPlay((p) => (p && beats && p.beat + 1 < beats.length ? { ...p, beat: p.beat + 1 } : null)), [beats]),
  );

  const [animate, setAnimate] = useState(loadAnimate);
  const toggleAnimate = (on: boolean) => {
    setAnimate(on);
    if (!on) setPlay(null);
    try {
      localStorage.setItem(ANIMATE_KEY, on ? "1" : "0");
    } catch {
      // 存不了就只在这次打开时生效
    }
  };

  const go = (f: number) => {
    const to = Math.max(0, Math.min(combo.steps.length, f));
    // 往后走一步时播放这一步的动画（动画打开时），其余直接跳过去
    setPlay(animate && to === frame + 1 ? { step: frame, beat: 0 } : null);
    setFrame(to);
  };
  const replay = () => frame > 0 && setPlay({ step: frame - 1, beat: 0 });
  const goRef = useRef(go);
  goRef.current = go;

  // 把当前步骤写进地址，方便分享到具体某一步（不产生新的历史记录）。
  useEffect(() => {
    history.replaceState(null, "", href.view(combo.id, frame));
  }, [combo.id, frame]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select") || openCard !== null) return;
      if (e.key === "ArrowRight") goRef.current(frameRef.current + 1);
      if (e.key === "ArrowLeft") goRef.current(frameRef.current - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [combo, openCard]);

  const current = frames[frame];
  const openName = openCard === null ? "" : names.get(openCard) ?? handtrapById.get(openCard)?.name ?? cards.get(openCard)?.name ?? String(openCard);

  return (
    <main className="app">
      <div className="toolbar">
        <div className="eyebrow">
          {combo.deck} · {combo.format}
        </div>
        <h1>{combo.title}</h1>
        <div className="actions">
          <a className="btn" href={href.analyze(combo.id)}>
            分析这个 combo
          </a>
          <a className="btn" href={href.edit(combo.id)}>
            编辑
          </a>
        </div>
      </div>

      <BeatCaption caption={beat?.caption} chain={beat?.chain} active={beat?.active} idle={frame === 0 ? (animate ? "起手局面。点 ▶ 或按 → 开始，每一步都会演示卡片怎么移动。" : "起手局面。点 ▶ 或按 → 开始。") : `步骤 ${frame}：${combo.steps[frame - 1].title}`} />

      <div className="field-wrap" ref={fieldRef}>
        <Field
          board={beat ? beat.board : current.board}
          moved={beat ? [] : current.moved}
          chain={beat?.chain}
          active={beat?.active}
          cards={cards}
          onOpen={setOpenCard}
        />
      </div>

      <StepPanel
        combo={combo}
        frame={frame}
        hits={hits}
        handtraps={handtrapById}
        cards={cards}
        onFrame={go}
        onOpen={setOpenCard}
        playing={play !== null}
        onReplay={replay}
        animate={animate}
        onAnimate={toggleAnimate}
      />

      {openCard !== null && (
        <CardDetail
          id={openCard}
          name={openName}
          info={cards.get(openCard)}
          handtrap={handtrapById.get(openCard)}
          onClose={() => setOpenCard(null)}
        />
      )}
    </main>
  );
}

const ANIMATE_KEY = "view-animate-v1";

/** 上次选的动画开关，默认打开。 */
function loadAnimate(): boolean {
  try {
    return localStorage.getItem(ANIMATE_KEY) !== "0";
  } catch {
    return true;
  }
}

/** 场地上方的解说条：播放时说明这一拍发生了什么，并列出当前的连锁。 */
function BeatCaption({ caption, chain, active, idle }: { caption?: string; chain?: ChainMark[]; active?: number; idle: string }) {
  return (
    <div className={`beat-caption${caption ? " live" : ""}`} aria-live="polite">
      <div className="text">{caption ?? idle}</div>
      {chain && chain.length > 0 && (
        <ol className="chain-list" aria-label="当前连锁">
          {chain.map((c) => (
            <li key={c.link} className={c.link === active ? "active" : undefined}>
              <b>CHAIN {c.link}</b> {c.card.name}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

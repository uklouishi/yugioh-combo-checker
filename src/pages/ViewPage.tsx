import { useEffect, useMemo, useState } from "react";
import { useCards } from "../cards/useCards";
import { handtrapById, handtraps } from "../data";
import { useCombos } from "../data/store";
import { simulate } from "../model/board";
import { deriveInterruptions } from "../model/interruptions";
import type { Combo } from "../model/schema";
import { collectCardRefs } from "../model/validate";
import { href } from "../router";
import { CardDetail } from "../ui/CardDetail";
import { Field } from "../ui/Field";
import { StepPanel } from "../ui/StepPanel";
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

  const frames = useMemo(() => simulate(combo), [combo]);
  const hits = useMemo(() => deriveInterruptions(combo), [combo]);
  const refs = useMemo(() => collectCardRefs(combo), [combo]);
  const cards = useCards([...refs.map((r) => r.id), ...handtraps.map((h) => h.id)]);
  const names = useMemo(() => new Map(refs.map((r) => [r.id, r.name])), [refs]);

  const go = (f: number) => setFrame(Math.max(0, Math.min(combo.steps.length, f)));

  // 把当前步骤写进地址，方便分享到具体某一步（不产生新的历史记录）。
  useEffect(() => {
    history.replaceState(null, "", href.view(combo.id, frame));
  }, [combo.id, frame]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select") || openCard !== null) return;
      if (e.key === "ArrowRight") setFrame((f) => Math.min(combo.steps.length, f + 1));
      if (e.key === "ArrowLeft") setFrame((f) => Math.max(0, f - 1));
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

      <Field board={current.board} moved={current.moved} cards={cards} onOpen={setOpenCard} />

      <StepPanel
        combo={combo}
        frame={frame}
        hits={hits}
        handtraps={handtrapById}
        cards={cards}
        onFrame={go}
        onOpen={setOpenCard}
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

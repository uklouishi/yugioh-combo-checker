import { useEffect, useMemo, useState } from "react";
import { useCards } from "./cards/useCards";
import { combos as builtIn, handtrapById, handtraps } from "./data";
import { loadUserCombos, saveUserCombos } from "./data/userCombos";
import { simulate } from "./model/board";
import { deriveInterruptions } from "./model/interruptions";
import type { Combo } from "./model/schema";
import { collectCardRefs } from "./model/validate";
import { CardDetail } from "./ui/CardDetail";
import { Field } from "./ui/Field";
import { ImportDialog } from "./ui/ImportDialog";
import { StepPanel } from "./ui/StepPanel";

export function App() {
  const [mine, setMine] = useState<Combo[]>(loadUserCombos);
  const all = useMemo(() => [...builtIn.filter((c) => !mine.some((m) => m.id === c.id)), ...mine], [mine]);
  const [comboId, setComboId] = useState(all[0]?.id);
  const combo = all.find((c) => c.id === comboId) ?? all[0];
  const [frame, setFrame] = useState(0);
  const [openCard, setOpenCard] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);

  const frames = useMemo(() => simulate(combo), [combo]);
  const hits = useMemo(() => deriveInterruptions(combo), [combo]);
  const ids = useMemo(() => [...collectCardRefs(combo).map((r) => r.id), ...handtraps.map((h) => h.id)], [combo]);
  const cards = useCards(ids);
  const names = useMemo(() => new Map(collectCardRefs(combo).map((r) => [r.id, r.name])), [combo]);

  const go = (f: number) => setFrame(Math.max(0, Math.min(combo.steps.length, f)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select") || openCard !== null || importing) return;
      if (e.key === "ArrowRight") setFrame((f) => Math.min(combo.steps.length, f + 1));
      if (e.key === "ArrowLeft") setFrame((f) => Math.max(0, f - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [combo, openCard, importing]);

  const updateMine = (next: Combo[]) => {
    setMine(next);
    saveUserCombos(next);
  };

  const current = frames[frame];
  const openName = openCard === null ? "" : names.get(openCard) ?? handtrapById.get(openCard)?.name ?? String(openCard);

  return (
    <main className="app">
      <div className="toolbar">
        <h1>{combo.title}</h1>
        <select
          id="combo-select"
          value={combo.id}
          onChange={(e) => {
            setComboId(e.target.value);
            setFrame(0);
          }}
          aria-label="选择 combo"
        >
          {all.map((c) => (
            <option key={c.id} value={c.id}>
              {c.deck} · {c.title}
              {mine.some((m) => m.id === c.id) ? "（我上传的）" : ""}
            </option>
          ))}
        </select>
        <button className="btn" onClick={() => setImporting(true)}>
          上传 combo
        </button>
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
      {importing && (
        <ImportDialog
          all={all}
          mine={mine}
          onImport={(added) => {
            updateMine([...mine.filter((m) => !added.some((a) => a.id === m.id)), ...added]);
            setComboId(added[0].id);
            setFrame(0);
          }}
          onDelete={(id) => updateMine(mine.filter((m) => m.id !== id))}
          onClose={() => setImporting(false)}
        />
      )}
    </main>
  );
}

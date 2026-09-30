import { useEffect, useMemo, useRef, useState } from "react";
import { useCards } from "../cards/useCards";
import { handtrapById, handtraps } from "../data";
import { comboStore, useCombos } from "../data/store";
import { parseCombos } from "../data/userCombos";
import { CardSearch, type PoolRole } from "../editor/CardSearch";
import { newDraft, newStep, sanitize, type Draft } from "../editor/draft";
import { HandtrapWindow } from "../editor/HandtrapWindow";
import { StepEditor } from "../editor/StepEditor";
import { simulatePartial } from "../model/board";
import { deriveInterruptions } from "../model/interruptions";
import type { CardRef, Step } from "../model/schema";
import { href, navigate } from "../router";
import { CardDetail } from "../ui/CardDetail";
import { downloadCombo } from "../ui/download";
import { Field } from "../ui/Field";
import { IMPACT_LABEL } from "./AnalyzePage";
import { NotFound } from "./NotFound";

const draftKey = (id?: string) => `editor-draft:${id ?? "new"}`;

function loadDraft(id?: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(id));
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}
function storeDraft(id: string | undefined, d: Draft | null) {
  try {
    if (d) localStorage.setItem(draftKey(id), JSON.stringify(d));
    else localStorage.removeItem(draftKey(id));
  } catch {
    // 存储不可用时草稿只在本页有效
  }
}

export function EditorPage({ id }: { id?: string }) {
  const { all } = useCombos();
  const existing = id ? all.find((c) => c.id === id) : undefined;
  if (id && !existing) return <NotFound what="要编辑的 combo" />;
  return <Editor id={id} initial={loadDraft(id) ?? (existing ? structuredClone(existing) : newDraft())} hasDraft={!!loadDraft(id)} />;
}

function Editor({ id, initial, hasDraft }: { id?: string; initial: Draft; hasDraft: boolean }) {
  const { all } = useCombos();
  const [draft, setDraft] = useState<Draft>(initial);
  const [selected, setSelected] = useState(Math.max(0, initial.steps.length - 1));
  const [openCard, setOpenCard] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [restored, setRestored] = useState(hasDraft);

  const initialJson = useRef(JSON.stringify(initial));
  useEffect(() => {
    // 只有真正改动后才自动保存草稿。
    if (JSON.stringify(draft) === initialJson.current) return;
    storeDraft(id, draft);
    setSaved(false);
  }, [id, draft]);

  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setSteps = (steps: Step[]) => update({ steps });

  const pool: CardRef[] = useMemo(() => {
    const seen = new Map<number, CardRef>();
    for (const c of [...draft.starter, ...draft.requires.deck, ...draft.requires.extra]) seen.set(c.id, c);
    return [...seen.values()];
  }, [draft.starter, draft.requires]);

  const clean = useMemo(() => sanitize(draft), [draft]);
  const sim = useMemo(() => simulatePartial(clean), [clean]);
  const hits = useMemo(() => deriveInterruptions(clean), [clean]);
  // 不带作者说明时自动识别出的吃坑点，悬浮窗「恢复默认」用。
  const autoHits = useMemo(
    () => deriveInterruptions({ ...clean, steps: clean.steps.map((s) => ({ ...s, interruptions: [] })) }),
    [clean],
  );
  const [htStep, setHtStep] = useState<number | null>(null);
  const validation = useMemo(() => parseCombos(JSON.stringify(draft), all.filter((c) => c.id !== draft.id)), [draft, all]);
  const cards = useCards([...pool.map((c) => c.id), ...handtraps.map((h) => h.id)]);

  const frameIndex = Math.min(selected + 1, sim.frames.length - 1);
  const frame = sim.frames[frameIndex];
  const selectedStep = draft.steps[selected];
  const stepHits = selectedStep ? hits.filter((h) => h.stepId === selectedStep.id) : [];

  const addToPool = (card: { id: number; name: string }, role: PoolRole) => {
    const ref = { id: card.id, name: card.name };
    if (role === "starter") update({ starter: [...draft.starter, ref] });
    else if (role === "deck") update({ requires: { ...draft.requires, deck: [...draft.requires.deck, ref] } });
    else update({ requires: { ...draft.requires, extra: [...draft.requires.extra, ref] } });
  };
  const removeFromPool = (role: PoolRole, i: number) => {
    if (role === "starter") update({ starter: draft.starter.filter((_, j) => j !== i) });
    else
      update({
        requires: { ...draft.requires, [role]: draft.requires[role].filter((_, j) => j !== i) },
      });
  };

  const moveStep = (i: number, dir: -1 | 1) => {
    const steps = [...draft.steps];
    [steps[i], steps[i + dir]] = [steps[i + dir], steps[i]];
    setSteps(steps);
    setSelected(i + dir);
  };

  const fillEndboard = () => {
    const last = sim.frames.at(-1)!.board;
    const onField = [...last.emz, ...last.monster, ...last.spell_trap, ...last.field_zone].flatMap((p) => (p ? [p.card] : []));
    update({ endboard: { ...draft.endboard, cards: onField } });
  };

  const save = () => {
    if (!validation.ok) return;
    const combo = { ...validation.combos[0], updatedAt: new Date().toISOString().slice(0, 10) };
    comboStore.save([combo]);
    storeDraft(id, null);
    setSaved(true);
    if (!id) {
      storeDraft(combo.id, null);
      navigate(href.edit(combo.id));
    }
  };

  const discard = () => {
    storeDraft(id, null);
    const fresh = id ? all.find((c) => c.id === id) : undefined;
    setDraft(fresh ? structuredClone(fresh) : newDraft());
    setRestored(false);
  };

  const roles: Array<[PoolRole, string, CardRef[]]> = [
    ["starter", "起手", draft.starter],
    ["deck", "卡组里需要的卡", draft.requires.deck],
    ["extra", "额外卡组里需要的卡", draft.requires.extra],
  ];

  return (
    <main className="page editor">
      <div className="page-head">
        <div>
          <div className="eyebrow">{id ? "编辑 combo" : "创建 combo"}</div>
          <h1>{draft.title || "未命名 combo"}</h1>
        </div>
      </div>

      {restored && (
        <div className="banner">
          已恢复上次没保存的草稿。
          <button className="btn" onClick={discard}>
            放弃草稿
          </button>
        </div>
      )}

      <div className="editor-grid">
        <div className="editor-form">
          <section className="panel">
            <h2 className="section-title">基本信息</h2>
            <div className="form-grid">
              <label htmlFor="f-title">标题</label>
              <input
                id="f-title"
                value={draft.title}
                onChange={(e) => update({ title: e.target.value })}
                placeholder="例如：Snake-Eye Ash 单卡起手"
              />
              <label htmlFor="f-deck">卡组</label>
              <input id="f-deck" value={draft.deck} onChange={(e) => update({ deck: e.target.value })} placeholder="例如：Snake-Eye" />
              <label htmlFor="f-format">环境</label>
              <select id="f-format" value={draft.format} onChange={(e) => update({ format: e.target.value as Draft["format"] })}>
                <option value="TCG">TCG</option>
                <option value="OCG">OCG</option>
                <option value="MD">Master Duel</option>
              </select>
              <label htmlFor="f-hand">起手张数</label>
              <input
                id="f-hand"
                type="number"
                min={1}
                max={10}
                value={draft.handSize}
                onChange={(e) => update({ handSize: Number(e.target.value) || 5 })}
              />
              <label htmlFor="f-decksize">主卡组张数</label>
              <input
                id="f-decksize"
                type="number"
                min={40}
                max={60}
                value={draft.deckSize}
                onChange={(e) => update({ deckSize: Number(e.target.value) || 40 })}
              />
            </div>
          </section>

          <section className="panel">
            <h2 className="section-title">卡池</h2>
            <p className="muted">先把这条展开会用到的卡加进来，步骤里的下拉框只列出卡池里的卡。</p>
            <CardSearch onAdd={addToPool} />
            {roles.map(([role, label, list]) => (
              <div key={role} className="pool-group">
                <div className="pool-label">
                  {label}（{list.length}）
                </div>
                <div className="chips-edit">
                  {list.length === 0 && <span className="muted">还没有</span>}
                  {list.map((c, i) => (
                    <span key={`${c.id}-${i}`} className="chip">
                      <button className="linkish" onClick={() => setOpenCard(c.id)}>
                        {c.name}
                      </button>
                      <button aria-label={`移除 ${c.name}`} onClick={() => removeFromPool(role, i)}>
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </section>

          <section className="panel">
            <div className="sub-head">
              <h2 className="section-title">步骤</h2>
              <button
                className="btn primary"
                onClick={() => {
                  setSteps([...draft.steps, newStep(draft.steps)]);
                  setSelected(draft.steps.length);
                }}
              >
                + 添加步骤
              </button>
            </div>
            {draft.steps.length === 0 && <p className="muted">还没有步骤。先在卡池里加好起手，再添加第一步。</p>}
            {draft.steps.map((s, i) => (
              <StepEditor
                key={s.id}
                step={s}
                index={i}
                total={draft.steps.length}
                pool={pool}
                hits={hits.filter((h) => h.stepId === s.id)}
                onOpenHandtraps={() => {
                  setSelected(i);
                  setHtStep(i);
                }}
                selected={selected === i}
                onSelect={() => setSelected(i)}
                onChange={(step) => setSteps(draft.steps.map((x, j) => (j === i ? step : x)))}
                onRemove={() => {
                  setSteps(draft.steps.filter((_, j) => j !== i));
                  setSelected(Math.max(0, Math.min(selected, draft.steps.length - 2)));
                }}
                onMoveStep={(dir) => moveStep(i, dir)}
              />
            ))}
            {draft.steps.length > 0 && (
              <button
                className="btn"
                onClick={() => {
                  setSteps([...draft.steps, newStep(draft.steps)]);
                  setSelected(draft.steps.length);
                }}
              >
                + 添加步骤
              </button>
            )}
          </section>

          <section className="panel">
            <div className="sub-head">
              <h2 className="section-title">终场</h2>
              <button className="btn" onClick={fillEndboard}>
                用最后一步的场面填入
              </button>
            </div>
            <div className="chips-edit">
              {draft.endboard.cards.length === 0 && <span className="muted">还没有</span>}
              {draft.endboard.cards.map((c, i) => (
                <span key={`${c.id}-${i}`} className="chip">
                  {c.name}
                  <button
                    aria-label={`移除 ${c.name}`}
                    onClick={() => update({ endboard: { ...draft.endboard, cards: draft.endboard.cards.filter((_, j) => j !== i) } })}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <label className="field-label" htmlFor="f-end">
              终场说明
            </label>
            <textarea
              id="f-end"
              value={draft.endboard.description}
              onChange={(e) => update({ endboard: { ...draft.endboard, description: e.target.value } })}
              placeholder="终场能做什么、对手回合怎么干扰"
            />
          </section>
        </div>

        <aside className="editor-preview">
          <div className="preview-head">
            <span className="eyebrow">预览</span>
            <span>{draft.steps.length ? `第 ${selected + 1} 步之后` : "起手"}</span>
            <span className="grow" />
            <button className="mini" onClick={() => setSelected(Math.max(0, selected - 1))} disabled={selected <= 0} aria-label="上一步">
              ◀
            </button>
            <button
              className="mini"
              onClick={() => setSelected(Math.min(draft.steps.length - 1, selected + 1))}
              disabled={selected >= draft.steps.length - 1}
              aria-label="下一步"
            >
              ▶
            </button>
          </div>
          <Field board={frame.board} moved={frame.moved} cards={cards} onOpen={setOpenCard} />
          {sim.error && <p className="errors-inline">{sim.error}</p>}
          {selectedStep && (
            <div className="preview-hits">
              <div className="sub-head">
                <div className="pool-label">这一步能打的手坑（按重要性）</div>
                <button className="btn" onClick={() => setHtStep(selected)}>
                  排序和备注
                </button>
              </div>
              {stepHits.length === 0 && <div className="muted">没有常见手坑能打。</div>}
              {stepHits.map((h) => (
                <div key={h.handtrap} className={`hit ${h.impact ? `s-${h.impact}` : "s-auto"}`}>
                  <span />
                  <div>
                    <span className="hname">{handtrapById.get(h.handtrap)?.name}</span>
                    <span className="htag">{h.impact ? IMPACT_LABEL[h.impact] : "自动推导"}</span>
                    <p>{h.note ?? h.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      <div className="save-bar">
        <div className="status">
          {validation.ok ? (
            <span className="ok">{saved ? "已保存到这台设备" : "可以保存"}</span>
          ) : (
            <details>
              <summary>还有 {validation.errors.length} 个问题需要处理</summary>
              <ul className="errors">
                {validation.errors.slice(0, 20).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
        <div className="actions">
          <button className="btn" onClick={() => downloadCombo(draft)}>
            导出 JSON
          </button>
          {saved && (
            <a className="btn" href={href.view(draft.id)}>
              在场地上打开
            </a>
          )}
          <button className="btn primary" onClick={save} disabled={!validation.ok}>
            保存
          </button>
        </div>
      </div>

      {htStep !== null && draft.steps[htStep] && (
        <HandtrapWindow
          key={draft.steps[htStep].id}
          step={draft.steps[htStep]}
          stepIndex={htStep}
          steps={draft.steps}
          hits={hits.filter((h) => h.stepId === draft.steps[htStep].id)}
          autoHits={autoHits.filter((h) => h.stepId === draft.steps[htStep].id)}
          cards={cards}
          onApply={(interruptions) => setSteps(draft.steps.map((x, j) => (j === htStep ? { ...x, interruptions } : x)))}
          onClose={() => setHtStep(null)}
        />
      )}
      {openCard !== null && (
        <CardDetail
          id={openCard}
          name={cards.get(openCard)?.name ?? pool.find((c) => c.id === openCard)?.name ?? String(openCard)}
          info={cards.get(openCard)}
          handtrap={handtrapById.get(openCard)}
          onClose={() => setOpenCard(null)}
        />
      )}
    </main>
  );
}

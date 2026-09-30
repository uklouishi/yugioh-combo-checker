import { useMemo, useRef, useState } from "react";
import { useCards } from "../cards/useCards";
import { handtrapById, handtraps as catalog } from "../data";
import { useCombos } from "../data/store";
import { analyzeCombo } from "../model/analysis";
import { handtrapPriorities } from "../model/priority";
import type { Interruption } from "../model/interruptions";
import type { Combo } from "../model/schema";
import { href } from "../router";
import { downloadPng } from "../ui/download";
import { IMPACT_LABEL, PriorityPanel } from "../ui/PriorityPanel";

export { IMPACT_LABEL };
import { NotFound } from "./NotFound";

const TIMING: Record<string, string> = {
  chain_to_activation: "连锁发动",
  after_summon: "召唤成功后",
  after_resolution: "效果处理后",
};
const cls = (i: Interruption | null | undefined) => (i ? (i.impact ? `s-${i.impact}` : "s-auto") : "");
const label = (i: Interruption) => (i.impact ? IMPACT_LABEL[i.impact] : "自动推导");

export function AnalyzePage({ id }: { id?: string }) {
  const { all } = useCombos();
  if (!id) return <Picker combos={all} />;
  const combo = all.find((c) => c.id === id);
  if (!combo) return <NotFound what="这个 combo" />;
  return <Analysis combo={combo} />;
}

function Picker({ combos }: { combos: Combo[] }) {
  return (
    <main className="page">
      <h1>分析 Combo</h1>
      <p className="muted">选择要分析的 combo。</p>
      <ul className="combo-list">
        {combos.map((c) => {
          const a = analyzeCombo(c);
          return (
            <li key={c.id}>
              <div className="info">
                <div className="eyebrow">{c.deck}</div>
                <a className="ctitle" href={href.analyze(c.id)}>
                  {c.title}
                </a>
                <div className="muted">
                  {a.stepCount} 步 · {a.handtraps.length} 种手坑能打
                </div>
              </div>
              <div className="row-actions">
                <a className="btn primary" href={href.analyze(c.id)}>
                  分析
                </a>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

function Analysis({ combo }: { combo: Combo }) {
  const a = useMemo(() => analyzeCombo(combo), [combo]);
  const cards = useCards(catalog.map((h) => h.id));
  const [selected, setSelected] = useState<Interruption | null>(() => handtrapPriorities(combo)[0]?.hit ?? null);
  const report = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const stepNo = (stepId: string) => combo.steps.findIndex((s) => s.id === stepId) + 1;
  const name = (id: number) => handtrapById.get(id)?.name ?? String(id);
  const safe = catalog.filter((h) => !a.handtraps.some((s) => s.handtrap === h.id));

  const exportPng = async () => {
    if (!report.current) return;
    setExporting(true);
    try {
      await downloadPng(report.current, `${combo.id.replace(/[^\w-]+/g, "-")}-analysis.png`);
    } catch (e) {
      window.alert(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <main className="page">
      <div className="report" ref={report}>
        <div className="page-head">
          <div>
            <div className="eyebrow">
              {combo.deck} · {combo.format} · 分析
            </div>
            <h1>{combo.title}</h1>
          </div>
          <div className="actions no-export">
            {combo.id.startsWith("play-") && (
              <a className="btn" href={href.play()}>
                ← 回到练习
              </a>
            )}
            <button className="btn" onClick={() => void exportPng()} disabled={exporting}>
              {exporting ? "导出中…" : "导出 PNG"}
            </button>
            <a className="btn primary" href={href.view(combo.id)}>
              在场地上播放
            </a>
          </div>
        </div>

        <section className="stats">
          <div>
            <span className="num">{a.stepCount}</span>
            <span className="lbl">步骤</span>
          </div>
          <div>
            <span className="num">{a.normalSummons + a.specialSummons}</span>
            <span className="lbl">召唤（其中特召 {a.specialSummons}）</span>
          </div>
          <div>
            <span className="num">{a.handtraps.length}</span>
            <span className="lbl">种手坑能打</span>
          </div>
          <div className={a.firstComboEnd ? "s-combo_ends" : ""}>
            <span className="num">{a.firstComboEnd ? `第 ${a.firstComboEnd} 步` : "无"}</span>
            <span className="lbl">最早可能被直接断</span>
          </div>
        </section>

        <PriorityPanel combo={combo} name={name} cards={cards} selected={selected} onSelect={setSelected} />
        {safe.length > 0 && <p className="muted">这条展开不吃：{safe.map((h) => h.name).join(", ")}。</p>}
      </div>

      <section>
        <h2 className="section-title">手坑 × 步骤</h2>
        <div className="legend">
          <span style={{ ["--c" as string]: "var(--stop)" }}>直接断</span>
          <span style={{ ["--c" as string]: "var(--route)" }}>有备用路线</span>
          <span style={{ ["--c" as string]: "var(--warn)" }}>终场变弱</span>
          <span style={{ ["--c" as string]: "var(--minor)" }}>影响小 / 自动推导</span>
        </div>
        <div className="matrix-scroll">
          <table className="matrix">
            <thead>
              <tr>
                <th scope="col">手坑</th>
                {combo.steps.map((s, i) => (
                  <th key={s.id} scope="col" title={s.title}>
                    {i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {a.handtraps.map((t) => (
                <tr key={t.handtrap}>
                  <th scope="row">{name(t.handtrap)}</th>
                  {combo.steps.map((s) => {
                    const hit = t.hits.find((h) => h.stepId === s.id);
                    return (
                      <td key={s.id}>
                        {hit && (
                          <button
                            className={`cell ${cls(hit)}${selected === hit ? " on" : ""}`}
                            onClick={() => setSelected(hit)}
                            aria-label={`${name(t.handtrap)}，第 ${stepNo(s.id)} 步：${label(hit)}`}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selected && (
        <section className={`detail-card ${cls(selected)}`} aria-live="polite">
          <div className="eyebrow">
            第 {stepNo(selected.stepId)} 步 · {TIMING[selected.timing]}
          </div>
          <h3>
            {name(selected.handtrap)}：{label(selected)}
          </h3>
          <p className="muted">{combo.steps[stepNo(selected.stepId) - 1].title}</p>
          <p>{selected.note ?? selected.reason}</p>
          <a className="btn" href={href.view(combo.id, stepNo(selected.stepId))}>
            在场地上看这一步
          </a>
        </section>
      )}
    </main>
  );
}

import { useRef, useState } from "react";
import type { CardInfo } from "../cards/ygoprodeck";
import { handtrapById, handtraps } from "../data";
import type { Interruption } from "../model/interruptions";
import type { InterruptionImpact, InterruptionNote, Step } from "../model/schema";
import { CardView } from "../ui/CardView";
import { IMPACT_OPTIONS } from "./labels";

const TIMING: Record<string, string> = {
  chain_to_activation: "连锁发动",
  after_summon: "召唤成功后",
  after_resolution: "效果处理后",
};

interface Row {
  handtrap: number;
  impact?: InterruptionImpact;
  note: string;
  applies: boolean;
  fallbackStepId?: string;
  /** 自动推导的理由；作者手动加的手坑为 undefined。 */
  reason?: string;
  timing?: string;
}

interface Props {
  step: Step;
  stepIndex: number;
  steps: Step[];
  /** 这一步合并后的吃坑点（包含自动识别的）。 */
  hits: Interruption[];
  /** 不带作者说明时自动识别出的吃坑点，用于「恢复默认」。 */
  autoHits: Interruption[];
  cards: Map<number, CardInfo>;
  onApply: (notes: InterruptionNote[]) => void;
  onClose: () => void;
}

function initialRows(step: Step, hits: Interruption[], autoHits: Interruption[]): Row[] {
  const autoOf = (id: number) => autoHits.find((h) => h.handtrap === id);
  const rows: Row[] = step.interruptions.map((n) => {
    const auto = autoOf(n.handtrap);
    return {
      handtrap: n.handtrap,
      impact: n.impact,
      note: n.note || auto?.reason || "",
      applies: n.applies,
      fallbackStepId: n.fallbackStepId,
      reason: auto?.reason,
      timing: auto?.timing,
    };
  });
  for (const h of hits) {
    if (rows.some((r) => r.handtrap === h.handtrap)) continue;
    rows.push({ handtrap: h.handtrap, note: h.reason, applies: true, reason: h.reason, timing: h.timing });
  }
  return rows;
}

const defaultRows = (autoHits: Interruption[]): Row[] =>
  autoHits
    .filter((h, i) => autoHits.findIndex((x) => x.handtrap === h.handtrap) === i)
    .map((h) => ({ handtrap: h.handtrap, note: h.reason, applies: true, reason: h.reason, timing: h.timing }));

/** 悬浮窗：给这一步的吃坑点排重要性、标影响、改备注。 */
export function HandtrapWindow({ step, stepIndex, steps, hits, autoHits, cards, onApply, onClose }: Props) {
  const [rows, setRows] = useState<Row[]>(() => initialRows(step, hits, autoHits));
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState<number | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= rows.length || from === to) return;
    const next = [...rows];
    const [r] = next.splice(from, 1);
    next.splice(to, 0, r);
    setRows(next);
  };

  const apply = () => {
    onApply(
      rows.map((r) => ({
        handtrap: r.handtrap,
        impact: r.impact,
        // 没改过的默认备注不保存，之后自动理由更新时会跟着更新
        note: r.note === r.reason ? "" : r.note,
        applies: r.applies,
        fallbackStepId: r.impact === "reroute" ? r.fallbackStepId : undefined,
      })),
    );
    onClose();
  };

  const available = handtraps.filter((h) => !rows.some((r) => r.handtrap === h.id));
  const name = (id: number) => handtrapById.get(id)?.name ?? String(id);

  return (
    <div className="float-window" style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }} role="dialog" aria-label="吃坑点排序和备注">
      <header
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) setOffset({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y });
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <div>
          <div className="eyebrow">第 {stepIndex + 1} 步 · 吃坑点</div>
          <div className="wtitle">{step.title || "未命名步骤"}</div>
        </div>
        <button className="mini" onClick={onClose} aria-label="关闭">
          ✕
        </button>
      </header>
      <div className="wbody">
        <p className="muted">越靠上越重要。拖动或用 ↑↓ 调整顺序，播放页会按这个顺序显示。</p>
        {rows.length === 0 && <p className="muted">这一步没有自动识别出的吃坑点，可以在下面手动添加。</p>}
        <ol className="ht-rows">
          {rows.map((r, i) => (
            <li
              key={r.handtrap}
              className={`ht-row${r.applies ? "" : " off"}${dragging === i ? " dragging" : ""}`}
              draggable
              onDragStart={(e) => {
                setDragging(i);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragging !== null && dragging !== i) {
                  move(dragging, i);
                  setDragging(i);
                }
              }}
              onDragEnd={() => setDragging(null)}
            >
              <div className="ht-head">
                <span className="grip" aria-hidden>
                  ⠿
                </span>
                <span className="rank">{i + 1}</span>
                <span className="thumb">
                  <CardView id={r.handtrap} name={name(r.handtrap)} info={cards.get(r.handtrap)} />
                </span>
                <span className="ht-name">
                  {name(r.handtrap)}
                  <span className="muted">{r.timing ? ` · ${TIMING[r.timing]}` : " · 手动添加"}</span>
                </span>
                <span className="ht-tools">
                  <button className="mini" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label="上移">
                    ↑
                  </button>
                  <button className="mini" onClick={() => move(i, i + 1)} disabled={i === rows.length - 1} aria-label="下移">
                    ↓
                  </button>
                  {!r.reason && (
                    <button className="mini" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="移除">
                      移除
                    </button>
                  )}
                </span>
              </div>
              <div className="ht-controls">
                <select
                  id={`ht-${step.id}-${r.handtrap}-impact`}
                  value={r.impact ?? ""}
                  onChange={(e) => setRow(i, { impact: (e.target.value || undefined) as InterruptionImpact | undefined })}
                  aria-label="打断后的影响"
                >
                  <option value="">未评估</option>
                  {IMPACT_OPTIONS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                {r.impact === "reroute" && (
                  <select
                    id={`ht-${step.id}-${r.handtrap}-fallback`}
                    value={r.fallbackStepId ?? ""}
                    onChange={(e) => setRow(i, { fallbackStepId: e.target.value || undefined })}
                    aria-label="备用路线从哪一步继续"
                  >
                    <option value="">备用路线从…</option>
                    {steps.map((s, k) => (
                      <option key={s.id} value={s.id}>
                        第 {k + 1} 步
                      </option>
                    ))}
                  </select>
                )}
                <label className="check">
                  <input
                    id={`ht-${step.id}-${r.handtrap}-applies`}
                    type="checkbox"
                    checked={!r.applies}
                    onChange={(e) => setRow(i, { applies: !e.target.checked })}
                  />
                  实际打不了
                </label>
              </div>
              <textarea
                id={`ht-${step.id}-${r.handtrap}-note`}
                value={r.note}
                onChange={(e) => setRow(i, { note: e.target.value })}
                placeholder="被打断后会怎样，怎么应对"
                rows={2}
              />
              {r.reason && r.note !== r.reason && (
                <button className="linkish small" onClick={() => setRow(i, { note: r.reason! })}>
                  恢复默认备注
                </button>
              )}
            </li>
          ))}
        </ol>
        {available.length > 0 && (
          <select
            id={`ht-${step.id}-add`}
            value=""
            onChange={(e) => {
              const id = Number(e.target.value);
              if (id) setRows([...rows, { handtrap: id, note: "", applies: true }]);
            }}
            aria-label="手动添加手坑"
          >
            <option value="">+ 手动添加其他手坑…</option>
            {available.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <footer>
        <button className="btn" onClick={() => setRows(defaultRows(autoHits))}>
          全部恢复默认
        </button>
        <span className="grow" />
        <button className="btn" onClick={onClose}>
          取消
        </button>
        <button className="btn primary" onClick={apply}>
          完成
        </button>
      </footer>
    </div>
  );
}

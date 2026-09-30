import { useEffect, useMemo, useState } from "react";
import type { CardInfo } from "../cards/ygoprodeck";
import type { Interruption } from "../model/interruptions";
import { handtrapPriorities, type HandtrapPriority } from "../model/priority";
import type { Combo, InterruptionImpact } from "../model/schema";
import { CardView } from "./CardView";

export const IMPACT_LABEL: Record<InterruptionImpact, string> = {
  combo_ends: "直接断",
  reroute: "有备用路线",
  reduced_endboard: "终场变弱",
  minor: "影响小",
};

/** 玩家的手动修正，按 combo 存在浏览器里。 */
interface Edits {
  order: number[];
  impact: Record<number, InterruptionImpact>;
}

const key = (id: string) => `ht-priority-v1:${id}`;

function loadEdits(id: string): Edits | null {
  try {
    const raw = localStorage.getItem(key(id));
    return raw ? (JSON.parse(raw) as Edits) : null;
  } catch {
    return null;
  }
}

function saveEdits(id: string, e: Edits | null) {
  try {
    if (e) localStorage.setItem(key(id), JSON.stringify(e));
    else localStorage.removeItem(key(id));
  } catch {
    // 存储不可用时只在本次有效
  }
}

/** 按修正后的顺序排列；修正里没有的（combo 改过后新出现的手坑）按自动顺序接在后面。 */
export function applyEdits(auto: HandtrapPriority[], edits: Edits | null): HandtrapPriority[] {
  if (!edits) return auto;
  const byId = new Map(auto.map((p) => [p.handtrap, p]));
  const ordered = edits.order.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const rest = auto.filter((p) => !edits.order.includes(p.handtrap));
  return [...ordered, ...rest].map((p) => (edits.impact[p.handtrap] ? { ...p, impact: edits.impact[p.handtrap] } : p));
}

interface Props {
  combo: Combo;
  name: (id: number) => string;
  cards: Map<number, CardInfo>;
  selected: Interruption | null;
  onSelect: (i: Interruption) => void;
}

/** 手坑优先级：算法自动排序，玩家可以上下调整顺序、改影响，修正会记在本机。 */
export function PriorityPanel({ combo, name, cards, selected, onSelect }: Props) {
  const auto = useMemo(() => handtrapPriorities(combo), [combo]);
  const [edits, setEdits] = useState<Edits | null>(() => loadEdits(combo.id));
  useEffect(() => saveEdits(combo.id, edits), [combo.id, edits]);
  const list = applyEdits(auto, edits);

  const update = (order: number[], impact: Record<number, InterruptionImpact>) => setEdits({ order, impact });
  const move = (i: number, d: number) => {
    const order = list.map((p) => p.handtrap);
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    update(order, edits?.impact ?? {});
  };
  const setImpact = (id: number, v: InterruptionImpact) =>
    update(
      list.map((p) => p.handtrap),
      { ...(edits?.impact ?? {}), [id]: v },
    );

  return (
    <section className="priority">
      <div className="sub-head">
        <h2 className="section-title">手坑优先级</h2>
        {edits && (
          <button className="btn small no-export" onClick={() => setEdits(null)}>
            恢复自动排序
          </button>
        )}
      </div>
      <p className="muted">
        {edits ? "已按你的调整排序。" : "算法按「这张手坑在最痛的时点打下去，会让多少步骤做不了、终场少几张」自动排序，越靠前越该防。"}
        <span className="no-export">用 ↑↓ 调整顺序，点影响标签可以改；调整只保存在这台设备上。</span>
      </p>
      <ol className="prio-list">
        {list.map((p, i) => (
          <li key={p.handtrap} className={`prio s-${p.impact}${selected === p.hit ? " on" : ""}`}>
            <span className="prio-rank">{i + 1}</span>
            <div className="prio-main">
              <span className="thumb">
                <CardView id={p.handtrap} name={name(p.handtrap)} info={cards.get(p.handtrap)} onOpen={() => onSelect(p.hit)} />
              </span>
              <button className="prio-text" onClick={() => onSelect(p.hit)}>
                <span className="prio-name">{name(p.handtrap)}</span>
                <span className="prio-reason">{p.reason}</span>
              </button>
            </div>
            <span className="prio-side">
              <select className="prio-impact" value={p.impact} onChange={(e) => setImpact(p.handtrap, e.target.value as InterruptionImpact)} aria-label={`${name(p.handtrap)} 的影响`}>
                {(Object.keys(IMPACT_LABEL) as InterruptionImpact[]).map((k) => (
                  <option key={k} value={k}>
                    {IMPACT_LABEL[k]}
                  </option>
                ))}
              </select>
              <span className="prio-bar" title={`损失估计 ${Math.round(p.score * 100)}%`}>
                <span style={{ width: `${Math.max(4, p.score * 100)}%` }} />
              </span>
              <span className="prio-move no-export">
                <button className="mini" onClick={() => move(i, -1)} disabled={i === 0} aria-label="上移">
                  ↑
                </button>
                <button className="mini" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label="下移">
                  ↓
                </button>
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

import { useRef, useState } from "react";
import { handtrapById } from "../data";
import type { EngineData } from "../engine/data";
import type { Action, Hit } from "../engine/session";
import { CardView } from "../ui/CardView";

interface Props {
  data: EngineData;
  hits: Hit[];
  actions: Action[];
  busy: boolean;
  onActivate: (hit: Hit, index: number) => void;
}

/**
 * 吃坑点悬浮窗：引擎每次问对手「要不要连锁」时，把对手能发动的手坑记下来。
 * 最新的操作展开显示；点「让对手发动」会回到那个时点，由对手发动这张手坑。
 */
export function HitWindow({ data, hits, actions, busy, onActivate }: Props) {
  const [collapsed, setCollapsed] = useState(() => typeof window !== "undefined" && window.innerWidth < 700);
  const [showAll, setShowAll] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const current = actions.length - 1;
  const byAction = new Map<number, Hit[]>();
  for (const h of hits) byAction.set(h.action, [...(byAction.get(h.action) ?? []), h]);
  const shown = [...byAction.keys()].sort((a, b) => b - a).filter((a, i) => showAll || i === 0 || a === current);
  const total = new Set(hits.flatMap((h) => h.options.map((o) => `${h.action}:${o.code}`))).size;

  return (
    <aside className={`hit-window${collapsed ? " collapsed" : ""}`} style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }} aria-label="吃坑点">
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
        <span className="hw-title">
          吃坑点 <span className="badge">{total}</span>
        </span>
        <button className="mini" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? "展开" : "收起"}>
          {collapsed ? "▴" : "▾"}
        </button>
      </header>
      {!collapsed && (
        <div className="hw-body">
          {hits.length === 0 && <p className="muted">还没有吃坑点。对手能连锁手坑时会显示在这里。</p>}
          {shown.map((a) => (
            <section key={a} className={a === current ? "now" : undefined}>
              <div className="hw-action">
                {a < 0 ? "开局" : `操作 ${a + 1}：${actions[a]?.label ?? ""}`}
                {a === current && <span className="tag">刚才</span>}
              </div>
              {byAction.get(a)!.map((h) => (
                <div key={h.at} className="hw-hit">
                  <div className="muted">{h.context}时，对手可以连锁：</div>
                  <ul>
                    {h.options.map((o) => {
                      const ht = handtrapById.get(o.code);
                      const used = h.used === o.code;
                      return (
                        <li key={o.code} className={used ? "used" : undefined}>
                          <span className="thumb">
                            <CardView id={o.code} name={data.name(o.code)} />
                          </span>
                          <span className="hw-name" title={ht?.summary}>
                            {data.name(o.code)}
                          </span>
                          {used ? (
                            <span className="hw-used">对手发动了</span>
                          ) : (
                            <button className="btn small" disabled={busy || h.used !== undefined} onClick={() => onActivate(h, o.index)}>
                              让对手发动
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </section>
          ))}
          {byAction.size > 1 && (
            <button className="linkish small" onClick={() => setShowAll(!showAll)}>
              {showAll ? "只看最近的" : `查看全部 ${byAction.size} 个操作的吃坑点`}
            </button>
          )}
        </div>
      )}
    </aside>
  );
}

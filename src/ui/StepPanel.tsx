import { useRef, useState } from "react";
import type { CardInfo } from "../cards/ygoprodeck";
import type { Interruption } from "../model/interruptions";
import { describeActivation, describeSummon } from "../model/playback";
import type { Combo, Handtrap, Step } from "../model/schema";
import { CardView } from "./CardView";

const IMPACT: Record<string, string> = {
  combo_ends: "直接断",
  reduced_endboard: "终场变弱",
  reroute: "有备用路线",
  minor: "影响小",
};
const TIMING: Record<string, string> = {
  chain_to_activation: "连锁发动",
  after_summon: "召唤成功后",
  after_resolution: "效果处理后",
};

interface Props {
  combo: Combo;
  /** 0 是起手，1..n 是第 n 步之后。 */
  frame: number;
  hits: Interruption[];
  handtraps: Map<number, Handtrap>;
  cards: Map<number, CardInfo>;
  onFrame: (frame: number) => void;
  onOpen: (id: number) => void;
  /** 正在播放这一步的动画。 */
  playing?: boolean;
  onReplay?: () => void;
  /** 切换步骤时是否播放动画。 */
  animate?: boolean;
  onAnimate?: (on: boolean) => void;
}

/** 这一步里发生的事：发动带连锁序号，召唤写召唤方式。 */
function StepActions({ step }: { step: Step }) {
  let link = 0;
  const lines = step.actions.flatMap((a) => {
    if (a.type === "activate") {
      link = a.activation.chainLink ?? link + 1;
      return [{ chain: link, text: describeActivation(a.activation) }];
    }
    if (a.type === "summon") return [{ chain: 0, text: describeSummon(a.summon) }];
    return [];
  });
  if (!lines.length) return null;
  return (
    <ol className="step-actions">
      {lines.map((l, i) => (
        <li key={i}>
          {l.chain > 0 && <span className="link-badge">CHAIN {l.chain}</span>} {l.text}
        </li>
      ))}
    </ol>
  );
}

/** 切换步骤的悬浮窗：可以拖动、可以收起，不挡场地。 */
export function StepPanel({ combo, frame, hits, handtraps, cards, onFrame, onOpen, playing, onReplay, animate, onAnimate }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const total = combo.steps.length;
  const step = frame > 0 ? combo.steps[frame - 1] : undefined;
  // 顺序已经按作者排的重要性排好（没排过的按严重度）。
  const stepHits = step ? hits.filter((h) => h.stepId === step.id) : [];

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d) setOffset({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <aside
      className="step-panel"
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      aria-label="步骤切换"
    >
      <header onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
        <button className="arrow" onClick={() => onFrame(frame - 1)} disabled={frame === 0} aria-label="上一步">
          ◀
        </button>
        <span className="pos">{frame === 0 ? "起手" : `步骤 ${frame} / ${total}`}</span>
        <button className="arrow" onClick={() => onFrame(frame + 1)} disabled={frame === total} aria-label="下一步">
          ▶
        </button>
        {onAnimate && (
          <button
            className={`mini anim-toggle${animate ? " on" : ""}`}
            onClick={() => onAnimate(!animate)}
            aria-pressed={animate}
            title={animate ? "关闭卡片移动动画，切换步骤时直接跳到结果" : "打开卡片移动动画"}
          >
            动画 {animate ? "开" : "关"}
          </button>
        )}
        <button className="mini" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
          {collapsed ? "展开" : "收起"}
        </button>
      </header>
      {!collapsed && (
        <div className="content">
          {step ? (
            <>
              <div className="stitle">{step.title}</div>
              <StepActions step={step} />
              {onReplay && animate && (
                <button className="mini replay" onClick={onReplay} disabled={playing}>
                  {playing ? "演示中…" : "↻ 重播这一步的动画"}
                </button>
              )}
              {step.notes && <div className="snote">备注：{step.notes}</div>}
              {stepHits.length === 0 && <div className="safe">这一步没有常见手坑能打。</div>}
              {stepHits.map((h) => {
                const ht = handtraps.get(h.handtrap);
                return (
                  <div key={h.handtrap} className={`hit ${h.impact ? `s-${h.impact}` : "s-auto"}`}>
                    <div className="thumb">
                      <CardView id={h.handtrap} name={ht?.name ?? String(h.handtrap)} info={cards.get(h.handtrap)} onOpen={onOpen} />
                    </div>
                    <div>
                      <span className="hname">{ht?.name ?? h.handtrap}</span>
                      <span className="htag">
                        {h.impact ? IMPACT[h.impact] : "自动推导"} · {TIMING[h.timing]}
                      </span>
                      <p>{h.note ?? h.reason}</p>
                    </div>
                  </div>
                );
              })}
            </>
          ) : (
            <>
              <div className="stitle">起手：{combo.starter.map((c) => c.name).join("、")}</div>
              <div className="snote">点 ▶ 或按键盘右方向键开始展开。点场上任意一张卡可以查看效果。</div>
            </>
          )}
          {frame === total && <div className="snote">终场：{combo.endboard.description}</div>}
        </div>
      )}
    </aside>
  );
}

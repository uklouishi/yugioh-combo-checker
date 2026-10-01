import { useRef, useState } from "react";
import type { EngineData } from "../engine/data";
import { loadCore } from "../engine/run";
import { actionLabel, actionSig, type StudyComparison } from "../study/compare";
import type { DeckStudy, Recovery } from "../study/model";
import { probe, probeTasks, routeFollower, waypointsOf } from "../study/probe";
import { studyStore } from "../study/store";
import { starterLabel } from "../study/wildcard";
import { CardView } from "../ui/CardView";

const sameCase = (a: Recovery, b: Recovery) => a.starterId === b.starterId && a.sig === b.sig && a.card === b.card;

/**
 * 被打后能不能续上：让引擎照着每条路线打到吃坑点、对手用手坑打断，
 * 再试手里另一张卡能不能续出路线里的关键怪兽。玩家逐条确认，确认过的才算进手坑优先级。
 */
export function StudyRecovery({
  data,
  study,
  cmp,
  isHandtrap,
  onChange,
}: {
  data: EngineData;
  study: DeckStudy;
  cmp: StudyComparison;
  isHandtrap: (id: number) => boolean;
  onChange: (s: DeckStudy) => void;
}) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openCard, setOpenCard] = useState<number | null>(null);
  const cancel = useRef(false);
  const scored = cmp.routes.filter((r) => r.keyEnd.length > 0);

  const run = async () => {
    cancel.current = false;
    setError(null);
    try {
      const core = await loadCore();
      const tasks = probeTasks(study, cmp, isHandtrap);
      const waypoints = waypointsOf(cmp);
      setProgress({ done: 0, total: tasks.length });
      const found: Recovery[] = [];
      const routes = new Map<string, Awaited<ReturnType<typeof routeFollower>>>();
      let done = 0;
      let last = Date.now();
      const pause = async () => {
        // 每隔一小段时间让出主线程，页面不卡
        if (Date.now() - last < 30) return;
        await new Promise((r) => setTimeout(r, 0));
        last = Date.now();
      };
      for (const t of tasks) {
        if (cancel.current) break;
        if (!routes.has(t.starterId)) {
          const starter = study.starters.find((s) => s.id === t.starterId);
          routes.set(t.starterId, starter ? await routeFollower(core, data, study, starter) : null);
        }
        const route = routes.get(t.starterId);
        const rec = route ? await probe({ core, data, route, waypoints, pause }, t) : null;
        if (rec) found.push(rec);
        setProgress({ done: ++done, total: tasks.length });
        await pause();
      }
      // 试的时候玩家可能改了别的，按最新的存；之前确认过的结果保留
      const latest = studyStore.find(study.id) ?? study;
      const merged = found.map((r) => {
        const ok = latest.recoveries.find((o) => sameCase(o, r))?.ok;
        return ok === undefined ? r : { ...r, ok };
      });
      if (!cancel.current) onChange({ ...latest, recoveries: merged });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  const mark = (rec: Recovery, ok: boolean | undefined) =>
    onChange({ ...study, recoveries: study.recoveries.map((r) => (sameCase(r, rec) ? { ...r, ok } : r)) });
  const markAll = (ok: boolean) => onChange({ ...study, recoveries: study.recoveries.map((r) => (r.ok === undefined ? { ...r, ok } : r)) });

  const pending = study.recoveries.filter((r) => r.ok === undefined).length;
  const confirmed = study.recoveries.filter((r) => r.ok).length;
  const hitLabel = (starterId: string, sig: string) => {
    for (const step of study.routes[starterId]?.steps ?? []) for (const a of step.actions) if (actionSig(a) === sig) return actionLabel(a);
    return sig;
  };
  // 按卡分组：同一张卡在不同路线、不同吃坑点的续法一起确认
  const byCard = new Map<number, Recovery[]>();
  for (const r of study.recoveries) byCard.set(r.card, [...(byCard.get(r.card) ?? []), r]);
  const cardGroups = [...byCard].sort((a, b) => b[1].length - a[1].length);
  const markCard = (card: number, ok: boolean) =>
    onChange({ ...study, recoveries: study.recoveries.map((r) => (r.card === card ? { ...r, ok: r.ok === ok && study.recoveries.filter((x) => x.card === card).every((x) => x.ok === ok) ? undefined : ok } : r)) });
  const openRecs = openCard === null ? null : byCard.get(openCard);
  const stateOf = (recs: Recovery[]) => (recs.every((r) => r.ok === true) ? true : recs.every((r) => r.ok === false) ? false : recs.every((r) => r.ok === undefined) ? undefined : null);
  const routeName = (id: string) => {
    const st = study.starters.find((s) => s.id === id);
    return st ? starterLabel(data, st) : "?";
  };

  return (
    <div className="probe">
      <h3 className="sub-title">被打后能不能续上</h3>
      <p className="probe-tip">建议所有动点都打完后，先在这里让引擎试一遍并确认结果，再看下面的手坑优先级。确认过的续法才会算进优先级。</p>
      <p className="muted">
        让引擎照着你打过的每条路线打，到吃坑点时对手用手坑打断，再试手里另有某一张卡时能不能续出路线里的关键怪兽（额外怪兽、仪式怪兽或重要终端）。
        结果按卡列出，点「对」的才算进下面的手坑优先级；点卡下面的「几处」可以逐个吃坑点看和改。对手会挑你续不上的那一下打。
      </p>
      {!scored.length ? (
        <p className="muted">先打完至少一条有重要终端的路线。</p>
      ) : progress ? (
        <div className="probe-progress">
          <progress value={progress.done} max={progress.total} />
          <span className="muted">
            正在试 {progress.done} / {progress.total}
          </span>
          <button className="btn" onClick={() => (cancel.current = true)}>
            停止
          </button>
        </div>
      ) : (
        <div className="row-actions">
          <button className="btn primary" onClick={() => void run()}>
            {study.recoveries.length ? "重新试一遍" : "让引擎试一遍"}
          </button>
          {study.recoveries.length > 0 && (
            <span className="muted">
              {cardGroups.length} 张卡能续上（共 {study.recoveries.length} 种情况），确认对的 {confirmed} 种，还没确认 {pending} 种
            </span>
          )}
        </div>
      )}
      {error && <p className="errors-inline">引擎出错了：{error}</p>}
      {pending > 0 && !progress && (
        <div className="row-actions">
          <button className="mini" onClick={() => markAll(true)}>
            没确认的全部算对
          </button>
          <button className="mini" onClick={() => markAll(false)}>
            没确认的全部算不对
          </button>
        </div>
      )}
      {cardGroups.length > 0 && <p className="muted">点卡切换「对 / 不对」：绿框是对，变灰是不对，虚线框是还没确认。卡下面的小图是被打后能续出的怪兽。</p>}
      <ul className="probe-wall">
        {cardGroups.map(([card, recs]) => {
          const state = stateOf(recs);
          const routes = new Set(recs.map((r) => r.starterId)).size;
          const reached = [...new Set(recs.map((r) => r.reached))];
          const cls = state === true ? "ok" : state === false ? "no" : state === null ? "partial" : "pending";
          const stateText = state === true ? "对" : state === false ? "不对" : state === null ? "部分确认" : "没确认";
          return (
            <li key={card} className={`${cls}${openCard === card ? " open" : ""}`}>
              <button
                className="probe-card"
                onClick={() => markCard(card, state !== true)}
                title={`${data.name(card)}：被打后能续出 ${reached.map((c) => data.name(c)).join("、")}（${stateText}，点一下切换）`}
                aria-pressed={state === true}
              >
                <span className="thumb">
                  <CardView id={card} name={data.name(card)} />
                </span>
                <span className="probe-mark">{state === true ? "✓" : state === false ? "✕" : "?"}</span>
              </button>
              <span className="probe-name">{data.name(card)}</span>
              <span className="probe-reached" aria-label={`能续出 ${reached.map((c) => data.name(c)).join("、")}`}>
                {reached.map((c) => (
                  <span key={c} className="thumb" title={data.name(c)}>
                    <CardView id={c} name={data.name(c)} />
                  </span>
                ))}
              </span>
              <button
                className="mini probe-more"
                onClick={() => setOpenCard(openCard === card ? null : card)}
                aria-expanded={openCard === card}
                title={`${routes} 条路线、${recs.length} 个吃坑点，点开逐个看`}
              >
                {recs.length} 处 ▾
              </button>
            </li>
          );
        })}
      </ul>
      {openRecs && openCard !== null && (
        <div className="probe-detail">
          <div className="probe-detail-head">
            <strong>手里有 {data.name(openCard)}</strong>
            <button className="mini" onClick={() => setOpenCard(null)}>
              收起
            </button>
          </div>
          <ul className="probe-cases">
            {openRecs.map((r) => (
              <li key={`${r.starterId}|${r.sig}`}>
                <label className="muted">
                  <input type="checkbox" checked={r.ok === true} onChange={(e) => mark(r, e.target.checked ? true : false)} />
                  {routeName(r.starterId)} · 被 {data.name(r.handtrap)} 打在「{hitLabel(r.starterId, r.sig)}」：{r.line.join(" → ")}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
      {study.recoveries.length > 0 && <p className="muted">没列出来的情况是引擎没试出续法（或者路线没能照着重放到吃坑点）。被 Nibiru 这类打召唤次数的手坑断掉的情况不试。</p>}
    </div>
  );
}

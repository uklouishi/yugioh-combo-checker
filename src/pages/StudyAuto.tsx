import { useRef, useState } from "react";
import { comboStore } from "../data/store";
import type { EngineData } from "../engine/data";
import { decodeReplay, encodeReplay } from "../engine/replay";
import { loadCore } from "../engine/run";
import { practiceSetup } from "../play/DeckSetup";
import { canExport, toCombo } from "../play/toCombo";
import { queueDuel } from "../play/useDuel";
import { href, navigate } from "../router";
import { autoplay, type AutoTarget } from "../study/autoplay";
import { keyTarget, ZONE_LABEL } from "../study/endboard";
import { saveRoute, starterHand, type DeckStudy, type Starter } from "../study/model";
import { setStudyTarget, studyStore } from "../study/store";
import { practiceMain, starterLabel } from "../study/wildcard";
import { CardView } from "../ui/CardView";

const TIME_OPTIONS = [15, 30, 60, 120];

export interface AutoProgress {
  starter: string;
  index: number;
  total: number;
  seconds: number;
  nodes: number;
}

/** 引擎能打的重要终端（有卡片数据的）。 */
const targetsOf = (data: EngineData, study: DeckStudy): AutoTarget[] =>
  study.keyCards.filter((c) => data.cards.has(c)).map((card) => ({ card, ...keyTarget(study, card) }));

/** 快捷模式：让引擎一个个动点自己打，结果存成路线。 */
export function useAutoRunner(data: EngineData, study: DeckStudy) {
  const [progress, setProgress] = useState<AutoProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(30);
  const cancel = useRef(false);

  const run = async (starters: Starter[]) => {
    if (progress || !starters.length) return;
    cancel.current = false;
    setError(null);
    const failed: string[] = [];
    try {
      const core = await loadCore();
      let last = Date.now();
      const pause = async () => {
        // 每隔一小段时间让出主线程，页面不卡
        if (Date.now() - last < 30) return;
        await new Promise((r) => setTimeout(r, 0));
        last = Date.now();
      };
      for (const [i, s] of starters.entries()) {
        if (cancel.current) break;
        const name = starterLabel(data, s);
        setProgress({ starter: name, index: i, total: starters.length, seconds: 0, nodes: 0 });
        const latest = studyStore.find(study.id) ?? study;
        const setup = practiceSetup(data, { main: practiceMain(latest, s), extra: latest.extra, hand: starterHand(s), format: latest.format });
        const r = await autoplay({
          core,
          data,
          setup,
          targets: targetsOf(data, latest),
          timeMs: seconds * 1000,
          pause,
          cancelled: () => cancel.current,
          onProgress: (p) => setProgress({ starter: name, index: i, total: starters.length, seconds: Math.round(p.elapsed / 1000), nodes: p.nodes }),
        });
        if (cancel.current) {
          r?.session.destroy();
          break;
        }
        if (!r || r.session.status !== "turn_over" || !canExport(r.session)) {
          r?.session.destroy();
          failed.push(name);
          continue;
        }
        try {
          const combo = toCombo(r.session, { title: `${latest.name}：${name}（电脑生成）`, deck: latest.name });
          combo.id = `${latest.id}-${s.id}`;
          const missing = r.met.filter((m) => !m.ok).map((m) => m.card);
          const skipped = (latest.auto[s.id]?.skipped ?? []).filter((c) => missing.includes(c));
          const replay = encodeReplay({ setup: r.session.setup, responses: r.session.responses });
          // 生成的时候玩家可能改了别的，按最新的存
          const now = studyStore.find(study.id) ?? latest;
          studyStore.save(saveRoute(now, s.id, combo, replay, { openAt: r.openAt, missing, skipped, timedOut: r.timedOut }));
          if (comboStore.isMine(combo.id)) comboStore.save([combo]);
        } catch {
          failed.push(name);
        } finally {
          r.session.destroy();
        }
      }
      if (failed.length) setError(`${failed.join("、")}：引擎没打出能保存的路线，请自己打一遍。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  return { run, progress, error, seconds, setSeconds, stop: () => (cancel.current = true) };
}

export type AutoRunner = ReturnType<typeof useAutoRunner>;

/** 在练习里打开电脑生成的路线：停在结束回合之前，可以撤销到任意一步换打法。 */
export function editInPractice(study: DeckStudy, s: Starter) {
  const replay = study.replays[s.id] ? decodeReplay(study.replays[s.id]) : null;
  if (!replay) return window.alert("这条路线没有对局记录，请点「重打」自己打一遍。");
  const at = study.auto[s.id]?.openAt;
  const hand = starterHand(s);
  queueDuel(replay.setup, at === undefined ? replay.responses : replay.responses.slice(0, at));
  setStudyTarget({ studyId: study.id, starterId: s.id, hand });
  navigate(href.play());
}

/** 第 4 步上面的快捷模式说明和按钮。 */
export function AutoPanel({ data, study, runner }: { data: EngineData; study: DeckStudy; runner: AutoRunner }) {
  const { progress, error, seconds, setSeconds, run, stop } = runner;
  const todo = study.starters.filter((s) => !study.routes[s.id]);
  const unknown = study.keyCards.filter((c) => !data.cards.has(c));
  const notInDeck = study.keyCards.filter((c) => data.cards.has(c) && !study.main.includes(c) && !study.extra.includes(c));
  return (
    <div className="auto-panel">
      <p className="muted">
        <strong>快捷模式</strong>：让电脑自己从起手打到终场，朝着第 3 步标的重要终端去打（最高优先的先争取；没标时尽量多出额外卡组的怪兽），打出来的路线可以播放和分析。
        计算在你自己的设备上进行，每个动点最多算设定的时间。
      </p>
      <p className="probe-tip">电脑生成的展开不一定是最优展开，只是电脑在时间内找到的打法。可以点「在练习里改」自己优化，保存后会替换掉电脑的路线。</p>
      {(unknown.length > 0 || notInDeck.length > 0) && (
        <p className="errors-inline">
          {unknown.length > 0 && `引擎没有这些卡的数据，电脑打不出来：${unknown.map((c) => data.name(c)).join("、")}。`}
          {notInDeck.length > 0 && `这些重要终端不在主卡组或额外卡组里，只能靠别的卡放到场上：${notInDeck.map((c) => data.name(c)).join("、")}。`}
          请在练习里自己打出这些卡。
        </p>
      )}
      {progress ? (
        <div className="probe-progress">
          <progress value={progress.index} max={progress.total} />
          <span className="muted">
            正在打 {progress.starter}（{progress.index + 1} / {progress.total}）· 已试 {progress.nodes} 种 · {progress.seconds} 秒
          </span>
          <button className="btn" onClick={stop}>
            停止
          </button>
        </div>
      ) : (
        <div className="row-actions">
          <button className="btn primary" disabled={!todo.length} onClick={() => void run(todo)}>
            电脑打所有还没打的动点（{todo.length}）
          </button>
          <label className="muted">
            每个动点最多算{" "}
            <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
              {TIME_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t} 秒
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {error && <p className="errors-inline">{error}</p>}
    </div>
  );
}

/** 动点下面：电脑生成的提醒，以及没打出来的重要终端（请玩家接着手动打，或者确认这一手出不来）。 */
export function AutoNote({ data, study, starter, onChange }: { data: EngineData; study: DeckStudy; starter: Starter; onChange: (s: DeckStudy) => void }) {
  const info = study.auto[starter.id];
  if (!info || !study.routes[starter.id]) return null;
  const ask = info.missing.filter((c) => !info.skipped.includes(c) && study.keyCards.includes(c));
  const skip = (card: number) => onChange({ ...study, auto: { ...study.auto, [starter.id]: { ...info, skipped: [...info.skipped, card] } } });
  return (
    <div className="auto-note">
      <div>
        <span className="auto-tag">电脑生成</span> 不一定是最优展开{info.timedOut ? "，时间用完时还没搜完" : ""}。
      </div>
      {ask.length > 0 && (
        <div className="auto-ask">
          <div>电脑没打出这些重要终端。请在练习里接着打出来，或者告诉我这一手本来就出不来：</div>
          <ul>
            {ask.map((c) => (
              <li key={c}>
                <span className="thumb">
                  <CardView id={c} name={data.name(c)} />
                </span>
                <span>
                  {data.name(c)}（{ZONE_LABEL[keyTarget(study, c).zone]}）
                </span>
                <button className="mini" onClick={() => editInPractice(study, starter)}>
                  接着手动打
                </button>
                <button className="mini" onClick={() => skip(c)}>
                  这一手出不来
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

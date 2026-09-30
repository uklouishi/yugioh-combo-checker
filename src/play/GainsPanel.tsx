import type { EngineData } from "../engine/data";
import type { Action, Gains } from "../engine/session";

interface Props {
  data: EngineData;
  gains: Gains;
  actions: Action[];
  /** 对手现在的手卡张数。 */
  oppHand: number;
}

const actionLabel = (actions: Action[], a: number) => (a < 0 ? "开局" : `操作 ${a + 1}：${actions[a]?.label ?? ""}`);

/** 对手发动 Maxx "C"、Mulcharmy 之后，你每次召唤让对手抽了几张。 */
export function GainsPanel({ data, gains, actions, oppHand }: Props) {
  if (!gains.activated.length) return null;
  const drawn = gains.draws.reduce((n, d) => n + d.count, 0);
  const byAction = new Map<number, Gains["draws"]>();
  for (const d of gains.draws) byAction.set(d.action, [...(byAction.get(d.action) ?? []), d]);

  return (
    <section className="gains">
      <header>
        <h2>对手收益</h2>
        <span className="badge">+{drawn} 张</span>
      </header>
      {gains.activated.map((a, i) => (
        <p key={i} className="muted">
          对手在{a.context}时发动了 <strong>{data.name(a.code)}</strong>（{actionLabel(actions, a.action)}）
        </p>
      ))}
      {byAction.size === 0 ? (
        <p className="muted">之后你每次符合条件的召唤，对手都会抽 1 张，会列在这里。</p>
      ) : (
        <ol>
          {[...byAction].map(([a, list]) => (
            <li key={a}>
              <div className="log-action">{actionLabel(actions, a)}</div>
              <ul>
                {list.map((d, i) => (
                  <li key={i}>
                    {d.context} → 对手抽 {d.count} 张
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
      {gains.returned > 0 && <p className="muted">结束阶段对手手卡超过上限，随机洗回卡组 {gains.returned} 张。</p>}
      <p className="gains-total">
        对手一共多抽 {drawn} 张{gains.returned > 0 ? `，洗回 ${gains.returned} 张` : ""}，现在手卡 {oppHand} 张。
      </p>
    </section>
  );
}

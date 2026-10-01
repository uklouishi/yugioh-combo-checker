import { useEffect, useMemo, useState } from "react";
import { handtrapById } from "../data";
import { comboStore } from "../data/store";
import { FORMATS, isExtraDeckCard, loadEngineData, type EngineData, type Format } from "../engine/data";
import { DeckParseError, parseDeck, toYdk } from "../engine/deck";
import { practiceSetup } from "../play/DeckSetup";
import { SAMPLE_DECK } from "../play/sample";
import { queueDuel } from "../play/useDuel";
import { href, navigate } from "../router";
import { compareStudy, type StudyComparison } from "../study/compare";
import { addStarter, newStudy, removeStarter, sameStarter, starterHand, starterProblem, usesNormal, type CardFilter, type DeckStudy, type Starter, type Wildcard } from "../study/model";
import { ATTRIBUTES, RACES, blankFor, deckMatches, filterLabel, matches, practiceMain, starterLabel } from "../study/wildcard";
import { parseStudies, setStudyTarget, studyStore, useStudies } from "../study/store";
import { CardView } from "../ui/CardView";
import { downloadJson } from "../ui/download";
import { NotFound } from "./NotFound";

const FORMAT_LABEL: Record<Format, string> = { tcg: "TCG", ocg: "OCG" };

/** 单卡动点（不带通配）。 */
const isSingle = (s: Starter) => s.cards.length === 1 && !s.wildcard;

/** 去重，保持第一次出现的顺序。 */
const unique = (ids: number[]) => [...new Set(ids)];

/** 卡组研究：选动点和重要终端，逐个在练习模式里打，再对比所有路线给手坑排优先级。 */
export default function StudyPage({ id }: { id?: string }) {
  const [data, setData] = useState<EngineData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const studies = useStudies();

  useEffect(() => {
    loadEngineData().then(setData, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) {
    return (
      <main className="page">
        <h1>卡组研究</h1>
        <p className="errors-inline">卡片数据加载失败：{error}。请刷新重试。</p>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="page">
        <h1>卡组研究</h1>
        <p className="muted">正在加载卡片数据…</p>
      </main>
    );
  }
  if (!id) return <StudyList data={data} studies={studies} />;
  const study = studies.find((s) => s.id === id);
  if (!study) return <NotFound what="这个卡组研究" />;
  return <StudyDetail data={data} study={study} />;
}

function StudyList({ data, studies }: { data: EngineData; studies: DeckStudy[] }) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [format, setFormat] = useState<Format>("tcg");
  const [importError, setImportError] = useState<string | null>(null);

  const parsed = useMemo(() => {
    if (!text.trim()) return { deck: null, error: null };
    try {
      const d = parseDeck(text);
      const main: number[] = [];
      const extra: number[] = [];
      for (const id of [...d.main, ...d.extra]) {
        const c = data.cards.get(id);
        if (c) (isExtraDeckCard(c) ? extra : main).push(id);
      }
      return { deck: { main, extra }, error: main.length ? null : "主卡组是空的" };
    } catch (e) {
      return { deck: null, error: e instanceof DeckParseError ? e.message : "读取失败" };
    }
  }, [text, data]);

  const create = () => {
    if (!parsed.deck) return;
    const s = newStudy(name.trim() || "未命名卡组", parsed.deck.main, parsed.deck.extra, format);
    studyStore.save(s);
    navigate(href.study(s.id));
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const r = parseStudies(await file.text());
    if (!r.ok) return setImportError(r.error);
    setImportError(null);
    r.studies.forEach((s) => studyStore.save(s));
    if (r.studies.length === 1) navigate(href.study(r.studies[0].id));
  };

  return (
    <main className="page">
      <div className="toolbar">
        <div className="eyebrow">卡组研究</div>
        <h1>把每个动点打一遍，找出最该防的手坑</h1>
        <p className="lede">
          选出卡组的单卡动点、两卡组合和重要终端，用固定起手在练习模式里逐个打完。软件把所有路线放在一起，按「打断后有多少重要终端出不来」给手坑排优先级。
        </p>
      </div>

      {studies.length > 0 && (
        <ul className="combo-list">
          {studies.map((s) => {
            const done = s.starters.filter((st) => s.routes[st.id]).length;
            return (
              <li key={s.id}>
                <div className="info">
                  <div className="eyebrow">{FORMAT_LABEL[s.format]}</div>
                  <a className="ctitle" href={href.study(s.id)}>
                    {s.name}
                  </a>
                  <div className="muted">
                    {s.starters.length} 个动点，已打 {done} 个 · 重要终端 {s.keyCards.length} 张 · 更新于 {s.updatedAt}
                  </div>
                </div>
                <div className="row-actions">
                  <a className="btn primary" href={href.study(s.id)}>
                    打开
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <section className="panel">
        <div className="sub-head">
          <h2 className="section-title">新建研究</h2>
          <div className="adds">
            <button className="btn" onClick={() => setText(toYdk(SAMPLE_DECK))}>
              用示例牌组
            </button>
            <label className="btn" htmlFor="study-file">
              导入研究文件
            </label>
            <input id="study-file" type="file" accept=".json,application/json" onChange={onFile} hidden />
          </div>
        </div>
        {importError && <p className="errors-inline">{importError}</p>}
        <label className="study-field">
          <span className="field-label">卡组名</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="比如 Snake-Eye Fiendsmith" />
        </label>
        <div className="seg" role="radiogroup" aria-label="禁卡表">
          {FORMATS.map((f) => (
            <label key={f} className={format === f ? "on" : undefined}>
              <input type="radio" name="study-format" checked={format === f} onChange={() => setFormat(f)} />
              {FORMAT_LABEL[f]}
            </label>
          ))}
        </div>
        <textarea
          className="deck-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"粘贴 .ydk 内容或 ydke:// 链接"}
          aria-label="牌组内容"
          spellCheck={false}
        />
        {parsed.error && <p className="errors-inline">{parsed.error}</p>}
        {parsed.deck && !parsed.error && (
          <p className="muted">
            主卡组 {parsed.deck.main.length} 张 · 额外卡组 {parsed.deck.extra.length} 张
          </p>
        )}
        <div className="start-row">
          <button className="btn primary" disabled={!parsed.deck || !!parsed.error} onClick={create}>
            创建
          </button>
        </div>
      </section>
    </main>
  );
}

function StudyDetail({ data, study }: { data: EngineData; study: DeckStudy }) {
  const update = (s: DeckStudy) => studyStore.save(s);
  const mainCards = unique(study.main);
  const extraCards = unique(study.extra);
  const singles = new Set(study.starters.filter(isSingle).map((s) => s.cards[0]));
  const keys = new Set(study.keyCards);
  const cmp = useMemo(() => compareStudy(study), [study]);
  const done = study.starters.filter((s) => study.routes[s.id]).length;
  const label = (s: Starter) => starterLabel(data, s);

  const toggleSingle = (card: number) => {
    const existing = study.starters.find((s) => isSingle(s) && s.cards[0] === card);
    if (!existing) return update(addStarter(study, [card]));
    if (study.routes[existing.id] && !window.confirm(`${data.name(card)} 已经打过路线，删掉这个动点会连路线一起删掉。确定吗？`)) return;
    update(removeStarter(study, existing.id));
  };
  const toggleKey = (card: number) =>
    update({ ...study, keyCards: keys.has(card) ? study.keyCards.filter((c) => c !== card) : [...study.keyCards, card] });
  const toggleNormal = (card: number) =>
    update({ ...study, normalSummon: { ...study.normalSummon, [String(card)]: !usesNormal(study, card) } });

  const play = (s: Starter) => {
    const hand = starterHand(s);
    queueDuel(practiceSetup(data, { main: practiceMain(study, s), extra: study.extra, hand, format: study.format }));
    setStudyTarget({ studyId: study.id, starterId: s.id, hand });
    navigate(href.play());
  };
  const view = (s: Starter, to: "view" | "analyze") => {
    const route = study.routes[s.id];
    if (!route) return;
    comboStore.save([route]);
    navigate(to === "view" ? href.view(route.id) : href.analyze(route.id));
  };
  const remove = (s: Starter) => {
    if (study.routes[s.id] && !window.confirm(`删掉「${label(s)}」和它打出来的路线？`)) return;
    update(removeStarter(study, s.id));
  };

  return (
    <main className="page study">
      <div className="page-head">
        <div>
          <div className="eyebrow">卡组研究 · {FORMAT_LABEL[study.format]}</div>
          <h1>{study.name}</h1>
        </div>
        <div className="actions">
          <a className="btn" href={href.study()}>
            ← 全部研究
          </a>
          <button className="btn" onClick={() => downloadJson(study, `${study.id}.json`)} title="导出成文件，可以备份或发给别人导入">
            导出
          </button>
          <button
            className="btn"
            onClick={() => {
              if (!window.confirm(`删除「${study.name}」和它所有的路线？`)) return;
              studyStore.remove(study.id);
              navigate(href.study());
            }}
          >
            删除
          </button>
        </div>
      </div>

      <section className="stats">
        <div>
          <span className="num">{study.starters.length}</span>
          <span className="lbl">个动点</span>
        </div>
        <div>
          <span className="num">
            {done} / {study.starters.length}
          </span>
          <span className="lbl">已经打过</span>
        </div>
        <div>
          <span className="num">{study.keyCards.length}</span>
          <span className="lbl">张重要终端</span>
        </div>
      </section>

      <section className="panel">
        <h2 className="section-title">1. 单卡动点</h2>
        <p className="muted">点主卡组里的卡，加为（或取消）单卡动点。</p>
        <div className="deck-grid" aria-label="主卡组">
          {mainCards.map((id) => (
            <button key={id} className={`deck-card${singles.has(id) ? " active picked" : ""}`} onClick={() => toggleSingle(id)} title={data.name(id)} aria-pressed={singles.has(id)}>
              <span className="thumb">
                <CardView id={id} name={data.name(id)} />
              </span>
              {singles.has(id) && <span className="x">✓</span>}
            </button>
          ))}
        </div>
      </section>

      <PairPicker data={data} study={study} cards={mainCards} onAdd={(cards, wildcard) => update(addStarter(study, cards, new Date(), wildcard))} />

      <section className="panel">
        <h2 className="section-title">3. 重要终端</h2>
        <p className="muted">
          选出这副卡最想留在场上的卡（Baronne、Apollousa 这类阻抗）。对比时只数这些卡，手坑打掉越多越该防。研究会记住你选的卡，以后的路线自动套用。
        </p>
        {extraCards.length > 0 && (
          <div className="deck-grid" aria-label="额外卡组">
            {extraCards.map((id) => (
              <KeyCard key={id} data={data} id={id} on={keys.has(id)} onToggle={toggleKey} />
            ))}
          </div>
        )}
        <details>
          <summary className="muted">主卡组的卡（场地魔法、永续卡等）</summary>
          <div className="deck-grid extra">
            {mainCards.map((id) => (
              <KeyCard key={id} data={data} id={id} on={keys.has(id)} onToggle={toggleKey} />
            ))}
          </div>
        </details>
      </section>

      <section className="panel">
        <h2 className="section-title">4. 逐个打一遍</h2>
        {study.starters.length === 0 ? (
          <p className="muted">先在上面选动点。</p>
        ) : (
          <>
            <p className="muted">点「打这一手」进练习模式，起手只有这几张，方便看清这一手单独能打到哪里。打完回合后点「保存到研究」回到这里。</p>
            <ul className="starter-list">
              {study.starters.map((s) => {
                const route = study.routes[s.id];
                const summary = cmp.routes.find((r) => r.starter.id === s.id);
                const problem = starterProblem(study, s.cards);
                return (
                  <li key={s.id} className={route ? "done" : undefined}>
                    <div className="hand">
                      {s.cards.map((c, i) => (
                        <span key={i} className="thumb">
                          <CardView id={c} name={data.name(c)} />
                        </span>
                      ))}
                      {s.wildcard && (
                        <span className="thumb any" title={`${filterLabel(s.wildcard.filter)}，练习时用 ${data.name(s.wildcard.representative)}`}>
                          <CardView id={s.wildcard.representative} name={data.name(s.wildcard.representative)} />
                          <span className="any-tag">任意</span>
                        </span>
                      )}
                    </div>
                    <div className="info">
                      <strong>{label(s)}</strong>
                      <div className="ns-row">
                        {unique(s.cards).map((c) => (
                          <label key={c} className={`tag-toggle${usesNormal(study, c) ? " on" : ""}`} title="这张卡展开时要用掉通常召唤">
                            <input type="checkbox" checked={usesNormal(study, c)} onChange={() => toggleNormal(c)} />
                            {s.cards.length > 1 ? `${data.name(c)} ` : ""}占通召
                          </label>
                        ))}
                      </div>
                      {s.wildcard && <div className="muted">练习时用 {data.name(s.wildcard.representative)} 代表{filterLabel(s.wildcard.filter)}。</div>}
                      {problem && <p className="errors-inline">{problem}</p>}
                      {route && summary ? (
                        <div className="muted">
                          已打：{route.steps.length} 步，终场 {summary.endCount} 张
                          {!cmp.fallback &&
                            (summary.keyEnd.length ? `，重要终端 ${summary.keyEnd.map((c) => data.name(c)).join("、")}` : "，没打出重要终端")}
                        </div>
                      ) : (
                        <div className="muted">还没打</div>
                      )}
                    </div>
                    <div className="row-actions">
                      <button className={`btn${route ? "" : " primary"}`} onClick={() => play(s)}>
                        {route ? "重打" : "打这一手"}
                      </button>
                      {route && (
                        <>
                          <button className="btn" onClick={() => view(s, "view")}>
                            播放
                          </button>
                          <button className="btn" onClick={() => view(s, "analyze")}>
                            单条分析
                          </button>
                        </>
                      )}
                      <button className="mini" onClick={() => remove(s)} aria-label={`删除 ${label(s)}`}>
                        删除
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <Comparison data={data} study={study} cmp={cmp} />
    </main>
  );
}

function KeyCard({ data, id, on, onToggle }: { data: EngineData; id: number; on: boolean; onToggle: (id: number) => void }) {
  return (
    <button className={`deck-card${on ? " active picked" : ""}`} onClick={() => onToggle(id)} title={data.name(id)} aria-pressed={on}>
      <span className="thumb">
        <CardView id={id} name={data.name(id)} />
      </span>
      {on && <span className="x">★</span>}
    </button>
  );
}

const ANY = -1;

function PairPicker({ data, study, cards, onAdd }: { data: EngineData; study: DeckStudy; cards: number[]; onAdd: (cards: number[], wildcard?: Wildcard) => void }) {
  // 单卡动点排在前面
  const singles = study.starters.filter(isSingle).map((s) => s.cards[0]);
  const options = unique([...singles, ...cards]);
  const [a, setA] = useState<number>(options[0] ?? 0);
  const [b, setB] = useState<number>(options[1] ?? options[0] ?? 0);
  const [filter, setFilter] = useState<CardFilter>({});
  const [rep, setRep] = useState<number | null>(null);
  const any = b === ANY;

  // 卡组里的怪兽有哪些种族、属性，选项只列这些
  const monsters = cards.map((id) => data.cards.get(id)!).filter((c) => matches(c, {}));
  const races = RACES.filter(([bit]) => monsters.some((c) => (c.data.race & BigInt(bit)) !== 0n));
  const attrs = ATTRIBUTES.filter(([bit]) => monsters.some((c) => (c.data.attribute & bit) !== 0));
  const members = any ? deckMatches(data, study, filter) : [];
  const blank = any ? blankFor(data, filter) : null;
  const representative = rep !== null && members.includes(rep) ? rep : (blank ?? members[0] ?? null);
  const copies = members.reduce((n, id) => n + study.main.filter((x) => x === id).length, 0);

  const pair = any ? [a] : [a, b];
  const wildcard: Wildcard | undefined = any && representative !== null ? { filter, representative } : undefined;
  const problem = any ? (members.filter((m) => m !== a).length ? starterProblem(study, pair) : "卡组里没有符合条件的卡") : starterProblem(study, pair);
  const exists = study.starters.some((s) => sameStarter(s, { cards: pair, wildcard }));
  const setF = (patch: Partial<CardFilter>) => {
    const next = { ...filter, ...patch };
    for (const k of Object.keys(next) as (keyof CardFilter)[]) if (!next[k]) delete next[k];
    setFilter(next);
  };
  const select = (value: number, set: (v: number) => void, label: string, withAny: boolean) => (
    <select value={value} onChange={(e) => set(Number(e.target.value))} aria-label={label}>
      {withAny && <option value={ANY}>任意…（按种族、属性、等级）</option>}
      {options.map((id) => (
        <option key={id} value={id}>
          {data.name(id)}
          {singles.includes(id) ? "（动点）" : ""}
          {usesNormal(study, id) ? " · 占通召" : ""}
        </option>
      ))}
    </select>
  );
  return (
    <section className="panel">
      <h2 className="section-title">2. 两卡组合</h2>
      <p className="muted">
        两张一起才动得起来，或者想看两张一起能多打出什么。第二张可以选「任意…」，比如 Regulus + 任意魔法师族怪兽。两张都要通常召唤的组合会被拦下。
      </p>
      <div className="chips-edit">
        {select(a, setA, "第一张", false)}
        <span>+</span>
        {select(b, setB, "第二张", true)}
      </div>
      {any && (
        <div className="wildcard">
          <div className="chips-edit">
            <select value={filter.race ?? 0} onChange={(e) => setF({ race: Number(e.target.value) })} aria-label="种族">
              <option value={0}>种族不限</option>
              {races.map(([bit, name]) => (
                <option key={bit} value={bit}>
                  {name}
                </option>
              ))}
            </select>
            <select value={filter.attribute ?? 0} onChange={(e) => setF({ attribute: Number(e.target.value) })} aria-label="属性">
              <option value={0}>属性不限</option>
              {attrs.map(([bit, name]) => (
                <option key={bit} value={bit}>
                  {name}属性
                </option>
              ))}
            </select>
            <select value={filter.maxLevel ?? 0} onChange={(e) => setF({ maxLevel: Number(e.target.value) })} aria-label="等级">
              <option value={0}>等级不限</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n} 星以下
                </option>
              ))}
            </select>
          </div>
          <p className="muted">
            <strong>{filterLabel(filter)}</strong>：卡组里有 {members.length} 种 {copies} 张
            {members.length > 0 && `（${members.map((id) => data.name(id)).join("、")}）`}。
          </p>
          <label className="study-field">
            <span className="field-label">练习时放进起手的卡</span>
            <select value={representative ?? ""} onChange={(e) => setRep(Number(e.target.value))} aria-label="代表卡">
              {blank !== null && <option value={blank}>白板：{data.name(blank)}（白板，不算第二张自己的效果）</option>}
              {members.map((id) => (
                <option key={id} value={id}>
                  {data.name(id)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="start-row">
        <button className="btn" disabled={!!problem || exists} onClick={() => onAdd(pair, wildcard)}>
          添加组合
        </button>
        {problem && <span className="errors-inline">{problem}</span>}
        {exists && <span className="muted">这个组合已经加过了。</span>}
      </div>
    </section>
  );
}

function Comparison({ data, study, cmp }: { data: EngineData; study: DeckStudy; cmp: StudyComparison }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!cmp.routes.length) {
    return (
      <section className="panel">
        <h2 className="section-title">5. 对比分析</h2>
        <p className="muted">至少打完一个动点后，这里会把所有路线放在一起，给手坑排优先级。</p>
      </section>
    );
  }
  const nameOf = (id: string) => {
    const s = study.starters.find((x) => x.id === id);
    return s ? starterLabel(data, s) : "";
  };
  const htName = (id: number) => handtrapById.get(id)?.name ?? data.name(id);
  const names = (ids: number[]) => ids.map((c) => data.name(c)).join("、");
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const total = cmp.routes.length;

  return (
    <section className="panel">
      <h2 className="section-title">5. 对比分析</h2>
      <p className="muted">
        {total} 条路线
        {cmp.fallback
          ? "。还没选重要终端，下面按整个终场算；选了重要终端后排序会更准。"
          : `，其中 ${cmp.scored} 条打出了重要终端。分数是各路线被打掉的重要终端占比的平均。`}
      </p>

      <div className="matrix-scroll">
        <table className="matrix study-routes">
          <thead>
            <tr>
              <th scope="col">动点</th>
              <th scope="col">通召</th>
              <th scope="col">步数</th>
              <th scope="col">{cmp.fallback ? "终场" : "重要终端"}</th>
            </tr>
          </thead>
          <tbody>
            {cmp.routes.map((r) => (
              <tr key={r.starter.id}>
                <th scope="row">{nameOf(r.starter.id)}</th>
                <td>{r.normalSummon ? "用了" : "没用"}</td>
                <td>{r.combo.steps.length}</td>
                <td className="key-cell">
                  <div className="key-thumbs">
                    {r.keyEnd.map((c, i) => (
                      <span key={i} className="thumb" title={data.name(c)}>
                        <CardView id={c} name={data.name(c)} />
                      </span>
                    ))}
                    {!r.keyEnd.length && <span className="muted">无</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="sub-title">手坑优先级</h3>
      {cmp.handtraps.length === 0 && <p className="muted">这些路线里没有能打断展开的手坑时点。</p>}
      <ol className="study-rank">
        {cmp.handtraps.map((h, i) => {
          const worst = h.hits[0];
          return (
            <li key={h.handtrap}>
              <button className="rank-row" onClick={() => setOpen(open === h.handtrap ? null : h.handtrap)} aria-expanded={open === h.handtrap}>
                <span className="prio-rank">{i + 1}</span>
                <span className="thumb">
                  <CardView id={h.handtrap} name={htName(h.handtrap)} />
                </span>
                <span className="rank-text">
                  <strong>{htName(h.handtrap)}</strong>
                  <span className="muted">
                    {h.routesHurt} / {total} 条路线会少重要终端，{h.routesHit} 条能打
                    {worst?.keyLost.length ? ` · 最痛：${nameOf(worst.starterId)} 第 ${worst.step} 步，少 ${names(worst.keyLost)}` : ""}
                  </span>
                </span>
                <span className="rank-score">
                  <span className="prio-bar">
                    <span style={{ width: pct(h.score) }} />
                  </span>
                  {pct(h.score)}
                </span>
              </button>
              {open === h.handtrap && (
                <ul className="rank-detail">
                  {h.hits.map((x) => (
                    <li key={x.starterId}>
                      <strong>{nameOf(x.starterId)}</strong>：{x.keyLost.length ? `少 ${names(x.keyLost)}。` : "重要终端不受影响。"}
                      <span className="muted">{x.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      {cmp.drawers.length > 0 && (
        <p className="muted">
          不打断展开、让对手抽卡的：{cmp.drawers.map((d) => `${htName(d.handtrap)}（平均约 ${d.draws} 张，${d.routesHit} 条路线能丢）`).join("；")}。
        </p>
      )}
      {cmp.unused.length > 0 && <p className="muted">这些路线都不吃：{cmp.unused.map(htName).join(", ")}。</p>}

      {cmp.keyEffects.length > 0 && (
        <>
          <h3 className="sub-title">对手最想打断的效果</h3>
          <p className="muted">这张卡这一步被无效，重要终端就出不来。出现在越多路线里，越是这副卡的命门。</p>
          <ol className="study-effects">
            {cmp.keyEffects.slice(0, 8).map((k) => (
              <li key={k.card}>
                <span className="thumb">
                  <CardView id={k.card} name={data.name(k.card)} />
                </span>
                <span className="rank-text">
                  <strong>{data.name(k.card)}</strong>
                  <span className="muted">
                    {k.routes.length} 条路线 · 平均打掉 {pct(k.score)} · 最痛：{nameOf(k.worst.starterId)} 第 {k.worst.step} 步，少 {names(k.worst.keyLost)}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

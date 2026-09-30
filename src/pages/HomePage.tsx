import { useCombos } from "../data/store";
import { analyzeCombo } from "../model/analysis";
import { href } from "../router";

const ENTRIES = [
  {
    to: href.create(),
    title: "创建 Combo",
    body: "搜索英文卡名，选好起手，一步步记录展开和卡片移动。场地和吃坑点会实时预览。",
    cta: "开始创建",
  },
  {
    to: href.analyze(),
    title: "分析 Combo",
    body: "看一条展开在哪一步最脆弱：每张手坑最早能打哪里、打了之后是直接断还是终场变弱。",
    cta: "选择 combo 分析",
  },
  {
    to: href.open(),
    title: "打开 Combo",
    body: "浏览内置和你保存的 combo，在决斗场地上逐步播放；也可以上传 JSON 文件。",
    cta: "浏览 combo",
  },
];

export function HomePage() {
  const { all } = useCombos();
  const recent = all.slice(-4).reverse();
  return (
    <main className="page home">
      <section className="hero">
        <div className="eyebrow">Yu-Gi-Oh! Combo Checker</div>
        <h1>研究展开，找出吃坑点</h1>
        <p className="lede">记录一条 combo 从起手到终场的每一步，自动标出 Ash Blossom、Maxx "C"、Nibiru 等手坑能在哪里打断你。</p>
      </section>

      <a className="feature" href={href.play()}>
        <div className="eyebrow">核心功能</div>
        <h2>实战练习</h2>
        <p>
          粘贴 YDK 或 ydke:// 链接导入牌组，在场地上直接打出你的 combo。检索、特殊召唤、连锁和时点由 EDOPro 规则引擎按真实规则自动处理，不需要手动设置效果。
        </p>
        <p>对手手里放着手坑：每个能被打断的时点都会在悬浮窗里提示，还可以回到那一刻让对手真的发动，看被打断后怎么继续。</p>
        <span className="cta">导入牌组开始 →</span>
      </a>

      <section className="entries">
        {ENTRIES.map((e) => (
          <a key={e.to} className="entry" href={e.to}>
            <h2>{e.title}</h2>
            <p>{e.body}</p>
            <span className="cta">{e.cta} →</span>
          </a>
        ))}
      </section>

      {recent.length > 0 && (
        <section className="recent">
          <h2 className="section-title">最近的 combo</h2>
          <ul className="combo-list">
            {recent.map((c) => {
              const a = analyzeCombo(c);
              return (
                <li key={c.id}>
                  <div className="info">
                    <div className="eyebrow">{c.deck}</div>
                    <a className="ctitle" href={href.view(c.id)}>
                      {c.title}
                    </a>
                    <div className="muted">
                      {a.stepCount} 步 · {a.handtraps.length} 种手坑能打
                      {a.firstComboEnd ? ` · 最早第 ${a.firstComboEnd} 步可能被直接断` : ""}
                    </div>
                  </div>
                  <div className="row-actions">
                    <a className="btn" href={href.view(c.id)}>
                      打开
                    </a>
                    <a className="btn" href={href.analyze(c.id)}>
                      分析
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}

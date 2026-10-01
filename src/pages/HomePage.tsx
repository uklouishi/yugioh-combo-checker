import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { href } from "../router";

// 主菜单：每项前面的小卡用卡框颜色区分（效果怪兽 / 连接 / 魔法 / 陷阱）
const MENU = [
  { to: href.play(), label: "开始练习", frame: "effect", main: true },
  { to: href.open(), label: "打开 combo", frame: "link" },
  { to: href.create(), label: "创建 combo", frame: "spell" },
  { to: href.analyze(), label: "分析手坑", frame: "trap" },
  { to: href.study(), label: "卡组研究", frame: "fusion" },
];

const HOW_TO = [
  {
    title: "导入牌组",
    body: "粘贴 YDK 或 ydke:// 链接，选 TCG 或 OCG 禁卡表。",
  },
  {
    title: "抽 5 张，打出 combo",
    body: "在真实规则引擎上一步步展开，能撤销、重来、换一手。",
  },
  {
    title: "对手发动手坑",
    body: "Ash Blossom、Infinite Impermanence 等能连锁时立刻提示，还可以让对手真的发动。",
    hit: true,
  },
];

export function HomePage() {
  return (
    <main className="title-screen">
      <section className="rival-hand" aria-label="对手手牌">
        <span className="caption">对手手牌 · 5</span>
        <div className="fan">
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={`card-back${i === 2 ? " is-alert" : ""}`}
            />
          ))}
        </div>
        <span className="hint">
          对手可以发动 Ash Blossom &amp; Joyous Spring
        </span>
      </section>

      <section className="title-stage">
        <div className="title-block">
          <div className="field-grid" aria-hidden="true">
            <div>
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} />
              ))}
            </div>
            <div className="emz">
              <span />
              <span />
            </div>
            <div>
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} />
              ))}
            </div>
          </div>
          <h1>
            COMBO
            <br />
            CHECKER
          </h1>
          <p className="tagline">先攻展开 · 手坑模拟</p>
        </div>
        <nav className="main-menu">
          {MENU.map((m) => (
            <a
              key={m.to}
              href={m.to}
              className={m.main ? "is-main" : undefined}
            >
              <span className={`mini-card f-${m.frame}`} aria-hidden="true" />
              <span>{m.main ? `▶ ${m.label}` : m.label}</span>
            </a>
          ))}
        </nav>
        <HowToPlay />
      </section>

      <footer className="title-foot">
        非官方粉丝工具 · 卡图来自 YGOPRODeck · 规则引擎与卡片脚本 AGPL-3.0
      </footer>
    </main>
  );
}

function HowToPlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="how-to">
      <button
        type="button"
        className="help-btn"
        aria-label="玩法说明"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ?
      </button>
      {open &&
        // 挂到 body 上，在页面正中悬浮，不受主页布局影响；点遮罩或右上角 ✕ 关闭
        createPortal(
          <div className="how-overlay" onClick={() => setOpen(false)}>
            <div
              className="how-pop"
              role="dialog"
              aria-modal="true"
              aria-label="玩法说明"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="how-head">
                <b>HOW TO PLAY</b>
                <button
                  type="button"
                  className="how-close"
                  aria-label="关闭"
                  onClick={() => setOpen(false)}
                  autoFocus
                >
                  ✕
                </button>
              </div>
              <ol>
                {HOW_TO.map((s, i) => (
                  <li key={s.title} className={s.hit ? "is-hit" : undefined}>
                    <span className="chain-badge">
                      <small>CHAIN</small>
                      {i + 1}
                    </span>
                    <div>
                      <b>{s.title}</b>
                      <p>{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

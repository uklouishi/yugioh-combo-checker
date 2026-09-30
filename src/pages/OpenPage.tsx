import { useState } from "react";
import { comboStore, useCombos } from "../data/store";
import { analyzeCombo } from "../model/analysis";
import { href, navigate } from "../router";
import { downloadCombo } from "../ui/download";
import { ImportDialog } from "../ui/ImportDialog";

export function OpenPage() {
  const { all, mine } = useCombos();
  const [q, setQ] = useState("");
  const [importing, setImporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const lower = q.trim().toLowerCase();
  const list = all.filter(
    (c) =>
      !lower ||
      c.title.toLowerCase().includes(lower) ||
      c.deck.toLowerCase().includes(lower) ||
      c.starter.some((s) => s.name.toLowerCase().includes(lower)),
  );
  const isMine = (id: string) => mine.some((m) => m.id === id);

  return (
    <main className="page">
      <div className="page-head">
        <h1>打开 Combo</h1>
        <div className="actions">
          <button className="btn" onClick={() => setImporting(true)}>
            上传 JSON
          </button>
          <a className="btn primary" href={href.create()}>
            创建新的
          </a>
        </div>
      </div>
      <input
        id="combo-search"
        className="search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="按卡组、标题或起手卡名筛选"
      />
      {list.length === 0 && <p className="muted">没有符合条件的 combo。</p>}
      <ul className="combo-list">
        {list.map((c) => {
          const a = analyzeCombo(c);
          return (
            <li key={c.id}>
              <div className="info">
                <div className="eyebrow">
                  {c.deck} · {c.format}
                  {isMine(c.id) && <span className="tag">我保存的</span>}
                </div>
                <a className="ctitle" href={href.view(c.id)}>
                  {c.title}
                </a>
                <div className="muted">
                  起手：{c.starter.map((s) => s.name).join(", ")} · {a.stepCount} 步
                </div>
              </div>
              <div className="row-actions">
                <a className="btn primary" href={href.view(c.id)}>
                  打开
                </a>
                <a className="btn" href={href.analyze(c.id)}>
                  分析
                </a>
                <a className="btn" href={href.edit(c.id)}>
                  编辑
                </a>
                <button className="btn" onClick={() => downloadCombo(c)}>
                  导出
                </button>
                {isMine(c.id) &&
                  (confirmDelete === c.id ? (
                    <button
                      className="btn danger"
                      onClick={() => {
                        comboStore.remove(c.id);
                        setConfirmDelete(null);
                      }}
                    >
                      确认删除
                    </button>
                  ) : (
                    <button className="btn" onClick={() => setConfirmDelete(c.id)}>
                      删除
                    </button>
                  ))}
              </div>
            </li>
          );
        })}
      </ul>
      {importing && (
        <ImportDialog
          onImported={(added) => {
            setImporting(false);
            navigate(href.view(added[0].id));
          }}
          onClose={() => setImporting(false)}
        />
      )}
    </main>
  );
}

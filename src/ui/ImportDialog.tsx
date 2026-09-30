import { useState } from "react";
import { parseCombos } from "../data/userCombos";
import type { Combo } from "../model/schema";

interface Props {
  all: Combo[];
  mine: Combo[];
  onImport: (combos: Combo[]) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

const FORMAT_URL = "https://github.com/uklouishi/yugioh-combo-checker#数据格式srcmodelschemats";

/** 上传 combo：选择 JSON 文件或直接粘贴，校验通过后保存在本机浏览器。 */
export function ImportDialog({ all, mine, onImport, onDelete, onClose }: Props) {
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState("");

  const submit = (source: string) => {
    setDone("");
    const r = parseCombos(source, all);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors([]);
    onImport(r.combos);
    setDone(`已导入 ${r.combos.map((c) => c.title).join("、")}`);
    setText("");
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) submit(await file.text());
    e.target.value = "";
  };

  const example = all[0];

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="上传 combo" onClick={(e) => e.stopPropagation()}>
        <h2>上传 combo</h2>
        <p className="meta">
          选择一个 combo 的 JSON 文件，或把 JSON 粘贴到下面。可以是单条 combo，也可以是数组。导入的 combo 只保存在这台设备的浏览器里。
          格式说明见 <a href={FORMAT_URL} target="_blank" rel="noreferrer">README</a>。
        </p>
        <label className="btn" htmlFor="combo-file" style={{ justifySelf: "start" }}>
          选择 JSON 文件
        </label>
        <input id="combo-file" type="file" accept=".json,application/json" onChange={onFile} hidden />
        <textarea
          id="combo-json"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='{ "id": "my-combo", "deck": "...", "steps": [ ... ] }'
          spellCheck={false}
        />
        {errors.length > 0 && (
          <ul className="errors">
            {errors.slice(0, 12).map((e) => (
              <li key={e}>{e}</li>
            ))}
            {errors.length > 12 && <li>还有 {errors.length - 12} 个问题</li>}
          </ul>
        )}
        {done && <div className="ok">{done}</div>}
        <div className="row">
          {example && (
            <button className="btn" onClick={() => setText(JSON.stringify(example, null, 2))}>
              填入示例
            </button>
          )}
          <button className="btn" onClick={onClose}>
            关闭
          </button>
          <button className="btn primary" onClick={() => submit(text)} disabled={!text.trim()}>
            导入
          </button>
        </div>
        {mine.length > 0 && (
          <>
            <h2>我上传的 combo</h2>
            <ul className="mine">
              {mine.map((c) => (
                <li key={c.id}>
                  <span>{c.title}</span>
                  <button className="btn" onClick={() => onDelete(c.id)}>
                    删除
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

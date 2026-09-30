/** 用户上传的 combo：保存在浏览器本地（localStorage），只有本机可见。 */
import { handtraps } from ".";
import { Combo } from "../model/schema";
import { checkCombos } from "../model/validate";

const KEY = "user-combos-v1";

export function loadUserCombos(): Combo[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as unknown[]).flatMap((c) => {
      const r = Combo.safeParse(c);
      return r.success ? [r.data] : [];
    });
  } catch {
    return [];
  }
}

export function saveUserCombos(combos: Combo[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(combos));
  } catch {
    // 存储不可用时只在本次会话里有效
  }
}

export type ParseResult = { ok: true; combos: Combo[] } | { ok: false; errors: string[] };

/** 解析上传的 JSON（单个 combo 或数组），返回中文错误信息。 */
export function parseCombos(text: string, existing: Combo[]): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`不是合法的 JSON：${(e as Error).message}`] };
  }
  const list = Array.isArray(json) ? json : [json];
  const combos: Combo[] = [];
  const errors: string[] = [];
  list.forEach((raw, i) => {
    const r = Combo.safeParse(raw);
    if (r.success) combos.push(r.data);
    else
      errors.push(
        ...r.error.issues.map((iss) => `第 ${i + 1} 条 combo，字段 ${iss.path.join(".") || "(根)"}：${iss.message}`),
      );
  });
  if (errors.length) return { ok: false, errors };
  const others = existing.filter((c) => !combos.some((n) => n.id === c.id));
  errors.push(...checkCombos([...others, ...combos], handtraps).filter((e) => combos.some((c) => e.includes(`[${c.id}]`))));
  return errors.length ? { ok: false, errors } : { ok: true, combos };
}

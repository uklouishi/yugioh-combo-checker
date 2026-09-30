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
    else {
      const prefix = list.length > 1 ? `第 ${i + 1} 条 combo，` : "";
      errors.push(...r.error.issues.map((iss) => `${prefix}${describePath(iss.path)}：${describeIssue(iss)}`));
    }
  });
  if (errors.length) return { ok: false, errors };
  const others = existing.filter((c) => !combos.some((n) => n.id === c.id));
  errors.push(...checkCombos([...others, ...combos], handtraps).filter((e) => combos.some((c) => e.includes(`[${c.id}]`))));
  return errors.length ? { ok: false, errors } : { ok: true, combos };
}

const PATH_NAMES: Record<string, string> = {
  steps: "步骤",
  actions: "动作",
  moves: "移动",
  interruptions: "吃坑说明",
  starter: "起手",
  materials: "素材",
  result: "结果",
};
const FIELD_NAMES: Record<string, string> = {
  id: "编号",
  deck: "卡组",
  title: "标题",
  name: "卡名",
  card: "卡片",
  endboard: "终场",
  description: "说明",
  updatedAt: "更新日期",
};

/** 把 steps.0.actions.1.summon.card.id 这样的路径变成「步骤 1 › 动作 2 › 卡片」。 */
export function describePath(path: PropertyKey[]): string {
  const out: string[] = [];
  for (let i = 0; i < path.length; i++) {
    const key = String(path[i]);
    const next = path[i + 1];
    if (PATH_NAMES[key] && typeof next === "number") {
      out.push(`${PATH_NAMES[key]} ${next + 1}`);
      i++;
    } else if (["summon", "activation", "requires"].includes(key)) {
      continue;
    } else if (key === "id" && out.at(-1) === "卡片") {
      continue;
    } else {
      out.push(FIELD_NAMES[key] ?? key);
    }
  }
  return out.join(" › ") || "内容";
}

function describeIssue(iss: { code: string; message: string; path: PropertyKey[] }): string {
  const last = String(iss.path.at(-1));
  if (iss.code === "too_small" && last === "id") return "还没选卡";
  if (iss.code === "too_small" && last === "actions") return "至少要有一个动作";
  if (iss.code === "too_small" && last === "steps") return "至少要有一个步骤";
  if (iss.code === "too_small" && last === "starter") return "至少要有一张起手卡";
  if (iss.code === "invalid_type") return "缺少或格式不对";
  return iss.message;
}

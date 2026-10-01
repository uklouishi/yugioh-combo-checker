/** 卡组研究保存在浏览器本地（localStorage），可以导出/导入 JSON。 */
import { useSyncExternalStore } from "react";
import { DeckStudy } from "./model";

const KEY = "deck-studies-v1";
const TARGET = "study-play-v1";

function load(): DeckStudy[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as unknown[]).flatMap((s) => {
      const r = DeckStudy.safeParse(s);
      return r.success ? [r.data] : [];
    });
  } catch {
    return [];
  }
}

let studies = load();
const listeners = new Set<() => void>();

function emit() {
  try {
    localStorage.setItem(KEY, JSON.stringify(studies));
  } catch {
    // 存储不可用时只在本次会话里有效
  }
  listeners.forEach((l) => l());
}

export const studyStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => studies,
  find: (id: string) => studies.find((s) => s.id === id),
  /** 保存或覆盖（同 id）。 */
  save(study: DeckStudy) {
    const s = { ...study, updatedAt: new Date().toISOString().slice(0, 10) };
    studies = studies.some((x) => x.id === s.id) ? studies.map((x) => (x.id === s.id ? s : x)) : [...studies, s];
    emit();
  },
  remove(id: string) {
    studies = studies.filter((s) => s.id !== id);
    emit();
  },
};

export function useStudies() {
  return useSyncExternalStore(studyStore.subscribe, studyStore.get);
}

/** 解析导入的研究文件（单个或数组）。 */
export function parseStudies(text: string): { ok: true; studies: DeckStudy[] } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `不是合法的 JSON：${(e as Error).message}` };
  }
  const list = Array.isArray(json) ? json : [json];
  const out: DeckStudy[] = [];
  for (const raw of list) {
    const r = DeckStudy.safeParse(raw);
    if (!r.success) return { ok: false, error: "这不是卡组研究文件（字段缺少或格式不对）" };
    out.push(r.data);
  }
  return { ok: true, studies: out };
}

/** 正在练习哪个研究的哪个动点（同一个标签页里，练习页据此显示「保存到研究」）。 */
export interface StudyTarget {
  studyId: string;
  starterId: string;
  hand: number[];
}

export function setStudyTarget(t: StudyTarget | null) {
  try {
    if (t) sessionStorage.setItem(TARGET, JSON.stringify(t));
    else sessionStorage.removeItem(TARGET);
  } catch {
    // 存储不可用时练习页就不显示「保存到研究」
  }
}

export function studyTarget(): StudyTarget | null {
  try {
    const raw = sessionStorage.getItem(TARGET);
    return raw ? (JSON.parse(raw) as StudyTarget) : null;
  } catch {
    return null;
  }
}

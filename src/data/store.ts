/** 所有 combo（内置 + 用户保存的）的共享状态。 */
import { useSyncExternalStore } from "react";
import { combos as builtIn } from ".";
import type { Combo } from "../model/schema";
import { loadUserCombos, saveUserCombos } from "./userCombos";

let mine: Combo[] = loadUserCombos();
const listeners = new Set<() => void>();
let snapshot = build();

function build() {
  const all = [...builtIn.filter((c) => !mine.some((m) => m.id === c.id)), ...mine];
  return { all, mine, builtIn };
}

function emit() {
  snapshot = build();
  saveUserCombos(mine);
  listeners.forEach((l) => l());
}

export const comboStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => snapshot,
  /** 保存或覆盖（同 id）。 */
  save(combos: Combo[]) {
    mine = [...mine.filter((m) => !combos.some((c) => c.id === m.id)), ...combos];
    emit();
  },
  remove(id: string) {
    mine = mine.filter((m) => m.id !== id);
    emit();
  },
  isMine: (id: string) => mine.some((m) => m.id === id),
};

export function useCombos() {
  return useSyncExternalStore(comboStore.subscribe, comboStore.get);
}

import type { Combo } from "../model/schema";

/** 把 combo 下载成 JSON 文件。 */
export function downloadCombo(combo: Combo) {
  const blob = new Blob([JSON.stringify(combo, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${combo.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

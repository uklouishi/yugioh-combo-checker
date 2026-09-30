import { toBlob } from "html-to-image";
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

/**
 * 把页面上的一块区域导出成 PNG 下载。带 no-export 的元素（按钮等）不会出现在图里。
 * 背景用页面当前的背景色，深色模式导出的也是深色图。
 */
export async function downloadPng(node: HTMLElement, filename: string) {
  const bg = getComputedStyle(document.body).backgroundColor;
  const pad = 24;
  const { offsetWidth: w, offsetHeight: h } = node;
  const blob = await toBlob(node, {
    backgroundColor: bg,
    pixelRatio: 2,
    width: w + pad * 2,
    height: h + pad * 2,
    // 网页字体是跨域样式表，读不到，图里用系统字体
    skipFonts: true,
    // 某张卡图读不到时用透明图代替，不让整张导出失败
    imagePlaceholder: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    onImageErrorHandler: () => undefined,
    filter: (n) => !(n instanceof HTMLElement && n.classList.contains("no-export")),
    style: { margin: "0", padding: `${pad}px`, width: `${w}px`, height: `${h}px`, boxSizing: "content-box" },
  });
  if (!blob) throw new Error("生成图片失败");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  // 部分浏览器要求链接在文档里才按 download 的文件名保存
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

import { href } from "../router";

export function NotFound({ what }: { what: string }) {
  return (
    <main className="page">
      <h1>找不到 {what}</h1>
      <p className="muted">它可能保存在另一台设备的浏览器里，或者已经被删除。</p>
      <a className="btn" href={href.open()}>
        去打开其他 combo
      </a>
    </main>
  );
}

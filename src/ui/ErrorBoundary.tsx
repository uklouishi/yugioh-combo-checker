import { Component, type ReactNode } from "react";
import { href } from "../router";

/** 页面渲染出错时显示错误信息，而不是整个网站变成空白。 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="page">
        <h1>页面出错了</h1>
        <p className="errors-inline">{error.message}</p>
        <p className="muted">可以返回上一页或回到首页。把这段错误信息发给开发者可以帮助修复。</p>
        <div className="row-actions">
          <button className="btn" onClick={() => history.back()}>
            返回上一页
          </button>
          <a className="btn" href={href.home()}>
            回到首页
          </a>
        </div>
      </main>
    );
  }
}

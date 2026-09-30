import { lazy, Suspense } from "react";
import { AnalyzePage } from "./pages/AnalyzePage";
import { EditorPage } from "./pages/EditorPage";
import { HomePage } from "./pages/HomePage";
import { OpenPage } from "./pages/OpenPage";
import { ViewPage } from "./pages/ViewPage";
import { href, useRoute } from "./router";
import { ErrorBoundary } from "./ui/ErrorBoundary";

// 规则引擎约 1.2 MB，只在练习页加载
const PlayPage = lazy(() => import("./pages/PlayPage"));

export function App() {
  const route = useRoute();
  const nav = [
    { to: href.play(), label: "练习", active: route.page === "play" },
    { to: href.open(), label: "打开", active: route.page === "open" || route.page === "view" },
    { to: href.create(), label: "创建", active: route.page === "create" || route.page === "edit" },
    { to: href.analyze(), label: "分析", active: route.page === "analyze" },
  ];
  return (
    <>
      <header className={route.page === "home" ? "topbar dark-bar" : "topbar"}>
        <a className="brand" href={href.home()}>
          <span className="card-back brand-back" aria-hidden="true" />
          Combo Checker
        </a>
        <nav>
          {nav.map((n) => (
            <a key={n.to} href={n.to} className={n.active ? "active" : undefined}>
              {n.label}
            </a>
          ))}
        </nav>
      </header>
      {/* 换页时换一个新的 ErrorBoundary，上一页的错误不会留下来 */}
      <ErrorBoundary key={`${route.page}:${"id" in route ? route.id : ""}`}>
        {route.page === "home" && <HomePage />}
        {route.page === "play" && (
          <Suspense fallback={<main className="page"><p className="muted">正在加载规则引擎…</p></main>}>
            <PlayPage />
          </Suspense>
        )}
        {route.page === "open" && <OpenPage />}
        {route.page === "view" && <ViewPage key={route.id} id={route.id} initialStep={route.step} />}
        {route.page === "analyze" && <AnalyzePage key={route.id ?? ""} id={route.id} />}
        {route.page === "create" && <EditorPage key="new" />}
        {route.page === "edit" && <EditorPage key={route.id} id={route.id} />}
      </ErrorBoundary>
    </>
  );
}

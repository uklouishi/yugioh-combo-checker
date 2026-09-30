import { AnalyzePage } from "./pages/AnalyzePage";
import { EditorPage } from "./pages/EditorPage";
import { HomePage } from "./pages/HomePage";
import { OpenPage } from "./pages/OpenPage";
import { ViewPage } from "./pages/ViewPage";
import { href, useRoute } from "./router";

export function App() {
  const route = useRoute();
  const nav = [
    { to: href.open(), label: "打开", active: route.page === "open" || route.page === "view" },
    { to: href.create(), label: "创建", active: route.page === "create" || route.page === "edit" },
    { to: href.analyze(), label: "分析", active: route.page === "analyze" },
  ];
  return (
    <>
      <header className="topbar">
        <a className="brand" href={href.home()}>
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
      {route.page === "home" && <HomePage />}
      {route.page === "open" && <OpenPage />}
      {route.page === "view" && <ViewPage key={route.id} id={route.id} initialStep={route.step} />}
      {route.page === "analyze" && <AnalyzePage key={route.id ?? ""} id={route.id} />}
      {route.page === "create" && <EditorPage key="new" />}
      {route.page === "edit" && <EditorPage key={route.id} id={route.id} />}
    </>
  );
}

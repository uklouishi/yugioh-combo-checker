/** 极简 hash 路由：#/、#/play、#/open、#/create、#/edit/<id>、#/view/<id>[/<step>]、#/analyze/<id>、#/study[/<id>]。 */
import { useEffect, useState } from "react";

export type Route =
  | { page: "home" }
  | { page: "play" }
  | { page: "open" }
  | { page: "create" }
  | { page: "edit"; id: string }
  | { page: "view"; id: string; step: number }
  | { page: "analyze"; id?: string }
  | { page: "study"; id?: string };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  switch (parts[0]) {
    case "play":
      return { page: "play" };
    case "open":
      return { page: "open" };
    case "create":
      return { page: "create" };
    case "edit":
      return parts[1] ? { page: "edit", id: parts[1] } : { page: "create" };
    case "view":
      return parts[1] ? { page: "view", id: parts[1], step: Number(parts[2]) || 0 } : { page: "open" };
    case "analyze":
      return { page: "analyze", id: parts[1] };
    case "study":
      return { page: "study", id: parts[1] };
    default:
      return { page: "home" };
  }
}

export const href = {
  home: () => "#/",
  play: () => "#/play",
  open: () => "#/open",
  create: () => "#/create",
  edit: (id: string) => `#/edit/${encodeURIComponent(id)}`,
  view: (id: string, step = 0) => `#/view/${encodeURIComponent(id)}${step ? `/${step}` : ""}`,
  analyze: (id?: string) => (id ? `#/analyze/${encodeURIComponent(id)}` : "#/analyze"),
  study: (id?: string) => (id ? `#/study/${encodeURIComponent(id)}` : "#/study"),
};

export function navigate(to: string) {
  if (location.hash !== to) location.hash = to;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parseHash(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

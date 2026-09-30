import { useEffect, useState } from "react";
import { searchCards } from "../cards/search";
import { cardStore, loadSnapshot } from "../cards/useCards";
import type { CardInfo } from "../cards/ygoprodeck";
import { CardView } from "../ui/CardView";

export type PoolRole = "starter" | "deck" | "extra";

const EXTRA_FRAMES = new Set(["fusion", "synchro", "xyz", "link"]);
export const isExtraDeck = (c?: CardInfo) => !!c && [...EXTRA_FRAMES].some((f) => c.frameType.startsWith(f));

/** 按英文卡名搜卡，把结果加进卡池（起手 / 卡组 / 额外）。 */
export function CardSearch({ onAdd }: { onAdd: (card: CardInfo, role: PoolRole) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CardInfo[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    setLoading(true);
    const t = setTimeout(async () => {
      await loadSnapshot();
      const r = await searchCards(q, cardStore.all());
      if (alive) {
        setResults(r);
        setLoading(false);
      }
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  const add = (c: CardInfo, role: PoolRole) => {
    cardStore.add([c]);
    onAdd(c, role);
  };

  return (
    <div className="card-search">
      <input
        id="card-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="输入英文卡名搜索，例如 Snake-Eye Ash"
        autoComplete="off"
      />
      {loading && <div className="muted">搜索中…</div>}
      {!loading && q.trim().length >= 2 && results.length === 0 && <div className="muted">没有找到这张卡。</div>}
      {results.length > 0 && (
        <ul className="results">
          {results.map((c) => (
            <li key={c.id}>
              <span className="thumb">
                <CardView id={c.id} name={c.name} info={c} />
              </span>
              <span className="rinfo">
                <span className="rname">{c.name}</span>
                <span className="muted">{c.type}</span>
              </span>
              <span className="radd">
                {isExtraDeck(c) ? (
                  <button className="btn" onClick={() => add(c, "extra")}>
                    + 额外
                  </button>
                ) : (
                  <>
                    <button className="btn" onClick={() => add(c, "starter")}>
                      + 起手
                    </button>
                    <button className="btn" onClick={() => add(c, "deck")}>
                      + 卡组
                    </button>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

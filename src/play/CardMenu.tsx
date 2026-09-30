import { useEffect, useRef } from "react";
import type { CardAction } from "./cardActions";
import type { CardLoc } from "./DuelField";

export interface MenuState {
  key: string;
  name: string;
  /** 卡片（或拖放点）在屏幕上的位置，按钮放在它上方。 */
  rect: { left: number; top: number; width: number; height: number };
  actions: CardAction[];
  /** 拖放时落下的格子，放置区域时直接用它。 */
  place: CardLoc | null;
}

interface Props {
  menu: MenuState;
  onPick: (a: CardAction) => void;
  onClose: () => void;
}

/** 卡上弹出的小按钮：这张卡现在能做的事。点外面、滚动或按 Esc 关闭。 */
export function CardMenu({ menu, onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current?.contains(t) || t.closest(".fcard.selected")) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  const { rect } = menu;
  const below = rect.top < 150;
  const half = Math.min(130, window.innerWidth / 2 - 8);
  const left = Math.min(Math.max(rect.left + rect.width / 2, half + 8), window.innerWidth - half - 8);
  return (
    <div ref={ref} className={`card-menu${below ? " below" : ""}`} role="menu" aria-label={menu.name} style={{ left, top: below ? rect.top + rect.height : rect.top }}>
      <div className="cm-name">{menu.name}</div>
      {menu.actions.map((a, i) => (
        <button key={i} role="menuitem" className="btn small" onClick={() => onPick(a)}>
          {a.label}
        </button>
      ))}
    </div>
  );
}

import { useCallback, useRef, useState } from "react";
import type { CardLoc } from "./DuelField";

export interface DragState {
  code: number;
  x: number;
  y: number;
  /** 指针下面的区域（data-zone）。 */
  hover: string | null;
}

/** 放下的位置：某个格子、场地上的其他地方（zone 为 null），拖出场地则不会调用。 */
export type DropHandler = (loc: CardLoc, code: number, zone: CardLoc | null, point: { x: number; y: number }) => void;

function zoneAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-zone]");
  return el?.dataset.zone ?? null;
}

export function parseZone(z: string): CardLoc | null {
  const [controller, location, sequence] = z.split("-").map(Number);
  return Number.isFinite(sequence) ? { controller, location, sequence } : null;
}

/**
 * 手卡拖拽出牌。用 Pointer Events 自己实现，鼠标和手指都能用（HTML5 拖放在手机上不工作）。
 * 移动不到 8px 当作点击，不开始拖拽。
 */
export function useHandDrag(canDrag: (loc: CardLoc) => boolean, onDrop: DropHandler) {
  const [drag, setDrag] = useState<DragState | null>(null);
  /** 刚拖完的那次 click 不当作点卡。 */
  const justDropped = useRef(0);
  const dropRef = useRef(onDrop);
  dropRef.current = onDrop;

  const start = useCallback(
    (loc: CardLoc, code: number, e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || !canDrag(loc)) return false;
      const sx = e.clientX;
      const sy = e.clientY;
      let moving = false;
      const move = (ev: PointerEvent) => {
        if (!moving && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return;
        moving = true;
        ev.preventDefault();
        setDrag({ code, x: ev.clientX, y: ev.clientY, hover: zoneAt(ev.clientX, ev.clientY) });
      };
      const end = (ev: PointerEvent, drop: boolean) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        if (!moving) return;
        setDrag(null);
        justDropped.current = Date.now();
        if (!drop) return;
        const z = zoneAt(ev.clientX, ev.clientY);
        if (z) dropRef.current(loc, code, z === "mat" ? null : parseZone(z), { x: ev.clientX, y: ev.clientY });
      };
      const up = (ev: PointerEvent) => end(ev, true);
      const cancel = (ev: PointerEvent) => end(ev, false);
      window.addEventListener("pointermove", move, { passive: false });
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      return true;
    },
    [canDrag],
  );

  const wasDrag = useCallback(() => Date.now() - justDropped.current < 400, []);
  return { drag, start, wasDrag };
}

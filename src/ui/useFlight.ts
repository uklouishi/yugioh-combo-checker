import { useLayoutEffect, useRef, type RefObject } from "react";
import type { Loc } from "../model/board";
import type { Beat } from "../model/playback";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const keyOf = (l: Loc) => (l.index === undefined ? l.zone : `${l.zone}:${l.index}`);

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 每一拍停留多久（毫秒）。 */
const HOLD: Record<Beat["kind"], number> = { activate: 1500, summon: 1100, resolve: 1100, move: 350 };
const FLY_MS = 650;

/**
 * 播放一拍：移动的那一拍让卡从起点飞到终点，其余的停一会儿；结束后调用 onDone。
 *
 * 做法：每次渲染后记下场上每个格子的位置。轮到一次移动时，新局面已经画好了，
 * 从上一次记下的位置里找到起点，把终点那张卡复制一份，从起点飞过去，飞的时候先藏起真正的卡。
 */
export function useFlight(root: RefObject<HTMLElement | null>, beat: Beat | null, onDone: () => void) {
  const boxes = useRef(new Map<string, Box>());
  const done = useRef(onDone);
  done.current = onDone;

  useLayoutEffect(() => {
    if (!beat) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let anim: Animation | undefined;
    let fly: HTMLElement | undefined;
    let hidden: HTMLElement | undefined;
    const next = (ms: number) => {
      timer = setTimeout(() => done.current(), ms);
    };
    const cleanup = () => {
      fly?.remove();
      if (hidden) hidden.style.visibility = "";
    };

    const from = beat.from && boxes.current.get(keyOf(beat.from));
    const slot = beat.to && root.current?.querySelector<HTMLElement>(`[data-z="${keyOf(beat.to)}"]`);
    const card = slot?.querySelector<HTMLElement>(":scope > .card");
    if (beat.kind === "move" && from && slot && card && !reducedMotion() && typeof card.animate === "function") {
      const to = slot.getBoundingClientRect();
      fly = document.createElement("div");
      fly.className = "flying-card";
      Object.assign(fly.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` });
      fly.appendChild(card.cloneNode(true));
      document.body.appendChild(fly);
      hidden = card;
      card.style.visibility = "hidden";
      const dx = from.x - scrollX - to.left;
      const dy = from.y - scrollY - to.top;
      anim = fly.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(${from.w / to.width}, ${from.h / to.height})` },
          { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 24}px) scale(1.15)`, offset: 0.5 },
          { transform: "none" },
        ],
        { duration: FLY_MS, easing: "ease-in-out" },
      );
      anim.onfinish = () => {
        cleanup();
        fly = hidden = undefined;
        next(HOLD.move);
      };
    } else {
      next(beat.kind === "move" ? HOLD.move + 400 : HOLD[beat.kind]);
    }
    return () => {
      clearTimeout(timer);
      anim?.cancel();
      cleanup();
    };
  }, [beat, root]);

  // 放在上面那个 effect 之后：先用旧位置起飞，再记下这次渲染后的位置
  useLayoutEffect(() => {
    const map = new Map<string, Box>();
    root.current?.querySelectorAll<HTMLElement>("[data-z]").forEach((el) => {
      const r = el.getBoundingClientRect();
      map.set(el.dataset.z!, { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height });
    });
    boxes.current = map;
  });
}

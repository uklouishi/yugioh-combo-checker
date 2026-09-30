import { useState } from "react";
import { imageUrl } from "../cards/useCards";
import type { CardInfo } from "../cards/ygoprodeck";

const LIGHT_FRAMES = new Set(["normal", "synchro"]);

interface Props {
  id: number;
  name: string;
  info?: CardInfo;
  faceDown?: boolean;
  defense?: boolean;
  moved?: boolean;
  onOpen?: (id: number) => void;
}

/** 一张卡：有卡图显示卡图，没有就显示按卡片类型着色的卡框和卡名。 */
export function CardView({ id, name, info, faceDown, defense, moved, onOpen }: Props) {
  const [broken, setBroken] = useState(false);
  const cls = ["card", defense && "defense", moved && "moved"].filter(Boolean).join(" ");
  if (faceDown) {
    return (
      <button className={cls} onClick={() => onOpen?.(id)} aria-label={`里侧：${name}`}>
        <div className="back" />
      </button>
    );
  }
  const frame = info?.frameType ?? "effect";
  const stat = info?.linkval ? `LINK-${info.linkval}` : info?.level ? `★${info.level}` : info?.type?.replace(" Card", "");
  return (
    <button className={cls} onClick={() => onOpen?.(id)} aria-label={name} title={name}>
      {broken ? (
        <div
          className={`placeholder${LIGHT_FRAMES.has(frame) ? " light-frame" : ""}`}
          style={{ ["--frame" as string]: `var(--f-${frame}, var(--f-effect))` }}
        >
          <span className="pname">{name}</span>
          <span className="ptype">{stat}</span>
        </div>
      ) : (
        <img src={imageUrl(id)} alt={name} loading="lazy" onError={() => setBroken(true)} />
      )}
    </button>
  );
}

import type { CardInfo } from "../cards/ygoprodeck";
import type { Handtrap } from "../model/schema";
import { CardView } from "./CardView";

interface Props {
  id: number;
  name: string;
  info?: CardInfo;
  handtrap?: Handtrap;
  onClose: () => void;
}

export function CardDetail({ id, name, info, handtrap, onClose }: Props) {
  const stats = info
    ? [info.type, info.attribute, info.race, info.level && `★${info.level}`, info.linkval && `LINK-${info.linkval}`,
       info.atk !== undefined && `ATK ${info.atk}`, info.def !== undefined && `DEF ${info.def}`]
        .filter(Boolean)
        .join(" · ")
    : "";
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={name} onClick={(e) => e.stopPropagation()}>
        <h2>{name}</h2>
        <div className="detail">
          <div className="img">
            <CardView id={id} name={name} info={info} />
          </div>
          <div className="desc">
            {stats && <div className="meta">{stats}</div>}
            {handtrap && <p>{handtrap.summary}</p>}
            {info ? info.desc : "卡片资料加载中或无法获取。"}
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={onClose} autoFocus>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

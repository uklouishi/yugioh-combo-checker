import { OcgLocation, OcgResponseType } from "ocgcore-wasm";
import { describe, expect, it } from "vitest";
import { actionsForDrop, type CardAction } from "./cardActions";

const act = (kind: CardAction["kind"]): CardAction => ({ kind, label: kind, response: { type: OcgResponseType.SELECT_IDLECMD, action: 0, index: 0 } });
const mzone = { controller: 0, location: OcgLocation.MZONE, sequence: 2 };
const szone = { controller: 0, location: OcgLocation.SZONE, sequence: 1 };

describe("actionsForDrop", () => {
  it("拖到怪兽区：召唤，不提供盖放", () => {
    const r = actionsForDrop([act("summon"), act("mset"), act("activate")], mzone);
    expect(r).toEqual({ list: [act("summon")], exact: true });
  });
  it("只能盖放的怪兽拖到怪兽区就盖放", () => {
    expect(actionsForDrop([act("mset")], mzone)).toEqual({ list: [act("mset")], exact: true });
  });
  it("拖到魔陷区：发动优先于盖放", () => {
    expect(actionsForDrop([act("sset"), act("activate")], szone).list).toEqual([act("activate")]);
  });
  it("魔法卡拖到怪兽区：对不上，交给菜单", () => {
    expect(actionsForDrop([act("sset"), act("activate")], mzone)).toEqual({ list: [act("sset"), act("activate")], exact: false });
  });
  it("拖到场地空白处：全部交给菜单", () => {
    expect(actionsForDrop([act("summon"), act("mset")], null).exact).toBe(false);
  });
});

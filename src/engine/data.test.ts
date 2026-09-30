import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { EngineData } from "./data";

let data: EngineData;
beforeAll(async () => {
  data = await EngineData.load((p) => readFile(`public/engine/${p}`, "utf8").catch(() => null));
});

describe("EngineData 卡片数据", () => {
  it("收录只在 TCG 先行发售的新卡（BabelCDB release-*.cdb）", () => {
    expect(data.name(40235813)).toBe("Dark Time Wizard");
    expect(data.name(65118318)).toBe("Foolish Graverobber");
  });

  it("异画卡号换成本体卡号，包括 BabelCDB 没收录的异画", () => {
    expect(data.canonical(17242023)).toBe(17242022); // Red-Eyes Black Dragon Exceed，BabelCDB 自带
    expect(data.canonical(48130398)).toBe(48130397); // Super Polymerization，补进来的
    expect(data.canonical(24224832)).toBe(24224830); // Called by the Grave，补进来的
    expect(data.name(24224832)).toBe("Called by the Grave");
  });
});

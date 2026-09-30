/** npm run validate：校验所有 combo JSON。有 public/cards.json 快照时同时核对卡名。 */
import { existsSync, readFileSync } from "node:fs";
import type { CardInfo } from "../src/cards/ygoprodeck";
import { checkCombos } from "../src/model/validate";
import { loadCombos, loadHandtraps, snapshotPath } from "./load";

const combos = loadCombos();
const handtraps = loadHandtraps();
let names: Map<number, string> | undefined;
if (existsSync(snapshotPath)) {
  const cards = JSON.parse(readFileSync(snapshotPath, "utf8")) as CardInfo[];
  names = new Map(cards.map((c) => [c.id, c.name]));
} else {
  console.warn("没有 public/cards.json，跳过卡名核对（先运行 npm run sync-cards）");
}
const errors = checkCombos(combos, handtraps, names);
for (const e of errors) console.error("✗", e);
console.log(`${combos.length} 条 combo，${errors.length} 个问题`);
process.exit(errors.length ? 1 : 0);

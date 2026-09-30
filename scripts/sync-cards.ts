/**
 * npm run sync-cards：从 YGOPRODeck 拉取所有 combo 和手坑用到的卡，
 * 写入 public/cards.json 快照，并把卡图下载到 public/card-images/<id>.jpg。
 * YGOPRODeck 不允许直接盗链卡图，所以网站只使用自己托管的这些图片。
 * GitHub Actions 部署时会自动运行这个脚本。
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CardStore } from "../src/cards/ygoprodeck";
import { collectCardRefs } from "../src/model/validate";
import { loadCombos, loadHandtraps, snapshotPath } from "./load";

const ids = new Set<number>();
for (const combo of loadCombos()) for (const ref of collectCardRefs(combo)) ids.add(ref.id);
for (const h of loadHandtraps()) ids.add(h.id);

const store = new CardStore();
const found = await store.getMany([...ids]);
const missing = [...ids].filter((id) => !found.has(id));
const unique = [...new Map([...found.values()].map((c) => [c.id, c])).values()].sort((a, b) => a.id - b.id);

mkdirSync(dirname(snapshotPath), { recursive: true });
writeFileSync(snapshotPath, JSON.stringify(unique, null, 2) + "\n");
console.log(`写入 ${unique.length} 张卡到 public/cards.json`);

const imageDir = join(dirname(snapshotPath), "card-images");
mkdirSync(imageDir, { recursive: true });
let downloaded = 0;
for (const card of unique) {
  const file = join(imageDir, `${card.id}.jpg`);
  const url = card.card_images?.[0]?.image_url_small;
  if (existsSync(file) || !url) continue;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`卡图下载失败 ${card.id}: ${res.status}`);
    continue;
  }
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  downloaded += 1;
  await new Promise((r) => setTimeout(r, 100)); // 遵守 YGOPRODeck 的限流
}
console.log(`下载 ${downloaded} 张卡图到 public/card-images/`);
if (missing.length) {
  console.error(`YGOPRODeck 找不到这些 id：${missing.join(", ")}`);
  process.exit(1);
}

/**
 * npm run sync-all-images：下载 YGOPRODeck 上全部卡片的小图到 public/card-images/<id>.jpg。
 * 已经存在的图片会跳过，所以配合 GitHub Actions 缓存，之后的部署只下载新卡。
 * 限速在每秒 15 张以内（YGOPRODeck 的限制是每秒 20 次请求）。
 * 个别图片下载失败不会让部署失败，网站会对这些卡显示卡框。
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CardInfo } from "../src/cards/ygoprodeck";

const root = new URL("..", import.meta.url).pathname;
const imageDir = join(root, "public/card-images");
const MIN_INTERVAL_MS = 70;
const WORKERS = 6;

mkdirSync(imageDir, { recursive: true });

const res = await fetch("https://db.ygoprodeck.com/api/v7/cardinfo.php");
if (!res.ok) {
  console.error(`获取卡牌列表失败：${res.status}，跳过全部卡图下载`);
  process.exit(0);
}
const { data } = (await res.json()) as { data: CardInfo[] };

// 每张卡用自己的 id 保存主图；异画 id 也保存一份，方便任意 passcode 都能找到图。
const jobs: Array<{ id: number; url: string }> = [];
for (const card of data) {
  for (const img of card.card_images ?? []) {
    if (img.image_url_small && !existsSync(join(imageDir, `${img.id}.jpg`))) jobs.push({ id: img.id, url: img.image_url_small });
  }
}
console.log(`共 ${data.length} 张卡，需要下载 ${jobs.length} 张图`);

let next = 0;
let lastStart = 0;
let done = 0;
let failed = 0;

async function slot() {
  const wait = lastStart + MIN_INTERVAL_MS - Date.now();
  lastStart = Math.max(Date.now(), lastStart + MIN_INTERVAL_MS);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function download(job: { id: number; url: string }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await slot();
    try {
      const r = await fetch(job.url, { signal: AbortSignal.timeout(20_000) });
      if (r.ok) {
        writeFileSync(join(imageDir, `${job.id}.jpg`), Buffer.from(await r.arrayBuffer()));
        return true;
      }
      if (r.status === 404) return false;
    } catch {
      // 网络错误，重试
    }
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  return false;
}

async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++];
    if (await download(job)) done += 1;
    else failed += 1;
    if ((done + failed) % 500 === 0) console.log(`进度 ${done + failed} / ${jobs.length}`);
  }
}

await Promise.all(Array.from({ length: WORKERS }, worker));
console.log(`下载完成 ${done} 张，失败 ${failed} 张`);

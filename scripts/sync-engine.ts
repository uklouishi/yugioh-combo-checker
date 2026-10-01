/**
 * 准备规则引擎要用的数据，写到 public/engine/：
 * - cards.json：ProjectIgnis BabelCDB 的卡片数据（引擎需要的数值 + 英文卡名 + 效果说明文字）。
 *   除了 cards.cdb 还读 release-*.cdb（只在一个地区发售的新卡，比如 TCG 先行的 BETB）；
 *   BabelCDB 没收录的异画卡号，按 mycard ygopro-database 的 alias 补一行指向本体。
 * - base.json：CardScripts 根目录的公共脚本（constant.lua、utility.lua、proc_*.lua…）
 * - scripts/c<id>.lua：每张卡的效果脚本（official，缺的用 pre-release 补）
 * - strings.json：EDOPro 的系统提示文字（Select the card(s) to add to your hand…）
 * - setnames.json：字段代码 → 字段名（Dark Magician、Snake-Eye…）
 * - banlists.json：TCG / OCG 禁卡表（ProjectIgnis LFLists）
 *
 * 数据和脚本来自 ProjectIgnis，AGPL-3.0。下载缓存在 .cache/engine/，加 --refresh 重新下载。
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const CACHE = ".cache/engine";
const OUT = "public/engine";
const BABEL_REPO = "https://github.com/ProjectIgnis/BabelCDB";
const ALT_ART_CDB_URL = "https://raw.githubusercontent.com/mycard/ygopro-database/master/locales/en-US/cards.cdb";
const STRINGS_URL = "https://raw.githubusercontent.com/ProjectIgnis/Distribution/master/config/strings.conf";
const SCRIPTS_REPO = "https://github.com/ProjectIgnis/CardScripts";
const LFLISTS_URL = "https://raw.githubusercontent.com/ProjectIgnis/LFLists/master/";
// OCG.new 是公布了但还没生效的下一期，按月份挑已经生效的最新一期
const BANLISTS = { tcg: ["0TCG.lflist.conf"], ocg: ["OCG.lflist.conf", "OCG.new.lflist.conf"] };
const refresh = process.argv.includes("--refresh");

async function download(url: string, file: string) {
  if (existsSync(file) && !refresh) return;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

function clone(repo: string, dir: string, marker: string) {
  if (existsSync(join(dir, marker)) && !refresh) return;
  rmSync(dir, { recursive: true, force: true });
  execFileSync("git", ["clone", "-q", "--depth", "1", repo, dir], { stdio: "inherit" });
}

mkdirSync(CACHE, { recursive: true });
const babelDir = join(CACHE, "BabelCDB");
const altArtFile = join(CACHE, "alt-art.cdb");
const stringsFile = join(CACHE, "strings.conf");
const scriptsDir = join(CACHE, "CardScripts");
const lflists = [...new Set(Object.values(BANLISTS).flat())];
await Promise.all([download(ALT_ART_CDB_URL, altArtFile), download(STRINGS_URL, stringsFile), ...lflists.map((f) => download(LFLISTS_URL + f, join(CACHE, f)))]);
clone(SCRIPTS_REPO, scriptsDir, "utility.lua");
clone(BABEL_REPO, babelDir, "cards.cdb");

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "scripts"), { recursive: true });

// cards.json：每张卡一行 [code, alias, setcode(字符串，64 位), type, level(原始值，含刻度), attribute, race(字符串), atk, def, name, strs]
type Row = Record<string, number | bigint | string | null>;
function readCdb(file: string): Row[] {
  const db = new DatabaseSync(file, { readOnly: true });
  const stmt = db.prepare("select d.*, t.* from datas d join texts t on t.id = d.id order by d.id");
  stmt.setReadBigInts(true);
  const rows = stmt.all() as Row[];
  db.close();
  return rows;
}
// cards.cdb 优先，同一个卡号 release-*.cdb 不覆盖
const byId = new Map<number, Row>();
const cdbFiles = ["cards.cdb", ...readdirSync(babelDir).filter((f) => /^release-.*\.cdb$/.test(f)).sort()];
for (const f of cdbFiles) for (const r of readCdb(join(babelDir, f))) if (!byId.has(Number(r.id))) byId.set(Number(r.id), r);
// 异画：卡号和本体相近（< 20），本体在 BabelCDB 里就复制本体数据，alias 指向本体（引擎按本体脚本跑）
let altArts = 0;
for (const r of readCdb(altArtFile)) {
  const id = Number(r.id);
  const base = byId.get(Number(r.alias));
  if (!r.alias || byId.has(id) || !base || Number(base.alias) || Math.abs(id - Number(r.alias)) >= 20) continue;
  byId.set(id, { ...base, id, alias: Number(r.alias) });
  altArts++;
}
const rows = [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));
const cards = rows.map((r) => {
  const strs: string[] = [];
  for (let i = 1; i <= 16; i++) strs.push(String(r[`str${i}`] ?? ""));
  while (strs.length && !strs.at(-1)) strs.pop();
  return [
    Number(r.id),
    Number(r.alias),
    String(BigInt(r.setcode as number | bigint)),
    Number(r.type),
    Number(r.level),
    Number(r.attribute),
    String(BigInt(r.race as number | bigint)),
    Number(r.atk),
    Number(r.def),
    String(r.name),
    strs,
  ];
});
writeFileSync(join(OUT, "cards.json"), JSON.stringify({ version: 1, cards }));

// base.json：根目录的 .lua
const base: Record<string, string> = {};
for (const f of readdirSync(scriptsDir)) if (f.endsWith(".lua")) base[f] = readFileSync(join(scriptsDir, f), "utf8");
writeFileSync(join(OUT, "base.json"), JSON.stringify(base));

// 卡片脚本
let copied = 0;
for (const sub of ["official", "pre-release"]) {
  const dir = join(scriptsDir, sub);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    if (!/^c\d+\.lua$/.test(f) || existsSync(join(OUT, "scripts", f))) continue;
    copyFileSync(join(dir, f), join(OUT, "scripts", f));
    copied++;
  }
}

// strings.json：只要 !system；setnames.json：字段代码 → 字段名（!setname）
const sys: Record<number, string> = {};
const setnames: Record<number, string> = {};
for (const line of readFileSync(stringsFile, "utf8").split(/\r?\n/)) {
  const m = line.match(/^!system (\d+) (.*)$/);
  if (m) sys[Number(m[1])] = m[2];
  const n = line.match(/^!setname 0x([0-9a-f]+) ([^\t]+)/i);
  if (n) setnames[parseInt(n[1], 16)] = n[2].trim();
}
writeFileSync(join(OUT, "strings.json"), JSON.stringify(sys));
writeFileSync(join(OUT, "setnames.json"), JSON.stringify(setnames));

// banlists.json：{ tcg: { name, cards: { 卡号: 0 禁止 / 1 限制 / 2 准限制 } }, ocg: … }
interface Banlist {
  name: string;
  month: string;
  cards: Record<number, number>;
}
function parseLflist(text: string): Banlist {
  const name = text.match(/^!(.+)$/m)?.[1].trim() ?? "";
  const cards: Record<number, number> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(\d+) ([0-2])\b/);
    if (m) cards[Number(m[1])] = Number(m[2]);
  }
  return { name, month: name.match(/^(\d{4}\.\d{2})/)?.[1] ?? "", cards };
}
const thisMonth = new Date().toISOString().slice(0, 7).replace("-", ".");
const banlists: Record<string, Omit<Banlist, "month">> = {};
for (const [format, files] of Object.entries(BANLISTS)) {
  const lists = files.map((f) => parseLflist(readFileSync(join(CACHE, f), "utf8")));
  const current = lists.filter((l) => l.month <= thisMonth).sort((a, b) => b.month.localeCompare(a.month))[0] ?? lists[0];
  banlists[format] = { name: current.name, cards: current.cards };
}
writeFileSync(join(OUT, "banlists.json"), JSON.stringify(banlists));

console.log(`引擎数据：${cards.length} 张卡（${cdbFiles.length} 个 cdb，补了 ${altArts} 个异画卡号），${Object.keys(base).length} 个公共脚本，${copied} 个卡片脚本，${Object.keys(sys).length} 条系统文字，禁卡表 ${Object.values(banlists).map((b) => b.name).join("、")}`);

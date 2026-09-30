import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Combo, Handtrap } from "../src/model/schema";

const root = new URL("..", import.meta.url).pathname;
const dataDir = join(root, "src/data");

export function loadCombos(): Combo[] {
  const dir = join(dataDir, "combos");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const parsed = Combo.safeParse(JSON.parse(readFileSync(join(dir, f), "utf8")));
      if (!parsed.success) throw new Error(`${f} 格式错误:\n${parsed.error.message}`);
      return parsed.data;
    });
}

export function loadHandtraps(): Handtrap[] {
  return Handtrap.array().parse(JSON.parse(readFileSync(join(dataDir, "handtraps.json"), "utf8")));
}

export const snapshotPath = join(root, "public/cards.json");

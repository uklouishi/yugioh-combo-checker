import { Combo, Handtrap } from "../model/schema";
import handtrapsJson from "./handtraps.json";

const comboFiles = import.meta.glob("./combos/*.json", { eager: true, import: "default" });

export const combos: Combo[] = Object.values(comboFiles).map((raw) => Combo.parse(raw));
export const handtraps: Handtrap[] = Handtrap.array().parse(handtrapsJson);
export const handtrapById = new Map(handtraps.map((h) => [h.id, h]));

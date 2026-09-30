"""离线备用：从 ygopro 的 cards.cdb 生成 public/cards.json（字段与 YGOPRODeck 一致）。

用法：
  curl -L -o cards.cdb https://raw.githubusercontent.com/ProjectIgnis/BabelCDB/master/cards.cdb
  python3 scripts/cards-from-cdb.py cards.cdb

能访问 YGOPRODeck 时优先用 npm run sync-cards。
"""
import json, re, sqlite3, sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
ATTR = {1: "EARTH", 2: "WATER", 4: "FIRE", 8: "WIND", 16: "LIGHT", 32: "DARK", 64: "DIVINE"}
RACE = {1: "Warrior", 2: "Spellcaster", 4: "Fairy", 8: "Fiend", 16: "Zombie", 32: "Machine", 64: "Aqua",
        128: "Pyro", 256: "Rock", 512: "Winged Beast", 1024: "Plant", 2048: "Insect", 4096: "Thunder",
        8192: "Dragon", 16384: "Beast", 32768: "Beast-Warrior", 65536: "Dinosaur", 131072: "Fish",
        262144: "Sea Serpent", 524288: "Reptile", 1048576: "Psychic", 2097152: "Divine-Beast",
        4194304: "Creator-God", 8388608: "Wyrm", 16777216: "Cyberse", 33554432: "Illusion"}


def frame(t):
    if t & 0x2: return "spell"
    if t & 0x4: return "trap"
    for bit, name in [(0x4000000, "link"), (0x800000, "xyz"), (0x2000, "synchro"), (0x40, "fusion"),
                      (0x80, "ritual"), (0x4000, "token"), (0x20, "effect")]:
        if t & bit: return name
    return "normal"


def type_name(t):
    if t & 0x2:
        for bit, n in [(0x10000, "Quick-Play"), (0x20000, "Continuous"), (0x80000, "Field"), (0x40000, "Equip"), (0x80, "Ritual")]:
            if t & bit: return f"{n} Spell Card"
        return "Normal Spell Card"
    if t & 0x4:
        for bit, n in [(0x20000, "Continuous"), (0x100000, "Counter")]:
            if t & bit: return f"{n} Trap Card"
        return "Normal Trap Card"
    return {"link": "Link Monster", "xyz": "XYZ Monster", "synchro": "Synchro Monster", "fusion": "Fusion Monster",
            "ritual": "Ritual Effect Monster", "token": "Token", "effect": "Effect Monster", "normal": "Normal Monster"}[frame(t)]


def ids_in_data():
    ids = set()
    for f in [root / "src/data/handtraps.json", *(root / "src/data/combos").glob("*.json")]:
        ids.update(int(x) for x in re.findall(r'"(?:id|handtrap)":\s*(\d+)', f.read_text()))
    return ids


def main(cdb):
    c = sqlite3.connect(cdb)
    out = []
    for cid in sorted(ids_in_data()):
        row = c.execute("select d.id,d.type,d.atk,d.def,d.level,d.race,d.attribute,t.name,t.desc "
                        "from datas d join texts t on t.id=d.id where d.id=?", (cid,)).fetchone()
        if not row:
            print("找不到", cid, file=sys.stderr)
            continue
        i, t, atk, df, lvl, race, attr, name, desc = row
        fr = frame(t)
        card = {"id": i, "name": name, "type": type_name(t), "frameType": fr, "desc": desc,
                "race": RACE.get(race, "") if t & 0x1 else type_name(t).split(" ")[0],
                "card_images": [{"id": i, "image_url": "", "image_url_small": "", "image_url_cropped": ""}]}
        if t & 0x1:
            card.update(atk=atk, attribute=ATTR.get(attr, ""))
            if fr == "link":
                card["linkval"] = lvl & 0xff
            else:
                card.update(def_=df, level=lvl & 0xff)
                card["def"] = card.pop("def_")
        out.append(card)
    (root / "public").mkdir(exist_ok=True)
    (root / "public/cards.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
    print(f"写入 {len(out)} 张卡到 public/cards.json")


main(sys.argv[1])

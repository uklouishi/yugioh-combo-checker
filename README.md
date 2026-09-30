# 游戏王 Combo 查看器

React + TypeScript + Vite。combo 数据是 `src/data/combos/*.json` 里的静态 JSON。

```bash
npm install
npm run dev         # 数据预览页
npm test            # 推导规则 + 数据一致性测试
npm run validate    # 校验所有 combo JSON（有 public/cards.json 时同时核对卡名）
npm run sync-cards  # 从 YGOPRODeck 拉取用到的卡，生成 public/cards.json 快照
```

## 数据格式（`src/model/schema.ts`）

- **Combo**：`deck`、`starter`（起手必须在手的卡）、`requires`（卡组/额外需要的卡）、有序的 `steps`、`endboard`（终场）。
- **Step**：一个或多个 `actions`：
  - `summon`：通常召唤 / 连接召唤等（计入尼比鲁次数）
  - `activate`：卡片发动。`from` 是发动时所在区域，`effects` 是效果里包含的处理标签（如 `add_from_deck`、`ss_from_gy`），`cost` 单独写
  - `resolve_summon`：效果处理带来的召唤
- **interruptions**（可选）：作者对某张手坑的说明，`impact` 为 `combo_ends` / `reduced_endboard` / `reroute` / `minor`，可指向备用 step 或备用 combo；`applies: false` 表示自动推导说能打但实际打不了。
- 卡牌一律用卡片密码 `id` 引用，`name` 只是为了可读，由校验脚本核对。

## 吃坑推导（`src/model/interruptions.ts`）

不需要每一步手写所有手坑。推导规则：

| 手坑 | 命中条件 |
|---|---|
| 灰流丽 | 发动包含 `add_from_deck` / `ss_from_deck` / `send_from_deck_to_gy` |
| 屋敷童 | 发动包含 `add_from_gy` / `ss_from_gy` / `banish_from_gy` |
| 无限泡影、效果遮蒙者、幽鬼兔 | 场上怪兽发动效果（幽鬼兔也包括场上表侧魔陷的效果） |
| D.D.乌鸦、墓穴的指名者 | 在墓地发动，或以墓地的卡为对象 |
| 小丑与锁鸟 | 从卡组加卡入手处理之后 |
| 增殖的G | 本回合第一次特殊召唤 |
| 尼比鲁 | 本回合第 5 次召唤 |

作者在 step 里写的同名手坑说明会覆盖自动结果。

## 卡牌数据（`src/cards/ygoprodeck.ts`）

`CardStore` 按 id 批量请求 YGOPRODeck（50 张一批，一批里有坏 id 时逐张重试），缓存到内存和 localStorage，并优先读 `public/cards.json` 快照。YGOPRODeck 要求不要直接盗链卡图，正式上线前需要把卡图下载到自己的存储。YGOPRODeck 没有中文卡名，手坑的中文名写在 `src/data/handtraps.json`。

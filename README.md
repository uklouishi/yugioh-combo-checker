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
  - `summon`：通常召唤 / 连接召唤等（计入 Nibiru 次数）
  - `activate`：卡片发动。`from` 是发动时所在区域，`effects` 是效果里包含的处理标签（如 `add_from_deck`、`ss_from_gy`），`cost` 单独写
  - `resolve_summon`：效果处理带来的召唤
- **moves**：这一步里卡片的移动（`card`、`from`、`to`，可选 `slot` 格子编号、`faceDown` 盖放、`defense` 守备），场地界面按顺序执行这些移动来画出每一步之后的局面。怪兽区/魔陷区格子 0-4 从左到右，额外怪兽区 0-1。
- **interruptions**（可选）：作者对某张手坑的说明，`impact` 为 `combo_ends` / `reduced_endboard` / `reroute` / `minor`，可指向备用 step 或备用 combo；`applies: false` 表示自动推导说能打但实际打不了。
- 卡牌一律用卡片密码 `id` 引用，`name` 只是为了可读，由校验脚本核对。

- 起手手卡数 `handSize`（默认 5，starter 之外的显示为卡背）和主卡组张数 `deckSize`（默认 40）。

## 网站功能

- **主页**（`#/`）：创建、分析、打开 combo 三个入口，以及最近的 combo。
- **打开 Combo**（`#/open`）：内置和本机保存的 combo 列表，可以筛选、打开、分析、编辑、导出 JSON、删除，也可以上传 JSON。
- **场地播放**（`#/view/<id>/<步骤>`）：双方各 5 个怪兽区和 5 个魔陷区，中间 2 个额外怪兽区；左边场地区和额外卡组，右边墓地、主卡组和除外。右下角的步骤悬浮窗可以拖动、收起，用 ◀ ▶ 或键盘方向键切换步骤。地址里带着当前步骤，可以直接分享到某一步。
- **创建 / 编辑 Combo**（`#/create`、`#/edit/<id>`）：用英文卡名搜索（YGOPRODeck，失败时退回本地卡牌资料）把卡加进卡池，再逐步添加动作、卡片移动（可以根据动作自动生成）和吃坑说明。右侧实时预览这一步之后的场面和能打的手坑，底部列出还需要处理的问题。草稿自动保存在浏览器里，保存后存到本机，也可以导出 JSON。
- **分析 Combo**（`#/analyze/<id>`）：统计步骤和召唤次数，按最坏后果给手坑排序，并用「手坑 × 步骤」表格标出每个吃坑点，点格子可以看说明并跳到场地上的那一步。

卡名一律使用 YGOPRODeck 的英文名。只有部署时下载过卡图的卡会显示卡图，其他卡显示按类型着色的卡框和卡名。

## 部署

推送到 main 后，GitHub Actions（`.github/workflows/deploy.yml`）会运行测试、从 YGOPRODeck 下载卡牌资料和卡图，然后发布到 GitHub Pages。第一次需要在仓库 Settings → Pages 里把 Source 设为 **GitHub Actions**。

`public/cards.json` 是仓库里自带的离线卡牌资料（由 `scripts/cards-from-cdb.py` 从 ygopro 卡库生成），部署时会被 YGOPRODeck 的最新资料覆盖。本地没有卡图时，卡片显示为按类型着色的卡框和卡名。

## 吃坑推导（`src/model/interruptions.ts`）

不需要每一步手写所有手坑。推导规则：

| 手坑 | 命中条件 |
|---|---|
| Ash Blossom | 发动包含 `add_from_deck` / `ss_from_deck` / `send_from_deck_to_gy` |
| Ghost Belle | 发动包含 `add_from_gy` / `ss_from_gy` / `banish_from_gy` |
| Infinite Impermanence、Effect Veiler、Ghost Ogre | 场上怪兽发动效果（Ghost Ogre也包括场上表侧魔陷的效果） |
| D.D. Crow、Called by the Grave | 在墓地发动，或以墓地的卡为对象 |
| Droll & Lock Bird | 从卡组加卡入手处理之后 |
| Maxx "C" | 本回合第一次特殊召唤 |
| Nibiru | 本回合第 5 次召唤 |

作者在 step 里写的同名手坑说明会覆盖自动结果。

## 卡牌数据（`src/cards/ygoprodeck.ts`）

`CardStore` 按 id 批量请求 YGOPRODeck（50 张一批，一批里有坏 id 时逐张重试），缓存到内存和 localStorage，并优先读 `public/cards.json` 快照。YGOPRODeck 要求不要直接盗链卡图，正式上线前需要把卡图下载到自己的存储。YGOPRODeck 没有中文卡名，手坑的中文名写在 `src/data/handtraps.json`。

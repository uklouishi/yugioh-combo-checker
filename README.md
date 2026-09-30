# 游戏王 Combo 查看器

React + TypeScript + Vite。combo 数据是 `src/data/combos/*.json` 里的静态 JSON。

```bash
npm install
npm run dev         # 数据预览页
npm test            # 推导规则 + 数据一致性测试
npm run validate    # 校验所有 combo JSON（有 public/cards.json 时同时核对卡名）
npm run sync-cards  # 从 YGOPRODeck 拉取用到的卡，生成 public/cards.json 快照
npm run sync-engine # 下载规则引擎用的卡片数据和效果脚本到 public/engine/（测试和练习页都要用）
```

## 数据格式（`src/model/schema.ts`）

- **Combo**：`deck`、`starter`（起手必须在手的卡）、`requires`（卡组/额外需要的卡）、有序的 `steps`、`endboard`（终场）。
- **Step**：一个或多个 `actions`：
  - `summon`：通常召唤 / 连接召唤等（计入 Nibiru 次数）
  - `activate`：卡片发动。`from` 是发动时所在区域，`effects` 是效果里包含的处理标签（如 `add_from_deck`、`ss_from_gy`），`cost` 单独写
  - `resolve_summon`：效果处理带来的召唤
- **moves**：这一步里卡片的移动（`card`、`from`、`to`，可选 `slot` 格子编号、`faceDown` 盖放、`defense` 守备），场地界面按顺序执行这些移动来画出每一步之后的局面。怪兽区/魔陷区格子 0-4 从左到右，额外怪兽区 0-1。
- **interruptions**（可选）：作者对某张手坑的说明，数组顺序就是重要性排序（越靠前越重要）。`note` 留空时显示自动推导的理由；`impact`（可不写，表示未评估）为 `combo_ends` / `reduced_endboard` / `reroute` / `minor`，可指向备用 step 或备用 combo；`applies: false` 表示自动推导说能打但实际打不了。
- 卡牌一律用卡片密码 `id` 引用，`name` 只是为了可读，由校验脚本核对。

- 起手手卡数 `handSize`（默认 5，starter 之外的显示为卡背）和主卡组张数 `deckSize`（默认 40）。

## 网站功能

- **实战练习**（`#/play`，主页的核心入口）：粘贴 .ydk 内容或 ydke:// 链接导入牌组（也可以从剪贴板读取），随机抽 5 张或指定起手，然后在场地上直接操作。卡片效果由规则引擎自动处理，见下面的「规则引擎」。
  - 右侧面板列出当前能做的操作（召唤、特召、发动…）和引擎要你做的选择（选卡、选区域、选表示形式、是否连锁…），每一步都可以点「自动」交给默认选择。点场上的卡会把它的操作排到最前；需要选卡时也可以直接点场上的卡。
  - 对手手里放着你勾选的手坑。引擎每次问对手「要不要连锁」时记为一个吃坑点，显示在可拖动、可收起的悬浮窗里，按操作分组。点「让对手发动」会回到那个时点，由对手真的发动这张手坑，然后继续操作。
  - 设置页可以选 TCG 或 OCG 禁卡表（ProjectIgnis LFLists，部署时取当月已生效的一期）：禁止卡不会放进对手手里，牌组超出限制的卡会提示。
  - 对手发动 Maxx "C"、Mulcharmy 这类「对方召唤就抽卡」的手坑后，练习页显示「对手收益」：之后每次召唤让对手抽了几张、结束阶段洗回几张、对手现在的手卡数。
  - 「撤销」回到自己上一次选择之前，「重来」从头开始，「换一手」重新随机抽卡。回合结束时停在终场。
- **主页**（`#/`）：实战练习，以及创建、分析、打开 combo 三个入口和最近的 combo。
- **打开 Combo**（`#/open`）：内置和本机保存的 combo 列表，可以筛选、打开、分析、编辑、导出 JSON、删除，也可以上传 JSON。
- **场地播放**（`#/view/<id>/<步骤>`）：双方各 5 个怪兽区和 5 个魔陷区，中间 2 个额外怪兽区；左边场地区和额外卡组，右边墓地、主卡组和除外。右下角的步骤悬浮窗可以拖动、收起，用 ◀ ▶ 或键盘方向键切换步骤。地址里带着当前步骤，可以直接分享到某一步。
- **创建 / 编辑 Combo**（`#/create`、`#/edit/<id>`）：用英文卡名搜索（YGOPRODeck，失败时退回本地卡牌资料）把卡加进卡池，再逐步添加动作、卡片移动（可以根据动作自动生成）和吃坑说明。右侧实时预览这一步之后的场面和能打的手坑，底部列出还需要处理的问题。草稿自动保存在浏览器里，保存后存到本机，也可以导出 JSON。
- **分析 Combo**（`#/analyze/<id>`）：统计步骤和召唤次数，按最坏后果给手坑排序，并用「手坑 × 步骤」表格标出每个吃坑点，点格子可以看说明并跳到场地上的那一步。

- **吃坑点排序和备注**：创建页的每一步会列出自动识别的吃坑点。点「排序和备注」打开悬浮窗，可以拖动或用 ↑↓ 排重要性、标打断后的影响、修改默认备注、标记「实际打不了」，也可以手动加其他手坑。播放页按这个顺序显示。

卡名一律使用 YGOPRODeck 的英文名。

## 规则引擎（`src/engine/`）

练习页用的是 EDOPro 的 [ygopro-core](https://github.com/edo9300/ygopro-core)，通过 [ocgcore-wasm](https://github.com/n1xx1/ocgcore-wasm) 在浏览器里以 WebAssembly 运行。ocgcore-wasm 从 JSR 安装（npm 上的版本太旧，跟最新的卡片脚本不兼容），`.npmrc` 里配置了 JSR 的 npm 源。卡片效果来自 [ProjectIgnis CardScripts](https://github.com/ProjectIgnis/CardScripts) 的 Lua 脚本，卡片数值来自 [BabelCDB](https://github.com/ProjectIgnis/BabelCDB)，所以不需要为每张卡手写效果，检索、特召、连锁、时点、发动条件都按真实规则处理。这些项目以 AGPL-3.0 发布，网站原样使用，页面底部注明了来源。

- `scripts/sync-engine.ts` 生成 `public/engine/`：`cards.json`（卡片数值、英文卡名、效果说明文字）、`base.json`（公共脚本）、`scripts/c<卡号>.lua`（每张卡的脚本，按需下载）、`strings.json`（系统提示）。
- `session.ts`：一局练习。自己先攻；对手的选择由简单的自动应答处理（连锁一律不发动，除非你在吃坑点让它发动）。所有回应都记录下来，撤销和「让对手发动」都是从头重放到某个位置，结果完全一致。
- `deck.ts`：YDK / ydke:// 解析和导出。

## 部署

推送到 main 后，GitHub Actions（`.github/workflows/deploy.yml`）会下载规则引擎数据、运行测试、从 YGOPRODeck 下载卡牌资料和**全部卡片的卡图**（`npm run sync-all-images`），然后发布到 GitHub Pages。卡图用 Actions 缓存保存，第一次部署要下载一万多张图，之后只下载新卡。个别图片下载失败时，那张卡显示为卡框。第一次需要在仓库 Settings → Pages 里把 Source 设为 **GitHub Actions**。

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

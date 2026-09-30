/**
 * 一局单人练习：自己先攻展开，对手手里拿着手坑。
 *
 * 规则和卡片效果全部交给 EDOPro 的 ygopro-core（WebAssembly），这里只负责：
 * - 建立决斗、放入卡片；
 * - 把需要自己做选择的消息交给界面，把对手的选择交给一个简单的自动应答；
 * - 记下所有回应，用来撤销（从头重放）和「回到某个吃坑点让对手发动」；
 * - 记录每次对手可以连锁手坑的时点（吃坑点）和操作日志。
 */
import {
  OcgDuelMode,
  OcgLocation,
  OcgMessageType,
  OcgPosition,
  OcgProcessResult,
  OcgQueryFlags,
  OcgResponseType,
  type OcgCoreSync,
  type OcgDuelHandle,
  type OcgMessage,
  type OcgResponse,
} from "ocgcore-wasm";
import type { EngineData } from "./data";

export interface DuelSetup {
  main: number[];
  extra: number[];
  /** 指定起手（从 main 里拿出来）；null 表示随机抽 5 张。 */
  hand: number[] | null;
  /** 对手手卡（手坑）。 */
  opponentHand: number[];
  seed: number;
}

/** 需要玩家做选择的消息。 */
export type SelectMessage = Extract<
  OcgMessage,
  {
    type:
      | OcgMessageType.SELECT_BATTLECMD
      | OcgMessageType.SELECT_IDLECMD
      | OcgMessageType.SELECT_EFFECTYN
      | OcgMessageType.SELECT_YESNO
      | OcgMessageType.SELECT_OPTION
      | OcgMessageType.SELECT_CARD
      | OcgMessageType.SELECT_CHAIN
      | OcgMessageType.SELECT_PLACE
      | OcgMessageType.SELECT_POSITION
      | OcgMessageType.SELECT_TRIBUTE
      | OcgMessageType.SORT_CHAIN
      | OcgMessageType.SELECT_COUNTER
      | OcgMessageType.SELECT_SUM
      | OcgMessageType.SELECT_DISFIELD
      | OcgMessageType.SORT_CARD
      | OcgMessageType.SELECT_UNSELECT_CARD
      | OcgMessageType.ANNOUNCE_RACE
      | OcgMessageType.ANNOUNCE_ATTRIB
      | OcgMessageType.ANNOUNCE_CARD
      | OcgMessageType.ANNOUNCE_NUMBER
      | OcgMessageType.ROCK_PAPER_SCISSORS;
  }
>;

const SELECT_TYPES = new Set<number>([
  OcgMessageType.SELECT_BATTLECMD,
  OcgMessageType.SELECT_IDLECMD,
  OcgMessageType.SELECT_EFFECTYN,
  OcgMessageType.SELECT_YESNO,
  OcgMessageType.SELECT_OPTION,
  OcgMessageType.SELECT_CARD,
  OcgMessageType.SELECT_CHAIN,
  OcgMessageType.SELECT_PLACE,
  OcgMessageType.SELECT_POSITION,
  OcgMessageType.SELECT_TRIBUTE,
  OcgMessageType.SORT_CHAIN,
  OcgMessageType.SELECT_COUNTER,
  OcgMessageType.SELECT_SUM,
  OcgMessageType.SELECT_DISFIELD,
  OcgMessageType.SORT_CARD,
  OcgMessageType.SELECT_UNSELECT_CARD,
  OcgMessageType.ANNOUNCE_RACE,
  OcgMessageType.ANNOUNCE_ATTRIB,
  OcgMessageType.ANNOUNCE_CARD,
  OcgMessageType.ANNOUNCE_NUMBER,
  OcgMessageType.ROCK_PAPER_SCISSORS,
]);

export const isSelect = (m: OcgMessage): m is SelectMessage => SELECT_TYPES.has(m.type);

export interface Prompt {
  msg: SelectMessage;
  /** 引擎给的提示编号（例如 506 = Select the card(s) to add to your hand），0 表示没有。 */
  hint: bigint;
  /** 上一次的选择不合法，引擎要求重选。 */
  retry: boolean;
}

export interface FieldCard {
  code: number;
  position: number;
  overlays: number[];
}

export interface PlayerField {
  monsters: (FieldCard | null)[]; // 0-4 主怪兽区，5-6 额外怪兽区
  spells: (FieldCard | null)[]; // 0-4 魔陷区，5 场地区
  hand: FieldCard[];
  grave: FieldCard[];
  banished: FieldCard[];
  extra: FieldCard[];
  deck: number;
}

export interface LogEntry {
  /** 属于第几个操作（-1 表示开局）。 */
  action: number;
  text: string;
  code?: number;
  who: 0 | 1;
}

export interface HitOption {
  code: number;
  /** 在 SELECT_CHAIN 里的序号，让对手发动时用。 */
  index: number;
}

/** 吃坑点：对手此时可以连锁手坑。 */
export interface Hit {
  /** 在回应记录里的位置，回到这里就能改成让对手发动。 */
  at: number;
  action: number;
  context: string;
  options: HitOption[];
  /** 对手实际发动了其中哪张。 */
  used?: number;
}

export interface Action {
  label: string;
  code?: number;
  /** 这个操作对应的回应序号。 */
  at: number;
}

export type Status = "prompt" | "turn_over" | "missing_scripts" | "error";

const LOC_NAME: Record<number, string> = {
  [OcgLocation.DECK]: "卡组",
  [OcgLocation.HAND]: "手卡",
  [OcgLocation.MZONE]: "怪兽区",
  [OcgLocation.SZONE]: "魔陷区",
  [OcgLocation.GRAVE]: "墓地",
  [OcgLocation.REMOVED]: "除外",
  [OcgLocation.EXTRA]: "额外卡组",
  [OcgLocation.OVERLAY]: "超量素材",
};
export const locName = (loc: number) => LOC_NAME[loc & 0xff] ?? "场上";

const PHASE_NAME: Record<number, string> = { 1: "抽卡阶段", 2: "准备阶段", 4: "主要阶段 1", 8: "战斗阶段", 256: "主要阶段 2", 512: "结束阶段" };

const MAX_STEPS = 20000;

export class DuelSession {
  readonly responses: OcgResponse[] = [];
  readonly log: LogEntry[] = [];
  readonly hits: Hit[] = [];
  readonly actions: Action[] = [];
  readonly errors: string[] = [];
  readonly missing = new Set<string>();
  status: Status = "prompt";
  prompt: Prompt | null = null;
  lp: [number, number] = [8000, 8000];

  private handle: OcgDuelHandle | null = null;
  private ri = 0;
  private pending: OcgMessage[] = [];
  private lastSelect: SelectMessage | null = null;
  private lastHint = 0n;
  private lastEvent = "开局";
  private retry = false;
  private aiRetries = 0;
  private chain: { code: number; controller: number }[] = [];
  private finished = false;
  private own: number[] = [];

  constructor(
    private readonly core: OcgCoreSync,
    readonly data: EngineData,
    readonly setup: DuelSetup,
    recorded: OcgResponse[] = [],
  ) {
    this.responses.push(...recorded);
  }

  /** 这局需要的卡片脚本（开局前 prefetch）。 */
  static scriptsFor(setup: DuelSetup, data: EngineData): string[] {
    const codes = [...setup.main, ...setup.extra, ...setup.opponentHand, FILLER].map((c) => data.canonical(c));
    return [...new Set(codes)].map((c) => `c${c}.lua`);
  }

  /** 自己做过的选择在回应记录里的位置。 */
  ownResponseIndices(): number[] {
    return [...this.own];
  }

  get currentAction() {
    return this.actions.length - 1;
  }

  start(): this {
    const { core, data, setup } = this;
    const handle = core.createDuel({
      flags: OcgDuelMode.MODE_MR5,
      seed: seedOf(setup.seed),
      team1: { drawCountPerTurn: 1, startingDrawCount: setup.hand ? 0 : 5, startingLP: 8000 },
      team2: { drawCountPerTurn: 1, startingDrawCount: 0, startingLP: 8000 },
      cardReader: (code) => data.cards.get(code)?.data ?? null,
      scriptReader: (name) => {
        const s = data.readScript(name);
        if (s === undefined) this.missing.add(name);
        return s ?? null;
      },
      errorHandler: (_type, text) => {
        if (this.errors.length < 50) this.errors.push(text);
      },
    });
    if (!handle) {
      this.status = "error";
      this.errors.push("引擎创建决斗失败");
      return this;
    }
    this.handle = handle;
    for (const f of ["constant.lua", "utility.lua"]) core.loadScript(handle, f, data.base[f]);

    const add = (team: 0 | 1, code: number, location: number) =>
      core.duelNewCard(handle, {
        team,
        duelist: 0,
        code: data.canonical(code),
        controller: team,
        location: location as OcgLocation,
        sequence: 0,
        position: OcgPosition.FACEDOWN_DEFENSE,
      });

    const deck = [...setup.main];
    for (const c of setup.hand ?? []) {
      const i = deck.indexOf(c);
      if (i >= 0) deck.splice(i, 1);
      add(0, c, OcgLocation.HAND);
    }
    for (const c of deck) add(0, c, OcgLocation.DECK);
    for (const c of setup.extra) add(0, c, OcgLocation.EXTRA);
    for (const c of setup.opponentHand) add(1, c, OcgLocation.HAND);
    for (let i = 0; i < 40; i++) add(1, FILLER, OcgLocation.DECK);

    if (setup.hand) this.logLine(-1, 0, `起手：${setup.hand.map((c) => data.name(c)).join("、")}`);
    core.startDuel(handle);
    this.advance();
    return this;
  }

  destroy() {
    if (this.handle) this.core.destroyDuel(this.handle);
    this.handle = null;
  }

  /** 玩家对当前提示的回应。 */
  respond(r: OcgResponse) {
    if (this.status !== "prompt" || !this.prompt || !this.handle) return;
    this.responses.length = this.ri;
    this.responses.push(r);
    const msg = this.prompt.msg;
    this.prompt = null;
    this.retry = false;
    this.answer(msg, r);
    this.advance();
  }

  /** 场地状态。 */
  field(): [PlayerField, PlayerField] {
    const h = this.handle;
    const empty = (): PlayerField => ({ monsters: [], spells: [], hand: [], grave: [], banished: [], extra: [], deck: 0 });
    if (!h) return [empty(), empty()];
    const flags = (OcgQueryFlags.CODE | OcgQueryFlags.POSITION | OcgQueryFlags.OVERLAY_CARD) as OcgQueryFlags;
    const q = (p: 0 | 1, location: number) =>
      this.core.duelQueryLocation(h, { flags, controller: p, location: location as OcgLocation }).map((c) =>
        c && c.code !== undefined ? { code: c.code, position: c.position ?? 0, overlays: c.overlayCards ?? [] } : null,
      );
    const list = (p: 0 | 1, loc: number) => q(p, loc).filter((c): c is FieldCard => c !== null);
    return ([0, 1] as const).map((p) => {
      const monsters = q(p, OcgLocation.MZONE);
      const spells = q(p, OcgLocation.SZONE);
      return {
        monsters: Array.from({ length: 7 }, (_, i) => monsters[i] ?? null),
        spells: Array.from({ length: 6 }, (_, i) => spells[i] ?? null),
        hand: list(p, OcgLocation.HAND),
        grave: list(p, OcgLocation.GRAVE),
        banished: list(p, OcgLocation.REMOVED),
        extra: list(p, OcgLocation.EXTRA),
        deck: this.core.duelQueryCount(h, p, OcgLocation.DECK),
      };
    }) as [PlayerField, PlayerField];
  }

  private advance() {
    const h = this.handle;
    if (!h) return;
    let steps = 0;
    while (!this.finished) {
      if (++steps > MAX_STEPS) return this.fail("引擎没有响应（可能卡在循环里）");
      if (this.pending.length === 0) {
        const st = this.core.duelProcess(h);
        this.pending.push(...this.core.duelGetMessage(h));
        if (st === OcgProcessResult.END && this.pending.length === 0) {
          this.finished = true;
          this.status = "turn_over";
          return;
        }
        continue;
      }
      const m = this.pending.shift()!;
      if (this.missing.size) {
        // 有卡片脚本还没取到：交给外面补取后重放
        this.status = "missing_scripts";
        return;
      }
      if (m.type === OcgMessageType.RETRY) {
        if (!this.lastSelect) return this.fail("引擎要求重选，但没有可以重选的内容");
        this.ri--;
        this.responses.length = this.ri;
        this.retry = true;
        this.pending.unshift(this.lastSelect);
        continue;
      }
      if (isSelect(m)) {
        this.lastSelect = m;
        if (this.handleSelect(m) === "stop") return;
        continue;
      }
      if (this.observe(m) === "stop") return;
    }
  }

  private handleSelect(m: SelectMessage): "stop" | "go" {
    const hint = this.lastHint;
    this.lastHint = 0n;
    const recorded = this.responses[this.ri];
    if (m.player === 1) {
      if (this.retry) {
        if (++this.aiRetries > 5) {
          this.fail("对手的自动选择一直不被接受");
          return "stop";
        }
      } else this.aiRetries = 0;
      if (m.type === OcgMessageType.SELECT_CHAIN) this.noteHit(m);
      const r = recorded && !this.retry ? recorded : autoRespond(m, this.aiRetries);
      if (!recorded || this.retry) this.responses[this.ri] = r;
      this.retry = false;
      this.answer(m, r);
      return "go";
    }
    // 没有可以连锁的卡时引擎也会问一下，直接跳过（不算自己的选择，撤销时也跳过它）
    if (m.type === OcgMessageType.SELECT_CHAIN && m.selects.length === 0 && !m.forced) {
      const r: OcgResponse = { type: OcgResponseType.SELECT_CHAIN, index: null };
      this.responses[this.ri] = r;
      this.answer(m, r, true);
      return "go";
    }
    if (recorded && !this.retry) {
      this.answer(m, recorded);
      return "go";
    }
    this.prompt = { msg: m, hint, retry: this.retry };
    this.status = "prompt";
    return "stop";
  }

  /** 把回应交给引擎并记账。 */
  private answer(m: SelectMessage, r: OcgResponse, auto = false) {
    const at = this.ri++;
    if (m.player === 0 && !auto) this.own.push(at);
    if (m.player === 0 && m.type === OcgMessageType.SELECT_IDLECMD && r.type === OcgResponseType.SELECT_IDLECMD) {
      const a = idleLabel(m, r, this.data);
      this.actions.push({ ...a, at });
      this.lastEvent = a.label;
    }
    if (m.player === 1 && m.type === OcgMessageType.SELECT_CHAIN && r.type === OcgResponseType.SELECT_CHAIN && r.index !== null) {
      const code = m.selects[r.index]?.code;
      const hit = [...this.hits].reverse().find((x) => x.at === at);
      if (hit && code) hit.used = code;
    }
    this.core.duelSetResponse(this.handle!, r);
  }

  private noteHit(m: Extract<OcgMessage, { type: OcgMessageType.SELECT_CHAIN }>) {
    if (m.selects.length === 0) return;
    // 对手连锁自己的卡不算吃坑点
    if (this.chain.at(-1)?.controller === 1) return;
    const options: HitOption[] = [];
    m.selects.forEach((s, index) => {
      if (!options.some((o) => o.code === s.code)) options.push({ code: s.code, index });
    });
    const action = this.currentAction;
    const context = this.lastEvent;
    const key = options.map((o) => o.code).join(",");
    const dup = this.hits.some((h) => h.action === action && h.context === context && h.options.map((o) => o.code).join(",") === key);
    if (!dup) this.hits.push({ at: this.ri, action, context, options });
  }

  private logLine(action: number, who: 0 | 1, text: string, code?: number) {
    this.log.push({ action, who, text, code });
  }

  private observe(m: OcgMessage): "stop" | "go" {
    const d = this.data;
    const act = this.currentAction;
    const nm = (c: number) => d.name(c);
    switch (m.type) {
      case OcgMessageType.HINT:
        if (m.hint_type === 3 /* SELECTMSG */ && m.player === 0) this.lastHint = m.hint;
        break;
      case OcgMessageType.NEW_TURN:
        if (m.player === 1) {
          this.logLine(act, 0, "回合结束");
          this.finished = true;
          this.status = "turn_over";
          return "stop";
        }
        break;
      case OcgMessageType.NEW_PHASE:
        if (PHASE_NAME[m.phase]) this.logLine(act, 0, `进入${PHASE_NAME[m.phase]}`);
        break;
      case OcgMessageType.DRAW:
        this.logLine(act, m.player as 0 | 1, `抽卡：${m.drawn.map((c) => (c.code ? nm(c.code) : "?")).join("、")}`);
        break;
      case OcgMessageType.SUMMONING:
        this.lastEvent = `${nm(m.code)} 通常召唤`;
        this.logLine(act, m.controller, `通常召唤 ${nm(m.code)}`, m.code);
        break;
      case OcgMessageType.SPSUMMONING:
        this.lastEvent = `${nm(m.code)} 特殊召唤`;
        this.logLine(act, m.controller, `特殊召唤 ${nm(m.code)}`, m.code);
        break;
      case OcgMessageType.FLIPSUMMONING:
        this.lastEvent = `${nm(m.code)} 反转召唤`;
        this.logLine(act, m.controller, `反转召唤 ${nm(m.code)}`, m.code);
        break;
      case OcgMessageType.SUMMONED:
      case OcgMessageType.SPSUMMONED:
      case OcgMessageType.FLIPSUMMONED:
        this.lastEvent = `${this.lastEvent.replace(/中$/, "")}成功`;
        break;
      case OcgMessageType.CHAINING: {
        this.chain.push({ code: m.code, controller: m.controller });
        const desc = d.describe(m.description);
        this.lastEvent = `${nm(m.code)} 发动效果`;
        this.logLine(act, m.controller, `连锁 ${m.chain_size}：${nm(m.code)}${desc ? `（${desc}）` : ""}`, m.code);
        break;
      }
      case OcgMessageType.CHAIN_NEGATED:
      case OcgMessageType.CHAIN_DISABLED: {
        const code = this.chain[m.chain_size - 1]?.code;
        if (code) this.logLine(act, 0, `连锁 ${m.chain_size} 的 ${nm(code)} 被无效`, code);
        break;
      }
      case OcgMessageType.CHAIN_SOLVED:
        this.lastEvent = "效果处理完";
        break;
      case OcgMessageType.CHAIN_END:
        this.chain = [];
        this.lastEvent = "连锁处理完";
        break;
      case OcgMessageType.MOVE: {
        const { from, to } = m;
        if (!m.card || from.location === to.location) break;
        if (from.location === OcgLocation.DECK && to.location === OcgLocation.HAND) this.lastEvent = `${nm(m.card)} 从卡组加入手卡`;
        if (to.location === OcgLocation.MZONE && from.location !== OcgLocation.MZONE) break; // 召唤已经记过
        this.logLine(act, to.controller, `${nm(m.card)}：${locName(from.location)} → ${locName(to.location)}`, m.card);
        break;
      }
      case OcgMessageType.SET:
        this.logLine(act, m.controller, `盖放 ${nm(m.code)}`, m.code);
        break;
      case OcgMessageType.PAY_LPCOST:
      case OcgMessageType.DAMAGE:
        this.lp[m.player] -= m.amount;
        break;
      case OcgMessageType.RECOVER:
        this.lp[m.player] += m.amount;
        break;
      case OcgMessageType.LPUPDATE:
        this.lp[m.player] = m.lp;
        break;
      case OcgMessageType.WIN:
        this.logLine(act, 0, m.player === 0 ? "你赢了" : "你输了");
        this.finished = true;
        this.status = "turn_over";
        return "stop";
    }
    return "go";
  }

  private fail(text: string) {
    this.errors.push(text);
    this.status = "error";
  }
}

/** 对手卡组的填充卡（Dark Magician），只为了卡组里有东西。 */
export const FILLER = 46986414;

function seedOf(n: number): [bigint, bigint, bigint, bigint] {
  const b = BigInt(n >>> 0) + 1n;
  return [b, b * 7919n + 13n, b * 104729n + 101n, b * 1299709n + 7n];
}

function idleLabel(
  m: Extract<OcgMessage, { type: OcgMessageType.SELECT_IDLECMD }>,
  r: Extract<OcgResponse, { type: OcgResponseType.SELECT_IDLECMD }>,
  d: EngineData,
): { label: string; code?: number } {
  const i = r.index ?? 0;
  const pick = (list: { code: number }[], verb: string) => {
    const c = list[i];
    return c ? { label: `${verb} ${d.name(c.code)}`, code: c.code } : { label: verb };
  };
  switch (r.action) {
    case 0:
      return pick(m.summons, "通常召唤");
    case 1:
      return pick(m.special_summons, "特殊召唤");
    case 2:
      return pick(m.pos_changes, "改变表示形式");
    case 3:
      return pick(m.monster_sets, "盖放");
    case 4:
      return pick(m.spell_sets, "盖放");
    case 5: {
      const a = m.activates[i];
      if (!a) return { label: "发动效果" };
      return { label: `发动 ${d.name(a.code)}`, code: a.code };
    }
    case 6:
      return { label: "进入战斗阶段" };
    case 7:
      return { label: "结束回合" };
    default:
      return { label: "操作" };
  }
}

/** 对手（和「自动」按钮）的默认选择：尽量选第一个合法项，连锁一律不发动。 */
export function autoRespond(m: SelectMessage, attempt = 0): OcgResponse {
  const first = (n: number) => Array.from({ length: n }, (_, i) => i);
  switch (m.type) {
    case OcgMessageType.SELECT_BATTLECMD:
      return { type: OcgResponseType.SELECT_BATTLECMD, action: m.to_m2 ? 2 : 3, index: null };
    case OcgMessageType.SELECT_IDLECMD:
      return { type: OcgResponseType.SELECT_IDLECMD, action: m.to_ep ? 7 : 6, index: null };
    case OcgMessageType.SELECT_EFFECTYN:
      return { type: OcgResponseType.SELECT_EFFECTYN, yes: attempt === 0 };
    case OcgMessageType.SELECT_YESNO:
      return { type: OcgResponseType.SELECT_YESNO, yes: attempt === 0 };
    case OcgMessageType.SELECT_OPTION:
      return { type: OcgResponseType.SELECT_OPTION, index: Math.min(attempt, m.options.length - 1) };
    case OcgMessageType.SELECT_CARD:
      return { type: OcgResponseType.SELECT_CARD, indicies: first(Math.max(1, m.min)).map((i) => (i + attempt) % m.selects.length) };
    case OcgMessageType.SELECT_TRIBUTE:
      return { type: OcgResponseType.SELECT_TRIBUTE, indicies: first(Math.max(1, m.min)) };
    case OcgMessageType.SELECT_UNSELECT_CARD:
      if (m.can_finish && m.unselect_cards.length >= Math.max(1, m.min)) return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null };
      return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: m.select_cards.length ? attempt % m.select_cards.length : null };
    case OcgMessageType.SELECT_CHAIN:
      return { type: OcgResponseType.SELECT_CHAIN, index: m.forced && m.selects.length ? 0 : null };
    case OcgMessageType.SELECT_PLACE:
    case OcgMessageType.SELECT_DISFIELD:
      return {
        type: m.type === OcgMessageType.SELECT_PLACE ? OcgResponseType.SELECT_PLACE : OcgResponseType.SELECT_DISFIELD,
        places: freePlaces(m.player, m.field_mask).slice(attempt, attempt + Math.max(1, m.count)),
      } as OcgResponse;
    case OcgMessageType.SELECT_POSITION: {
      const order = [OcgPosition.FACEUP_ATTACK, OcgPosition.FACEUP_DEFENSE, OcgPosition.FACEDOWN_DEFENSE, OcgPosition.FACEDOWN_ATTACK];
      return { type: OcgResponseType.SELECT_POSITION, position: order.find((p) => m.positions & p) ?? OcgPosition.FACEUP_ATTACK };
    }
    case OcgMessageType.SORT_CHAIN:
      return { type: OcgResponseType.SORT_CARD, order: null };
    case OcgMessageType.SORT_CARD:
      return { type: OcgResponseType.SORT_CARD, order: null };
    case OcgMessageType.SELECT_COUNTER: {
      let left = m.count;
      const counters = m.cards.map((c) => {
        const n = Math.min(c.count, left);
        left -= n;
        return n;
      });
      return { type: OcgResponseType.SELECT_COUNTER, counters };
    }
    case OcgMessageType.SELECT_SUM:
      return { type: OcgResponseType.SELECT_SUM, indicies: sumPick(m.selects.map((c) => c.amount), m.amount - m.selects_must.reduce((s, c) => s + (c.amount & 0xffff), 0)) };
    case OcgMessageType.ANNOUNCE_RACE: {
      const races: bigint[] = [];
      for (let b = 1n; races.length < m.count && b <= BigInt(m.available); b <<= 1n) if (BigInt(m.available) & b) races.push(b);
      return { type: OcgResponseType.ANNOUNCE_RACE, races } as OcgResponse;
    }
    case OcgMessageType.ANNOUNCE_ATTRIB: {
      const attributes: number[] = [];
      for (let b = 1; attributes.length < m.count && b <= m.available; b <<= 1) if (m.available & b) attributes.push(b);
      return { type: OcgResponseType.ANNOUNCE_ATTRIB, attributes } as OcgResponse;
    }
    case OcgMessageType.ANNOUNCE_CARD:
      return { type: OcgResponseType.ANNOUNCE_CARD, card: FILLER };
    case OcgMessageType.ANNOUNCE_NUMBER:
      return { type: OcgResponseType.ANNOUNCE_NUMBER, value: Math.min(attempt, m.options.length - 1) };
    case OcgMessageType.ROCK_PAPER_SCISSORS:
      return { type: OcgResponseType.ROCK_PAPER_SCISSORS, value: 1 };
  }
}

/** 选一组数值凑够 target（数值低 16 位和高 16 位都可以用）。 */
function sumPick(amounts: number[], target: number): number[] {
  const vals = amounts.map((a) => [a & 0xffff, a >>> 16].filter((v) => v > 0));
  const out: number[] = [];
  const dfs = (i: number, left: number): boolean => {
    if (left === 0) return true;
    if (i >= vals.length || left < 0) return false;
    for (const v of vals[i]) {
      out.push(i);
      if (dfs(i + 1, left - v)) return true;
      out.pop();
    }
    return dfs(i + 1, left);
  };
  dfs(0, target);
  return out;
}

export interface Place {
  player: number;
  location: number;
  sequence: number;
}

/** field_mask 里置 1 的是不能选的格子；低 16 位是选择者自己，高 16 位是对方。 */
export function freePlaces(player: number, mask: number): Place[] {
  const out: Place[] = [];
  for (const [side, shift] of [
    [player, 0],
    [1 - player, 16],
  ] as const) {
    for (let s = 0; s < 7; s++) if (!(mask & (1 << (shift + s)))) out.push({ player: side, location: OcgLocation.MZONE, sequence: s });
    for (let s = 0; s < 8; s++) if (!(mask & (1 << (shift + 8 + s)))) out.push({ player: side, location: OcgLocation.SZONE, sequence: s });
  }
  return out;
}

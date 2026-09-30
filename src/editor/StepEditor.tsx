import { handtrapById } from "../data";
import type { Interruption } from "../model/interruptions";
import { zoneName } from "../model/board";
import {
  EffectTag,
  SummonMethod,
  type Activation,
  type CardRef,
  type Move,
  type Step,
  type StepAction,
  type Summon,
  type Zone,
} from "../model/schema";
import { EFFECT_LABEL, IMPACT_OPTIONS, KIND_LABEL, METHOD_LABEL, ZONES } from "./labels";

const IMPACT_SHORT = Object.fromEntries(IMPACT_OPTIONS) as Record<string, string>;
import { EMPTY_CARD, suggestMoves } from "./draft";

interface Props {
  step: Step;
  index: number;
  total: number;
  pool: CardRef[];
  selected: boolean;
  onSelect: () => void;
  onChange: (step: Step) => void;
  onRemove: () => void;
  onMoveStep: (dir: -1 | 1) => void;
  /** 这一步合并后的吃坑点（作者排序在前）。 */
  hits: Interruption[];
  onOpenHandtraps: () => void;
}

const fid = (step: Step, ...parts: Array<string | number>) => ["step", step.id, ...parts].join("-");

function CardSelect({ id, value, pool, onChange }: { id: string; value: CardRef; pool: CardRef[]; onChange: (c: CardRef) => void }) {
  const options = value.id && !pool.some((p) => p.id === value.id) ? [value, ...pool] : pool;
  return (
    <select id={id} value={value.id || ""} onChange={(e) => onChange(options.find((p) => p.id === Number(e.target.value)) ?? EMPTY_CARD)}>
      <option value="">选择卡片…</option>
      {options.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

function ZoneSelect({ id, value, onChange }: { id: string; value: Zone; onChange: (z: Zone) => void }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value as Zone)}>
      {ZONES.map((z) => (
        <option key={z} value={z}>
          {zoneName(z)}
        </option>
      ))}
    </select>
  );
}

function CardList({ id, value, pool, onChange }: { id: string; value: CardRef[]; pool: CardRef[]; onChange: (v: CardRef[]) => void }) {
  return (
    <div className="chips-edit">
      {value.map((c, i) => (
        <span key={`${c.id}-${i}`} className="chip">
          {c.name}
          <button aria-label={`移除 ${c.name}`} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            ×
          </button>
        </span>
      ))}
      <CardSelect id={id} value={EMPTY_CARD} pool={pool} onChange={(c) => c.id && onChange([...value, c])} />
    </div>
  );
}

export function StepEditor({ step, index, total, pool, selected, onSelect, onChange, onRemove, onMoveStep, hits, onOpenHandtraps }: Props) {
  const set = (patch: Partial<Step>) => onChange({ ...step, ...patch });
  const setAction = (i: number, a: StepAction) => set({ actions: step.actions.map((x, j) => (j === i ? a : x)) });
  const setMove = (i: number, m: Move) => set({ moves: step.moves.map((x, j) => (j === i ? m : x)) });

  const addSummon = () =>
    set({ actions: [...step.actions, { type: "summon", summon: { card: EMPTY_CARD, method: "normal", from: "hand" } }] });
  const addActivate = () =>
    set({
      actions: [
        ...step.actions,
        { type: "activate", activation: { card: EMPTY_CARD, from: "monster", kind: "monster_effect", effects: [] } },
      ],
    });
  const addResolveSummon = () =>
    set({ actions: [...step.actions, { type: "resolve_summon", summon: { card: EMPTY_CARD, method: "special", from: "deck" } }] });

  return (
    <article className={`step-edit${selected ? " selected" : ""}`} onFocusCapture={onSelect} onClick={onSelect}>
      <header>
        <span className="step-no">{index + 1}</span>
        <input
          id={fid(step, "title")}
          className="step-title"
          value={step.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="这一步做什么，例如：Snake-Eye Ash ①：检索 Snake-Eyes Poplar"
        />
        <div className="step-tools">
          <button className="mini" onClick={() => onMoveStep(-1)} disabled={index === 0} aria-label="上移">
            ↑
          </button>
          <button className="mini" onClick={() => onMoveStep(1)} disabled={index === total - 1} aria-label="下移">
            ↓
          </button>
          <button className="mini" onClick={onRemove} aria-label="删除这一步">
            删除
          </button>
        </div>
      </header>

      <div className="sub">
        <div className="sub-head">
          <h4>动作</h4>
          <div className="adds">
            <button className="btn" onClick={addSummon}>
              + 召唤
            </button>
            <button className="btn" onClick={addActivate}>
              + 发动
            </button>
            <button className="btn" onClick={addResolveSummon}>
              + 效果带来的召唤
            </button>
          </div>
        </div>
        {step.actions.length === 0 && <p className="muted">每一步至少要有一个动作。</p>}
        {step.actions.map((a, i) => (
          <div key={i} className="action-row">
            {a.type === "activate" ? (
              <ActivationFields
                prefix={fid(step, "a", i)}
                value={a.activation}
                pool={pool}
                onChange={(activation) => setAction(i, { type: "activate", activation })}
              />
            ) : (
              <SummonFields
                prefix={fid(step, "a", i)}
                label={a.type === "summon" ? "召唤" : "效果带来的召唤"}
                value={a.summon}
                pool={pool}
                onChange={(summon) => setAction(i, { type: a.type, summon })}
              />
            )}
            <button className="mini" onClick={() => set({ actions: step.actions.filter((_, j) => j !== i) })}>
              移除
            </button>
          </div>
        ))}
      </div>

      <div className="sub">
        <div className="sub-head">
          <h4>卡片移动</h4>
          <div className="adds">
            <button className="btn" onClick={() => set({ moves: [...step.moves, ...suggestMoves(step.actions)] })}>
              根据动作生成
            </button>
            <button className="btn" onClick={() => set({ moves: [...step.moves, { card: EMPTY_CARD, from: "hand", to: "monster" }] })}>
              + 移动
            </button>
          </div>
        </div>
        {step.moves.length === 0 && <p className="muted">场地预览按这里的移动来画。可以先点「根据动作生成」，再调整。</p>}
        {step.moves.map((m, i) => (
          <div key={i} className="move-row">
            <CardSelect id={fid(step, "m", i, "card")} value={m.card} pool={pool} onChange={(card) => setMove(i, { ...m, card })} />
            <ZoneSelect id={fid(step, "m", i, "from")} value={m.from} onChange={(from) => setMove(i, { ...m, from })} />
            <span className="arrow-sep">→</span>
            <ZoneSelect id={fid(step, "m", i, "to")} value={m.to} onChange={(to) => setMove(i, { ...m, to })} />
            {["monster", "spell_trap", "emz"].includes(m.to) && (
              <select
                id={fid(step, "m", i, "slot")}
                value={m.slot ?? ""}
                onChange={(e) => setMove(i, { ...m, slot: e.target.value === "" ? undefined : Number(e.target.value) })}
                aria-label="格子"
              >
                <option value="">自动格子</option>
                {(m.to === "emz" ? [0, 1] : [0, 1, 2, 3, 4]).map((n) => (
                  <option key={n} value={n}>
                    第 {n + 1} 格
                  </option>
                ))}
              </select>
            )}
            {["monster", "spell_trap"].includes(m.to) && (
              <label className="check">
                <input
                  id={fid(step, "m", i, "down")}
                  type="checkbox"
                  checked={!!m.faceDown}
                  onChange={(e) => setMove(i, { ...m, faceDown: e.target.checked || undefined })}
                />
                盖放
              </label>
            )}
            {m.to === "monster" && (
              <label className="check">
                <input
                  id={fid(step, "m", i, "def")}
                  type="checkbox"
                  checked={!!m.defense}
                  onChange={(e) => setMove(i, { ...m, defense: e.target.checked || undefined })}
                />
                守备
              </label>
            )}
            <button className="mini" onClick={() => set({ moves: step.moves.filter((_, j) => j !== i) })}>
              移除
            </button>
          </div>
        ))}
      </div>

      <div className="sub">
        <div className="sub-head">
          <h4>吃坑点</h4>
          <div className="adds">
            <button className="btn" onClick={onOpenHandtraps}>
              排序和备注
            </button>
          </div>
        </div>
        {hits.length === 0 ? (
          <p className="muted">这一步没有自动识别出的吃坑点。</p>
        ) : (
          <div className="hit-chips">
            {hits.map((h, i) => (
              <button
                key={h.handtrap}
                className={`hit-chip ${h.impact ? `s-${h.impact}` : "s-auto"}`}
                onClick={onOpenHandtraps}
                title={h.note ?? h.reason}
              >
                <span className="n">{i + 1}</span>
                {handtrapById.get(h.handtrap)?.name ?? h.handtrap}
                <span className="lvl">{h.impact ? IMPACT_SHORT[h.impact] : h.rank === undefined ? "自动" : "未评估"}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <label className="field-label" htmlFor={fid(step, "notes")}>
        备注（可选）
      </label>
      <input id={fid(step, "notes")} value={step.notes ?? ""} onChange={(e) => set({ notes: e.target.value || undefined })} />
    </article>
  );
}

function SummonFields({
  prefix,
  label,
  value,
  pool,
  onChange,
}: {
  prefix: string;
  label: string;
  value: Summon;
  pool: CardRef[];
  onChange: (s: Summon) => void;
}) {
  const needsMaterials = ["link", "xyz", "synchro", "fusion", "ritual"].includes(value.method);
  return (
    <div className="fields">
      <span className="kind">{label}</span>
      <CardSelect id={`${prefix}-card`} value={value.card} pool={pool} onChange={(card) => onChange({ ...value, card })} />
      <select
        id={`${prefix}-method`}
        value={value.method}
        onChange={(e) => onChange({ ...value, method: e.target.value as SummonMethod })}
        aria-label="召唤方式"
      >
        {SummonMethod.options.map((m) => (
          <option key={m} value={m}>
            {METHOD_LABEL[m]}
          </option>
        ))}
      </select>
      <span className="muted">从</span>
      <ZoneSelect id={`${prefix}-from`} value={value.from} onChange={(from) => onChange({ ...value, from })} />
      {needsMaterials && (
        <div className="full">
          <span className="muted">素材：</span>
          <CardList
            id={`${prefix}-materials`}
            value={value.materials ?? []}
            pool={pool}
            onChange={(materials) => onChange({ ...value, materials: materials.length ? materials : undefined })}
          />
        </div>
      )}
    </div>
  );
}

function ActivationFields({
  prefix,
  value,
  pool,
  onChange,
}: {
  prefix: string;
  value: Activation;
  pool: CardRef[];
  onChange: (a: Activation) => void;
}) {
  const toggle = (t: EffectTag) =>
    onChange({ ...value, effects: value.effects.includes(t) ? value.effects.filter((x) => x !== t) : [...value.effects, t] });
  return (
    <div className="fields">
      <span className="kind">发动</span>
      <CardSelect id={`${prefix}-card`} value={value.card} pool={pool} onChange={(card) => onChange({ ...value, card })} />
      <select
        id={`${prefix}-kind`}
        value={value.kind}
        onChange={(e) => onChange({ ...value, kind: e.target.value as Activation["kind"] })}
        aria-label="发动类型"
      >
        {Object.entries(KIND_LABEL).map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
      <span className="muted">在</span>
      <ZoneSelect id={`${prefix}-from`} value={value.from} onChange={(from) => onChange({ ...value, from })} />
      <input
        id={`${prefix}-index`}
        className="narrow"
        type="number"
        min={1}
        value={value.effectIndex ?? ""}
        onChange={(e) => onChange({ ...value, effectIndex: e.target.value ? Number(e.target.value) : undefined })}
        placeholder="第几个效果"
        aria-label="第几个效果"
      />
      <div className="full tags">
        <span className="muted">效果包含（决定哪些手坑能打）：</span>
        {EffectTag.options.map((t) => (
          <label key={t} className={`tag-toggle${value.effects.includes(t) ? " on" : ""}`}>
            <input id={`${prefix}-e-${t}`} type="checkbox" checked={value.effects.includes(t)} onChange={() => toggle(t)} />
            {EFFECT_LABEL[t]}
          </label>
        ))}
      </div>
      <div className="full">
        <span className="muted">结果（检索到 / 特召 / 放置的卡）：</span>
        <CardList
          id={`${prefix}-result`}
          value={value.result ?? []}
          pool={pool}
          onChange={(result) => onChange({ ...value, result: result.length ? result : undefined })}
        />
      </div>
      <input
        id={`${prefix}-cost`}
        className="full"
        value={value.cost ?? ""}
        onChange={(e) => onChange({ ...value, cost: e.target.value || undefined })}
        placeholder="cost（可选），例如：把 Snake-Eyes Poplar 送去墓地"
      />
    </div>
  );
}

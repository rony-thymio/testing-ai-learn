import React, { useMemo, useState } from 'react';
import RobotBody from './RobotBody.jsx';
import ActionIcon from './ActionIcon.jsx';
import Slider from './Slider.jsx';
import { FoldTitle, useFold } from './Fold.jsx';
import { SENSORS } from '../spec.js';
import { ACTIONS, ACTION_GROUPS, ACTION_RANGES, DEFAULT_ACTION_SETTINGS } from '../ai/actions.js';
import { LEARNING_RATE_RANGE, DEFAULT_AI_CONFIG, parseLayers, proxValue, blackValue } from '../ai/brain.js';
import { useSize } from '../util.js';
import { fmt } from '../i18n.js';
import { BrainIcon, CheckIcon, PlayIcon, ResetIcon, StopIcon, TrashIcon } from '../icons.jsx';

// The AI Lab, laid out like AlphAI: a line that says what is going on, the control bar, then the sensors (values from 0 to 1),
// the neural network, and the actions with the score the network gives each one. Click an action: the robot does it and, with
// "Learn" on, it becomes an example.
const ROW = 54;                          // the height of an action's row (at least): the output neurons are drawn in front of their row
const INPUT_GAP = 26;                    // the room an input neuron needs

export default function AiLab({ a, snap, enabled, lab, speed, onSpeed }) {
  const { brain } = lab;
  const ai = snap.ai;
  const actions = brain.actions;
  const x = brain.x(snap.prox, ai.ground);
  const acts = brain.net.forward(x);
  const probs = acts[acts.length - 1];
  const best = actions.length ? probs.indexOf(Math.max(...probs)) : -1;
  const counts = brain.counts();
  const n = brain.usable().length;
  // rows tall enough for the inputs to have room beside them
  const rowH = Math.max(ROW, Math.ceil((brain.inputs.length * INPUT_GAP) / Math.max(1, actions.length)));
  const acting = enabled && (ai.phase === 'act' || ai.phase === 'rest');
  const h = a.headline;
  const headline = `${h.supervised}${lab.learn ? '' : ` ${h.paused}`}, ${lab.auto ? h.autonomous : h.piloted}. ${n ? fmt(h.data, { n }) : h.empty}`;
  const status = !enabled ? a.phase.offline
    : ai.phase === 'act' && ai.action >= 0 ? fmt(a.phase.act, { action: a.action[ACTIONS[ai.action].name] })
      : ai.phase === 'rest' ? a.phase.rest : a.phase.idle;

  return (
    <section className="card ai-card" aria-label={a.title}>
      <header className="ai-head">
        <h2 className="ai-headline" aria-live="polite">{headline}</h2>
        <div className={`ai-status ${acting ? 'busy' : ''}`} role="status"><i aria-hidden="true" />{status}</div>
      </header>
      {lab.decision && (lab.auto || Date.now() - lab.decision.at < 5000) && (
        <p className="ai-decision small" aria-live="polite">
          {fmt(a.headline.decision, { action: a.action[ACTIONS[lab.decision.id].name], p: Math.round(lab.decision.p * 100) })}
        </p>
      )}

      <AiControlBar a={a} lab={lab} enabled={enabled} hasExamples={brain.examples.length > 0} hasActions={actions.length > 0} speed={speed} onSpeed={onSpeed} />

      <div className="ai-grid">
        <SensorPanel a={a} snap={snap} brain={brain} enabled={enabled} />
        <div className="ai-netrow">
          <NetworkView a={a} brain={brain} acts={acts} rows={actions.length} rowH={rowH} />
          <div className="ai-actions" role="group" aria-label={a.actions.title}>
            {actions.length === 0 && <p className="muted small ai-noactions">{a.actions.none}</p>}
            {actions.map((id, k) => {
              const on = enabled && ai.phase === 'act' && ai.action === id;
              const c = counts[id] || 0;
              return (
                <button key={id} type="button" className={`ai-action ${on ? 'on' : ''} ${k === best ? 'best' : ''}`} style={{ height: rowH }}
                  disabled={!enabled} onClick={() => lab.teach(id).catch(() => {})} aria-pressed={on}
                  title={c ? fmt(c === 1 ? a.actions.example1 : a.actions.examples, { n: c }) : undefined}>
                  <span className="ai-pct" aria-label={`${Math.round(probs[k] * 100)} %`}>{Math.round(probs[k] * 100)}%</span>
                  <ActionIcon id={id} size={34} />
                  <span className="ai-aname">{a.action[ACTIONS[id].name]}</span>
                  {c > 0 && <span className="ai-count" aria-hidden="true">×{c}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <p className="muted small ai-foot">{a.actions.hint} {a.network.legend}</p>
    </section>
  );
}

// AlphAI's bar: Autonomous, Step by step, Learn, Forget the last, Reset AI, and the speed.
function AiControlBar({ a, lab, enabled, hasExamples, hasActions, speed, onSpeed }) {
  const b = a.bar;
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="ai-bar" role="toolbar" aria-label={b.title}>
      <button type="button" className={`ai-tool ${lab.auto ? 'on' : ''}`} aria-pressed={lab.auto} disabled={!enabled || !hasActions} onClick={lab.toggleAuto} title={b.autoHint}>
        {lab.auto ? <StopIcon size={18} /> : <PlayIcon size={18} />}<span>{b.auto}</span>
      </button>
      <button type="button" className="ai-tool" disabled={!enabled || lab.auto || !hasActions} onClick={lab.step} title={b.stepHint}>
        <span className="ai-glyph" aria-hidden="true">⏭</span><span>{b.step}</span>
      </button>
      <button type="button" className={`ai-tool ${lab.learn ? 'on' : ''}`} aria-pressed={lab.learn} onClick={() => lab.setLearn(!lab.learn)} title={b.learnHint}>
        <BrainIcon size={18} /><span>{b.learn}</span>
      </button>
      <button type="button" className="ai-tool" disabled={!hasExamples} onClick={lab.forgetLast} title={b.forgetHint}>
        <ResetIcon size={18} /><span>{b.forget}</span>
      </button>
      {confirm ? (
        <span className="ai-confirm">
          <span>{b.resetConfirm}</span>
          <button type="button" className="btn small danger" onClick={() => { lab.reset(); setConfirm(false); }}><CheckIcon size={15} />{b.reset}</button>
          <button type="button" className="btn small" onClick={() => setConfirm(false)}>✕</button>
        </span>
      ) : (
        <button type="button" className="ai-tool" disabled={!hasExamples} onClick={() => setConfirm(true)} title={b.resetHint}>
          <TrashIcon size={18} /><span>{b.reset}</span>
        </button>
      )}
      <div className="ai-speed">
        <Slider id="ai-bar-speed" label={b.speed} value={speed} {...ACTION_RANGES.maxSpeed} disabled={!enabled}
          format={(v) => String(v)} defaultValue={DEFAULT_ACTION_SETTINGS.maxSpeed} resetLabel={a.actions.reset} onChange={onSpeed} />
      </div>
    </div>
  );
}

// The sensors, as the network sees them (0 to 1), on the robot seen from above; the last action.
function SensorPanel({ a, snap, brain, enabled }) {
  const ground = snap.ai.ground;
  const hasGround = ground[0] >= 0 && ground[1] >= 0;
  const used = new Set(brain.inputs.map((i) => `${i.kind}${i.index}`));
  const last = snap.ai.action;
  const v2 = (v) => v.toFixed(2);
  return (
    <div className="ai-panel ai-sensors">
      <h3>{a.sensors.title}</h3>
      <svg viewBox="-92 -102 184 196" className="ai-sensor-view" role="img" aria-label={a.sensors.prox}>
        <g className="robot-faint"><RobotBody details={false} /></g>
        {SENSORS.map((s) => {
          const v = proxValue(snap.prox[s.id]);
          const rad = (s.angle * Math.PI) / 180;
          const sx = s.x;
          const sy = -s.y;
          const tx = sx - Math.sin(rad) * 24;
          const ty = sy - Math.cos(rad) * 24;
          const on = used.has(`prox${s.id}`);
          return (
            <g key={s.id} className={on ? '' : 'ai-unused'}>
              <title>{`${a.sensors.names[s.id]}: ${v2(v)} (${snap.prox[s.id] || 0})`}</title>
              <circle cx={sx} cy={sy} r="8" className="ai-sdot" style={{ fillOpacity: 0.1 + 0.9 * v }} />
              <text x={tx} y={ty} className="ai-sval" textAnchor="middle" dominantBaseline="central">{v2(v)}</text>
            </g>
          );
        })}
        {hasGround && [0, 1].map((i) => {
          const v = blackValue(ground[i]);
          const on = used.has(`ground${i}`);
          return (
            <g key={i} className={on ? '' : 'ai-unused'}>
              <title>{`${i ? a.sensors.groundRight : a.sensors.groundLeft}: ${v2(v)} (${ground[i]})`}</title>
              <rect x={i ? 5 : -21} y={-36} width="16" height="16" rx="3" className="ai-gdot" style={{ fill: `hsl(0 0% ${Math.round((1 - v) * 100)}%)` }} />
            </g>
          );
        })}
      </svg>
      <div className="ai-sensor-foot">
        {hasGround
          ? <span><b>{a.sensors.ground}</b> {v2(blackValue(ground[0]))} · {v2(blackValue(ground[1]))}</span>
          : enabled ? <span className="muted">{a.sensors.noGround}</span> : null}
        <span className="ai-last">
          <b>{a.sensors.lastAction}</b>
          {last >= 0 ? <><ActionIcon id={last} size={28} /> {a.action[ACTIONS[last].name]}</> : '—'}
        </span>
      </div>
    </div>
  );
}

// The neural network: the inputs on the left, the intermediate layers, the actions on the right (each in front of its row).
// A line is as thick as its weight is strong; it is yellow when it pushes its action now (input × weight > 0), blue when it
// holds it back. A neuron is as bright as its value.
const MAX_LINES = 2400;
function NetworkView({ a, brain, acts, rows, rowH }) {
  const [ref, { width }] = useSize({ width: 420, height: 300 });
  const net = brain.net;
  const sizes = net.sizes;
  const inputs = brain.inputs;
  const H = Math.max(rows, 1) * rowH;
  const W = Math.max(160, width);
  const left = 34;
  const right = 10;
  const L = sizes.length;
  const xs = sizes.map((_, l) => left + ((W - left - right) * l) / (L - 1));
  const ys = (n, l) => {
    if (l === L - 1) return Array.from({ length: n }, (_, i) => (i + 0.5) * rowH);
    const gap = Math.min(rowH, (H - 16) / Math.max(1, n));
    const top = (H - gap * n) / 2;
    return Array.from({ length: n }, (_, i) => top + (i + 0.5) * gap);
  };
  const Y = sizes.map((n, l) => ys(n, l));
  const maxW = Math.max(0.5, net.maxWeight());
  const lines = useMemo(() => {
    const out = [];
    for (let l = 0; l < net.W.length; l++) {
      const W2 = net.W[l];
      let list = [];
      for (let j = 0; j < W2.length; j++) for (let i = 0; i < W2[j].length; i++) list.push([l, i, j, W2[j][i]]);
      const cap = Math.floor(MAX_LINES / net.W.length);
      if (list.length > cap) list = list.sort((p, q) => Math.abs(q[3]) - Math.abs(p[3])).slice(0, cap);
      out.push(...list);
    }
    return out;
  }, [net, brain.version]);                                       // eslint-disable-line react-hooks/exhaustive-deps
  const capped = net.W.some((w) => w.length * (w[0]?.length || 0) > MAX_LINES / net.W.length);
  const r = (n) => Math.max(2.5, Math.min(9, (H / Math.max(1, n)) * 0.32));

  if (!inputs.length) return <div className="ai-network" ref={ref}><p className="muted small ai-noinput">{a.network.noInput}</p></div>;
  return (
    <div className="ai-network" ref={ref}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${a.network.title}: ${sizes.join(' → ')}`}>
        <g className="ai-lines">
          {lines.map(([l, i, j, w]) => {
            const v = acts[l][i] * w;
            const strong = Math.abs(v) / maxW;
            const cls = strong > 0.06 ? (v > 0 ? 'push' : 'hold') : '';
            return (
              <line key={`${l}-${i}-${j}`} x1={xs[l]} y1={Y[l][i]} x2={xs[l + 1]} y2={Y[l + 1][j]} className={cls}
                strokeWidth={0.4 + 4.6 * (Math.abs(w) / maxW)} style={cls ? { strokeOpacity: Math.min(1, 0.35 + strong) } : undefined} />
            );
          })}
        </g>
        {sizes.map((n, l) => Y[l].map((y, i) => {
          const v = acts[l][i];
          const out = l === L - 1;
          const lit = out ? v : Math.abs(v);
          return <circle key={`n${l}-${i}`} cx={xs[l]} cy={y} r={out ? 6 : r(n)} className={`ai-neuron ${out ? 'out' : ''}`} style={{ fillOpacity: 0.12 + 0.88 * Math.min(1, lit) }} />;
        }))}
        {inputs.map((inp, i) => (
          <text key={`t${i}`} x={xs[0] - 9} y={Y[0][i]} className="ai-inlabel" textAnchor="end" dominantBaseline="central">
            {inp.kind === 'prox' ? a.sensors.short[inp.index] : a.sensors.groundShort[inp.index]}
          </text>
        ))}
      </svg>
      {capped && <p className="muted small">{a.network.big}</p>}
    </div>
  );
}

// ---- the settings: Sensors, Actions, AI (AlphAI's tabs) ---------------------------------------------------------------
function Seg({ label, value, options, onChange }) {
  return (
    <div className="ai-field">
      <span className="ai-flabel">{label}</span>
      <div className="seg" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={v} type="button" className={value === v ? 'on' : ''} aria-pressed={value === v} onClick={() => onChange(v)}>{text}</button>
        ))}
      </div>
    </div>
  );
}

export function AiSensorSettings({ a, lab, foldable = true }) {
  const [open, toggle] = useFold('ai-sensors', foldable);
  const s = a.sensorSettings;
  const cfg = lab.brain.sensors;
  const set = (c) => lab.configure({ sensors: c });
  return (
    <section className={`card ai-settings ${open ? '' : 'folded'}`} aria-label={s.title}>
      <header className="card-head"><div>
        <FoldTitle open={open} onToggle={toggle} controls="ai-sensors-body" foldable={foldable}>{s.title}</FoldTitle>
        {open && <p className="muted small">{s.hint}</p>}
      </div></header>
      {open && (
        <div id="ai-sensors-body" className="ai-form">
          <Seg label={s.prox} value={cfg.proximity} onChange={(v) => set({ proximity: v })}
            options={[['all', s.proxAll], ['front', s.proxFront], ['off', s.proxOff]]} />
          <label className="ai-check">
            <input type="checkbox" checked={cfg.proxBinary} disabled={cfg.proximity === 'off'} onChange={(e) => set({ proxBinary: e.target.checked })} />
            <span>{s.binary}</span><span className="muted small">{s.binaryHint}</span>
          </label>
          <Seg label={s.ground} value={cfg.ground} onChange={(v) => set({ ground: v })}
            options={[['off', s.groundOff], ['binary', s.groundBinary], ['values', s.groundValues]]} />
          <p className="muted small">{s.groundHint} {s.changeNote}</p>
        </div>
      )}
    </section>
  );
}

// The Actions settings: which actions the robot can use (AlphAI's buttons, three a row), and how it carries them out.
export function AiActionSettings({ a, selected, onSelect, settings, onSettings, enabled, foldable = true }) {
  const [open, toggle] = useFold('ai-actions', foldable);
  const toggleGroup = (g) => {
    const on = g.actions.every((id) => selected.includes(id));
    onSelect(on ? selected.filter((id) => !g.actions.includes(id)) : [...new Set([...selected, ...g.actions])]);
  };
  const sec = (v) => fmt(a.actions.seconds, { s: v.toFixed(2).replace(/0$/, '') });
  return (
    <section className={`card ai-settings ${open ? '' : 'folded'}`} aria-label={a.actions.settings}>
      <header className="card-head">
        <div>
          <FoldTitle open={open} onToggle={toggle} controls="ai-settings-body" foldable={foldable}>{a.actions.settings}</FoldTitle>
          {open && <p className="muted small">{a.actions.settingsHint} {fmt(a.actions.chosen, { n: selected.length })}</p>}
        </div>
      </header>
      {open && (
        <div id="ai-settings-body" className="ai-settings-body">
          <div>
            <div className="ai-groups" role="group" aria-label={a.actions.title}>
              {ACTION_GROUPS.map((g) => {
                const on = g.actions.every((id) => selected.includes(id));
                return (
                  <button key={g.id} type="button" className={`ai-group ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggleGroup(g)}>
                    <ActionIcon id={g.actions[0]} size={36} />
                    <span>{a.group[g.id]}</span>
                  </button>
                );
              })}
            </div>
            <p className="muted small">{a.actions.changeNote}</p>
          </div>
          <div className="ai-sliders">
            <Slider id="ai-duration" label={a.actions.duration} hint={a.actions.durationHint} value={settings.duration} {...ACTION_RANGES.duration} disabled={!enabled}
              format={sec} defaultValue={DEFAULT_ACTION_SETTINGS.duration} resetLabel={a.actions.reset} onChange={(v) => onSettings({ duration: v })} />
            <Slider id="ai-pause" label={a.actions.pause} hint={a.actions.pauseHint} value={settings.pause} {...ACTION_RANGES.pause} disabled={!enabled}
              format={(v) => (v > 0 ? sec(v) : a.actions.pauseOff)} defaultValue={DEFAULT_ACTION_SETTINGS.pause} resetLabel={a.actions.reset} onChange={(v) => onSettings({ pause: v })} />
            <Slider id="ai-speed" label={a.actions.maxSpeed} hint={a.actions.maxSpeedHint} value={settings.maxSpeed} {...ACTION_RANGES.maxSpeed} disabled={!enabled}
              format={(v) => String(v)} defaultValue={DEFAULT_ACTION_SETTINGS.maxSpeed} resetLabel={a.actions.reset} onChange={(v) => onSettings({ maxSpeed: v })} />
            <Slider id="ai-gain" label={a.actions.turnGain} hint={a.actions.turnGainHint} value={settings.turnGain} {...ACTION_RANGES.turnGain} disabled={!enabled}
              format={(v) => `${v} %`} defaultValue={DEFAULT_ACTION_SETTINGS.turnGain} resetLabel={a.actions.reset} onChange={(v) => onSettings({ turnGain: v })} />
          </div>
        </div>
      )}
    </section>
  );
}

export function AiBrainSettings({ a, lab, foldable = true }) {
  const [open, toggle] = useFold('ai-brain', foldable);
  const s = a.brainSettings;
  const { brain } = lab;
  const [text, setText] = useState(brain.ai.hidden.join(' '));
  const parsed = parseLayers(text);
  const pending = parsed.join(' ') !== brain.ai.hidden.join(' ');
  const apply = () => { lab.configure({ ai: { hidden: parsed } }); setText(parsed.join(' ')); };
  const counts = brain.counts();
  return (
    <section className={`card ai-settings ${open ? '' : 'folded'}`} aria-label={s.title}>
      <header className="card-head"><div>
        <FoldTitle open={open} onToggle={toggle} controls="ai-brain-body" foldable={foldable}>{s.title}</FoldTitle>
        {open && <p className="muted small">{s.hint}</p>}
      </div></header>
      {open && (
        <div id="ai-brain-body" className="ai-form ai-brain-form">
          <div>
            <Seg label={s.kind} value="supervised" onChange={() => {}} options={[['supervised', s.supervised]]} />
            <p className="muted small">{s.reinforcement}</p>
            <Seg label={s.algorithm} value="neural" onChange={() => {}} options={[['neural', s.neural]]} />
            <Slider id="ai-rate" label={s.rate} hint={s.rateHint} value={brain.ai.learningRate} {...LEARNING_RATE_RANGE}
              format={(v) => v.toFixed(3)} defaultValue={DEFAULT_AI_CONFIG.learningRate} resetLabel={a.actions.reset}
              onChange={(v) => lab.configure({ ai: { learningRate: v } })} />
            <form className="ai-field" onSubmit={(e) => { e.preventDefault(); apply(); }}>
              <label className="ai-flabel" htmlFor="ai-layers">{s.layers}</label>
              <div className="ai-layers">
                <input id="ai-layers" type="text" inputMode="numeric" value={text} placeholder="10 20" onChange={(e) => setText(e.target.value)} onBlur={apply} />
                <button type="submit" className="btn small" disabled={!pending}>{s.apply}</button>
              </div>
              <span className="muted small">{s.layersHint}</span>
              <span className="small">{fmt(s.layersNow, { sizes: brain.net.sizes.join(' → ') })}</span>
            </form>
          </div>
          <div>
            <span className="ai-flabel">{s.data}</span>
            {brain.examples.length === 0 ? <p className="muted small">{s.dataNone}</p> : (
              <ul className="ai-data">
                {Object.entries(counts).map(([id, c]) => (
                  <li key={id}><ActionIcon id={Number(id)} size={26} /><span>{a.action[ACTIONS[id].name]}</span><b>{c}</b></li>
                ))}
              </ul>
            )}
            {brain.loss != null && brain.usable().length > 0 && <p className="muted small">{fmt(s.loss, { v: brain.loss.toFixed(3) })}</p>}
          </div>
        </div>
      )}
    </section>
  );
}

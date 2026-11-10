import React, { useMemo, useRef, useState } from 'react';
import RobotBody from './RobotBody.jsx';
import ActionIcon from './ActionIcon.jsx';
import Slider from './Slider.jsx';
import { FoldTitle, useFold } from './Fold.jsx';
import { SENSORS } from '../spec.js';
import { ACTIONS, ACTION_GROUPS, ACTION_RANGES, DEFAULT_ACTION_SETTINGS } from '../ai/actions.js';
import { LEARNING_RATE_RANGE, PENALTY_RANGE, DEFAULT_AI_CONFIG, GAMMA, parseLayers, proxValue, blackValue } from '../ai/brain.js';
import { PRESETS } from '../ai/presets.js';
import { useSize, sensorColor } from '../util.js';
import { fmt } from '../i18n.js';
import { BrainIcon, CheckIcon, CopyIcon, DownloadIcon, FolderIcon, PlayIcon, QrIcon, ResetIcon, ScanIcon, StopIcon, TrashIcon } from '../icons.jsx';

// The AI Lab: a line that says what is going on, the control bar, then the sensors (values from 0 to 1), the neural network
// (drawn as in the Neurons mode: each sensor in its colour, connections blue when positive and red when negative, as thick as
// they are strong), and the actions with the score the network gives each one. Click an action: the robot does it and, with
// "Learn" on, it becomes an example (supervised) or it learns from its reward (reinforcement).
const ROW = 54;                          // the height of an action's row (at least): the output neurons are drawn in front of their row
const INPUT_GAP = 30;                    // the room an input neuron needs

export default function AiLab({ a, snap, enabled, lab, speed, onSpeed }) {
  const { brain } = lab;
  const rl = brain.reinforcement;
  const ai = snap.ai;
  const actions = brain.actions;
  const x = brain.x(snap.prox, ai.ground);
  const acts = brain.net.forward(x);
  const out = acts[acts.length - 1];
  // the scores: probabilities in % (supervised), values in the units of the rewards (reinforcement)
  const scores = rl ? out.map((q) => q * (1 - GAMMA) * 100) : out.map((p) => p * 100);
  const lo = Math.min(...scores);
  const hi = Math.max(...scores);
  const fill = (v) => (rl ? (hi - lo > 1e-6 ? 8 + (92 * (v - lo)) / (hi - lo) : 50) : v);
  const best = actions.length ? scores.indexOf(hi) : -1;
  const counts = brain.counts();
  const n = brain.usable().length;
  const rowH = Math.max(ROW, Math.ceil((brain.inputs.length * INPUT_GAP) / Math.max(1, actions.length)));
  const acting = enabled && (ai.phase === 'act' || ai.phase === 'rest');
  const h = a.headline;
  const headline = `${rl ? h.reinforcement : h.supervised}${lab.learn ? '' : ` ${h.paused}`}, ${lab.auto ? h.autonomous : h.piloted}. ${
    rl ? fmt(h.steps, { n }) : n ? fmt(h.data, { n }) : h.empty}`;
  const status = !enabled ? a.phase.offline
    : ai.phase === 'act' && ai.action >= 0 ? fmt(a.phase.act, { action: a.action[ACTIONS[ai.action].name] })
      : ai.phase === 'rest' ? a.phase.rest : a.phase.idle;
  const d = lab.decision;
  const exploring = d?.explored && acting && ai.action === d.id;

  return (
    <section className="card ai-card" aria-label={a.title}>
      <header className="ai-head">
        <h2 className="ai-headline" aria-live="polite">{headline}</h2>
        <div className={`ai-status ${acting ? 'busy' : ''}`} role="status"><i aria-hidden="true" />{status}</div>
      </header>
      {d && (lab.auto || Date.now() - d.at < 5000) && (
        <p className={`ai-decision small ${d.explored ? 'explored' : ''}`} aria-live="polite">
          {fmt(d.explored ? h.exploring : rl ? h.decisionValue : h.decision, { action: a.action[ACTIONS[d.id].name], p: Math.round(d.p) })}
        </p>
      )}

      <AiControlBar a={a} lab={lab} enabled={enabled} hasExamples={brain.examples.length > 0 || (rl && n > 0)} hasActions={actions.length > 0} speed={speed} onSpeed={onSpeed} />

      <div className="ai-grid">
        <SensorPanel a={a} snap={snap} brain={brain} enabled={enabled} />
        <div className="ai-netcol">
          <div className="ai-netrow">
            <NetworkView a={a} brain={brain} acts={acts} rows={actions.length} rowH={rowH} />
            <div className="ai-actions" role="group" aria-label={a.actions.title}>
              <div className="ai-actions-head small"><span>{rl ? a.actions.value : a.actions.score}</span></div>
              {actions.length === 0 && <p className="muted small ai-noactions">{a.actions.none}</p>}
              {actions.map((id, k) => {
                const on = enabled && ai.phase === 'act' && ai.action === id;
                const c = counts[id] || 0;
                const v = Math.round(scores[k]);
                return (
                  <button key={id} type="button" className={`ai-action ${on ? 'on' : ''} ${k === best ? 'best' : ''} ${on && exploring ? 'explored' : ''}`}
                    style={{ height: rowH, '--p': `${Math.max(0, Math.min(100, fill(scores[k])))}%` }}
                    disabled={!enabled} onClick={() => lab.teach(id).catch(() => {})} aria-pressed={on}
                    title={!rl && c ? fmt(c === 1 ? a.actions.example1 : a.actions.examples, { n: c }) : undefined}>
                    <span className="ai-bar-fill" aria-hidden="true" />
                    <ActionIcon id={id} size={38} />
                    <span className="ai-aname">{a.action[ACTIONS[id].name]}</span>
                    {!rl && c > 0 && <span className="ai-count" aria-hidden="true">×{c}</span>}
                    <span className="ai-pct">{rl ? (v > 0 ? `+${v}` : v) : `${v}%`}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {rl && <RewardBars a={a} reward={lab.lastReward} level={lab.level} />}
        </div>
      </div>
      <ul className="ai-legend small" aria-label={a.network.legendTitle}>
        <li><i className="pos" aria-hidden="true" />{a.network.pos}</li>
        <li><i className="neg" aria-hidden="true" />{a.network.neg}</li>
        <li className="muted">{a.network.thick}</li>
        <li className="muted">{rl ? a.actions.hintRl : a.actions.hint}</li>
      </ul>
    </section>
  );
}

// Reinforcement: the last reward (or penalty) and the level (the mean of the rewards of the last minute), from -100 to 100.
function RewardBars({ a, reward, level }) {
  const bar = (label, v, cls) => {
    const w = v == null ? 0 : Math.max(-100, Math.min(100, v));
    return (
      <div className={`ai-rbar ${cls} ${w > 0 ? 'good' : w < 0 ? 'bad' : ''}`}>
        <span className="ai-rlabel">{label}</span>
        <span className="ai-rtrack" aria-hidden="true">
          <i className="mid" />
          <i className="fillbar" style={w >= 0 ? { left: '50%', width: `${w / 2}%` } : { right: '50%', width: `${-w / 2}%` }} />
        </span>
        <b className="ai-rnum">{v == null ? '—' : `${v > 0 ? '+' : ''}${Math.round(v)}`}</b>
      </div>
    );
  };
  return (
    <div className="ai-rewards" role="group" aria-label={a.rewards.title}>
      {bar(a.rewards.reward, reward, 'reward')}
      {bar(a.rewards.level, level, 'level')}
    </div>
  );
}

// The control bar: Autonomous, Step by step, Learn, Exploration (reinforcement), Forget the last (supervised), Reset AI, the speed.
function AiControlBar({ a, lab, enabled, hasExamples, hasActions, speed, onSpeed }) {
  const b = a.bar;
  const rl = lab.brain.reinforcement;
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="ai-bar" role="toolbar" aria-label={b.title}>
      <button type="button" className={`ai-tool ${lab.auto ? 'on' : ''}`} aria-pressed={lab.auto} disabled={!enabled || !hasActions} onClick={lab.toggleAuto} title={b.autoHint}>
        {lab.auto ? <StopIcon size={18} /> : <PlayIcon size={18} />}<span>{b.auto}</span>
      </button>
      <button type="button" className="ai-tool" disabled={!enabled || lab.auto || !hasActions} onClick={lab.step} title={b.stepHint}>
        <span className="ai-glyph" aria-hidden="true">⏭</span><span>{b.step}</span>
      </button>
      <button type="button" className={`ai-tool ${lab.learn ? 'on' : ''}`} aria-pressed={lab.learn} onClick={() => lab.setLearn(!lab.learn)} title={rl ? b.learnHintRl : b.learnHint}>
        <BrainIcon size={18} /><span>{b.learn}</span>
      </button>
      {rl ? (
        <button type="button" className={`ai-tool ${lab.brain.ai.exploration ? 'on' : ''}`} aria-pressed={lab.brain.ai.exploration}
          onClick={() => lab.configure({ ai: { exploration: !lab.brain.ai.exploration } })} title={b.exploreHint}>
          <span className="ai-glyph" aria-hidden="true">🧭</span><span>{b.explore}</span>
        </button>
      ) : (
        <button type="button" className="ai-tool" disabled={!lab.brain.examples.length} onClick={lab.forgetLast} title={b.forgetHint}>
          <ResetIcon size={18} /><span>{b.forget}</span>
        </button>
      )}
      {confirm ? (
        <span className="ai-confirm">
          <span>{rl ? b.resetConfirmRl : b.resetConfirm}</span>
          <button type="button" className="btn small danger" onClick={() => { lab.reset(); setConfirm(false); }}><CheckIcon size={15} />{b.reset}</button>
          <button type="button" className="btn small" onClick={() => setConfirm(false)}>✕</button>
        </span>
      ) : (
        <button type="button" className="ai-tool" disabled={!hasExamples} onClick={() => setConfirm(true)} title={rl ? b.resetHintRl : b.resetHint}>
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

// The sensors, as the network sees them (0 to 1), on the robot seen from above, each in its colour; the last action.
function SensorPanel({ a, snap, brain, enabled }) {
  const ground = snap.ai.ground;
  const hasGround = ground[0] >= 0 && ground[1] >= 0;
  const used = new Set(brain.inputs.map((i) => `${i.kind}${i.index}`));
  const last = snap.ai.action;
  const v2 = (v) => v.toFixed(2);
  return (
    <div className="ai-panel ai-sensors">
      <h3>{a.sensors.title}</h3>
      <svg viewBox="-96 -106 192 200" className="ai-sensor-view" role="img" aria-label={a.sensors.prox}>
        <g className="robot-faint"><RobotBody details={false} /></g>
        {SENSORS.map((s) => {
          const v = proxValue(snap.prox[s.id]);
          const rad = (s.angle * Math.PI) / 180;
          const sx = s.x;
          const sy = -s.y;
          const tx = sx - Math.sin(rad) * 26;
          const ty = sy - Math.cos(rad) * 26;
          const on = used.has(`prox${s.id}`);
          return (
            <g key={s.id} className={on ? '' : 'ai-unused'}>
              <title>{`${a.sensors.names[s.id]}: ${v2(v)} (${snap.prox[s.id] || 0})`}</title>
              <circle cx={sx} cy={sy} r="10" className="ai-sback" />
              <circle cx={sx} cy={sy} r="10" className="ai-sdot" style={{ fill: sensorColor(s.id), stroke: sensorColor(s.id), fillOpacity: 0.25 + 0.75 * v }} />
              <text x={sx} y={sy + 0.5} className="ai-snum" textAnchor="middle" dominantBaseline="central">{s.id + 1}</text>
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
          {last >= 0 ? <><ActionIcon id={last} size={30} /> {a.action[ACTIONS[last].name]}</> : '—'}
        </span>
      </div>
    </div>
  );
}

// The neural network, drawn like the one of the Neurons mode: the inputs on the left (a proximity sensor in its colour with its
// number, a ground sensor in grey), the intermediate layers, and an output neuron "+" in front of each action. A connection is
// blue when its weight is positive, red when it is negative, as thick as it is strong, and bright when its signal is strong now.
const MAX_LINES = 2400;
function NetworkView({ a, brain, acts, rows, rowH }) {
  const [ref, { width }] = useSize({ width: 420, height: 300 });
  const net = brain.net;
  const sizes = net.sizes;
  const inputs = brain.inputs;
  const H = Math.max(rows, 1) * rowH;
  const W = Math.max(170, width);
  const left = 22;
  const right = 18;
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
  const rHidden = (n) => Math.max(3, Math.min(9, (H / Math.max(1, n)) * 0.3));

  if (!inputs.length) return <div className="ai-network" ref={ref}><p className="muted small ai-noinput">{a.network.noInput}</p></div>;
  return (
    <div className="ai-network" ref={ref}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${a.network.title}: ${sizes.join(' → ')}`}>
        <g className="ai-conns">
          {lines.map(([l, i, j, w]) => {
            const signal = Math.min(1, Math.abs(acts[l][i] * w) / maxW);
            return (
              <line key={`${l}-${i}-${j}`} x1={xs[l]} y1={Y[l][i]} x2={xs[l + 1]} y2={Y[l + 1][j]} className={w >= 0 ? 'pos' : 'neg'}
                strokeWidth={0.5 + 5 * (Math.abs(w) / maxW)} strokeOpacity={0.18 + 0.82 * Math.max(signal, 0.15 * (Math.abs(w) / maxW))} />
            );
          })}
        </g>
        {sizes.map((n, l) => {
          if (l === 0) {
            return inputs.map((inp, i) => {
              const v = acts[0][i];
              const y = Y[0][i];
              const r = Math.min(11, Math.max(7, (H / Math.max(1, n)) * 0.36));
              if (inp.kind === 'prox') {
                return (
                  <g key={`in${i}`}>
                    <circle cx={xs[0]} cy={y} r={r} className="ai-sback" />
                    <circle cx={xs[0]} cy={y} r={r} className="ai-sdot" style={{ fill: sensorColor(inp.index), stroke: sensorColor(inp.index), fillOpacity: 0.25 + 0.75 * v }} />
                    <text x={xs[0]} y={y + 0.5} className="ai-snum" textAnchor="middle" dominantBaseline="central">{inp.index + 1}</text>
                  </g>
                );
              }
              return (
                <g key={`in${i}`}>
                  <circle cx={xs[0]} cy={y} r={r} className="ai-ground-in" style={{ fill: `hsl(0 0% ${Math.round((1 - v) * 92)}%)` }} />
                  <text x={xs[0]} y={y + 0.5} className={`ai-snum ${v < 0.5 ? 'dark' : ''}`} textAnchor="middle" dominantBaseline="central">{a.sensors.groundShort[inp.index]}</text>
                </g>
              );
            });
          }
          const outLayer = l === L - 1;
          return Y[l].map((y, i) => {
            const r = outLayer ? 12 : rHidden(n);
            const v = acts[l][i];
            const lit = outLayer ? 0 : Math.min(1, Math.abs(v));
            return (
              <g key={`n${l}-${i}`} className={`ai-neuron ${outLayer ? 'out' : ''}`}>
                <circle cx={xs[l]} cy={y} r={r} className="shell" />
                {!outLayer && <circle cx={xs[l]} cy={y} r={r} className={`glow ${v >= 0 ? 'pos' : 'neg'}`} style={{ fillOpacity: 0.85 * lit }} />}
                <circle cx={xs[l]} cy={y} r={r} className="rim" />
                {r >= 6 && <path className="plus" d={`M${xs[l] - r * 0.45},${y} H${xs[l] + r * 0.45} M${xs[l]},${y - r * 0.45} V${y + r * 0.45}`} />}
              </g>
            );
          });
        })}
      </svg>
      {capped && <p className="muted small">{a.network.big}</p>}
    </div>
  );
}

// ---- the settings: Sensors, Actions, AI, Share ------------------------------------------------------------------------
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

// The Actions settings: which actions the robot can use, and how it carries them out.
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
                    <ActionIcon id={g.actions[0]} size={40} />
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

export function AiBrainSettings({ a, lab, onPreset, foldable = true }) {
  const [open, toggle] = useFold('ai-brain', foldable);
  const s = a.brainSettings;
  const { brain } = lab;
  const rl = brain.reinforcement;
  const [text, setText] = useState(brain.ai.hidden.join(' '));
  const [asking, setAsking] = useState(null);
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
        <div id="ai-brain-body" className="ai-form">
          <div className="ai-field">
            <span className="ai-flabel">{s.presets}</span>
            <div className="ai-presets">
              {PRESETS.map((p) => (
                <button key={p.id} type="button" className={`btn small ${asking === p.id ? 'on' : ''}`} onClick={() => setAsking(p.id)}>{s.preset[p.id]}</button>
              ))}
            </div>
            {asking && (
              <p className="ai-confirm-line small">
                {fmt(s.presetConfirm, { name: s.preset[asking] })}
                <button type="button" className="btn small primary" onClick={() => { onPreset(PRESETS.find((p) => p.id === asking)); setAsking(null); setText((PRESETS.find((p) => p.id === asking).ai.hidden || []).join(' ')); }}>{s.presetApply}</button>
                <button type="button" className="btn small" onClick={() => setAsking(null)}>{s.cancel}</button>
              </p>
            )}
            <span className="muted small">{s.presetsHint}</span>
          </div>
          <div className="ai-brain-form">
            <div>
              <Seg label={s.kind} value={brain.ai.kind} onChange={(v) => lab.configure({ ai: { kind: v } })}
                options={[['supervised', s.supervised], ['reinforcement', s.reinforcement]]} />
              <p className="muted small">{rl ? s.kindHintRl : s.kindHint}</p>
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
              {rl ? (
                <>
                  <span className="ai-flabel">{a.rewards.title}</span>
                  <ul className="ai-rules small">
                    <li><b>+100</b> {a.rewards.straight}</li>
                    <li><b>+55</b> {a.rewards.turn}</li>
                    <li><b>{Math.round(-50 * brain.ai.penalty)}</b> {a.rewards.bad}</li>
                    <li><b>0</b> {a.rewards.other}</li>
                  </ul>
                  <Slider id="ai-penalty" label={a.rewards.penalty} hint={a.rewards.penaltyHint} value={brain.ai.penalty} {...PENALTY_RANGE}
                    format={(v) => v.toFixed(1)} defaultValue={DEFAULT_AI_CONFIG.penalty} resetLabel={a.actions.reset}
                    onChange={(v) => lab.configure({ ai: { penalty: v } })} />
                  <p className="small">{fmt(s.steps, { n: brain.transitions.length })}</p>
                </>
              ) : (
                <>
                  <span className="ai-flabel">{s.data}</span>
                  {brain.examples.length === 0 ? <p className="muted small">{s.dataNone}</p> : (
                    <ul className="ai-data">
                      {Object.entries(counts).map(([id, c]) => (
                        <li key={id}><ActionIcon id={Number(id)} size={28} /><span>{a.action[ACTIONS[id].name]}</span><b>{c}</b></li>
                      ))}
                    </ul>
                  )}
                  {brain.loss != null && brain.usable().length > 0 && <p className="muted small">{fmt(s.loss, { v: brain.loss.toFixed(3) })}</p>}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// Share this AI: another device opens it and its robot drives the same way, without teaching it again.
export function AiShare({ a, onSaveFile, onOpenFile, onCopyLink, onShowQr, onScan, message, foldable = true }) {
  const [open, toggle] = useFold('ai-share', foldable);
  const s = a.share;
  const file = useRef(null);
  return (
    <section className={`card ai-settings ${open ? '' : 'folded'}`} aria-label={s.title}>
      <header className="card-head"><div>
        <FoldTitle open={open} onToggle={toggle} controls="ai-share-body" foldable={foldable}>{s.title}</FoldTitle>
        {open && <p className="muted small">{s.hint}</p>}
      </div></header>
      {open && (
        <div id="ai-share-body" className="ai-form">
          <div className="ai-share-row">
            <span className="ai-flabel">{s.send}</span>
            <button type="button" className="btn small" onClick={onShowQr}><QrIcon size={16} />{s.qr}</button>
            <button type="button" className="btn small" onClick={onCopyLink}><CopyIcon size={16} />{s.link}</button>
            <button type="button" className="btn small" onClick={onSaveFile}><DownloadIcon size={16} />{s.save}</button>
          </div>
          <div className="ai-share-row">
            <span className="ai-flabel">{s.receive}</span>
            <button type="button" className="btn small" onClick={onScan}><ScanIcon size={16} />{s.scan}</button>
            <button type="button" className="btn small" onClick={() => file.current?.click()}><FolderIcon size={16} />{s.open}</button>
            <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) f.text().then(onOpenFile, () => onOpenFile(''));
            }} />
          </div>
          {message && <p className="ai-share-msg small" role="status">{message}</p>}
          <p className="muted small">{s.what}</p>
        </div>
      )}
    </section>
  );
}

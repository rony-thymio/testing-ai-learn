import React from 'react';
import RobotBody from './RobotBody.jsx';
import ActionIcon from './ActionIcon.jsx';
import Slider from './Slider.jsx';
import { FoldTitle, useFold } from './Fold.jsx';
import { SENSORS, PROX_MAX } from '../spec.js';
import { ACTIONS, ACTION_GROUPS, ACTION_RANGES, DEFAULT_ACTION_SETTINGS } from '../ai/actions.js';
import { GROUND_SENSORS } from '../sim/arena.js';
import { sensorColor } from '../util.js';
import { fmt } from '../i18n.js';
import { StopIcon } from '../icons.jsx';

// The AI Lab, laid out like AlphAI: the robot's sensors on the left, the neural network in the middle, the actions on the
// right. Step 1: the network is not there yet; an action is carried out when it is clicked.
export default function AiLab({ a, snap, enabled, selected, onAct, onStop }) {
  const ai = snap.ai;
  const acting = enabled && (ai.phase === 'act' || ai.phase === 'rest');
  const status = !enabled ? a.phase.offline
    : ai.phase === 'act' && ai.action >= 0 ? fmt(a.phase.act, { action: a.action[ACTIONS[ai.action].name] })
      : ai.phase === 'rest' ? a.phase.rest : a.phase.idle;
  const shown = ACTIONS.filter((x) => selected.includes(x.id));
  return (
    <section className="card ai-card" aria-label={a.title}>
      <header className="card-head">
        <div>
          <h2>{a.title}</h2>
          <p className="muted small">{a.subtitle}</p>
        </div>
        <div className={`ai-status ${acting ? 'busy' : ''}`} role="status" aria-live="polite">
          <i aria-hidden="true" />{status}
        </div>
      </header>
      <div className="ai-grid">
        <div className="ai-panel ai-sensors">
          <h3>{a.sensors.title}</h3>
          <SensorView a={a} prox={snap.prox} ground={ai.ground} known={enabled} />
        </div>
        <div className="ai-panel ai-network">
          <h3>{a.network.title}</h3>
          <p className="muted small ai-soon">{a.network.soon}</p>
        </div>
        <div className="ai-panel ai-actions">
          <h3>{a.actions.title}</h3>
          {shown.length === 0 && <p className="muted small">{a.actions.none}</p>}
          <ul className="ai-action-list">
            {shown.map((x) => {
              const on = enabled && ai.phase === 'act' && ai.action === x.id;
              return (
                <li key={x.id}>
                  <button type="button" className={`ai-action ${on ? 'on' : ''}`} disabled={!enabled} onClick={() => onAct(x.id)} aria-pressed={on}>
                    <ActionIcon id={x.id} size={34} />
                    <span>{a.action[x.name]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button type="button" className="btn small ai-stop" disabled={!acting} onClick={onStop}><StopIcon size={15} />{a.actions.stop}</button>
          <p className="muted small">{a.actions.hint}</p>
        </div>
      </div>
    </section>
  );
}

// The robot from above, nose up, with what its seven proximity sensors and its two ground sensors read.
function SensorView({ a, prox, ground, known }) {
  const hasGround = ground[0] >= 0 && ground[1] >= 0;
  return (
    <figure className="ai-sensor-view">
      <svg viewBox="-92 -100 184 190" role="img" aria-label={a.sensors.prox}>
        <g className="robot-faint"><RobotBody details={false} /></g>
        {SENSORS.map((s) => {
          const v = Math.min(1, (prox[s.id] || 0) / PROX_MAX);
          const rad = (s.angle * Math.PI) / 180;
          // the robot's x is to the right and y to the front; on the screen the front is up. The reading is written outside, along
          // the direction the sensor looks.
          const sx = s.x;
          const sy = -s.y;
          const tx = sx - Math.sin(rad) * 22;
          const ty = sy - Math.cos(rad) * 22;
          return (
            <g key={s.id}>
              <title>{`${a.sensors.names[s.id]}: ${prox[s.id] || 0}`}</title>
              <circle cx={sx} cy={sy} r="7.5" className="ai-sdot" style={{ fill: sensorColor(s.id), fillOpacity: 0.15 + 0.85 * v, stroke: sensorColor(s.id) }} />
              <text x={tx} y={ty} className="ai-sval" textAnchor="middle" dominantBaseline="central">{prox[s.id] || 0}</text>
            </g>
          );
        })}
        {hasGround && GROUND_SENSORS.map((g, i) => {
          const shade = Math.max(0, Math.min(1, ground[i] / 1000));
          return (
            <g key={i}>
              <title>{`${i ? a.sensors.groundRight : a.sensors.groundLeft}: ${ground[i]}`}</title>
              <rect x={g.x * 2.4 - 6} y={-30} width="12" height="12" rx="2" className="ai-gdot" style={{ fill: `hsl(0 0% ${Math.round(shade * 100)}%)` }} />
            </g>
          );
        })}
      </svg>
      <figcaption className="ai-ground">
        {hasGround
          ? <><b>{a.sensors.ground}</b><span>{a.sensors.groundLeft}: <code>{ground[0]}</code></span><span>{a.sensors.groundRight}: <code>{ground[1]}</code></span><span className="muted">{a.sensors.groundHint}</span></>
          : known ? <span className="muted">{a.sensors.noGround}</span> : null}
      </figcaption>
    </figure>
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

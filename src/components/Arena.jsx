import React, { useEffect, useReducer, useRef, useState } from 'react';
import { SENSORS, COLLISION, PROX_MAX, distanceFromProx } from '../spec.js';
import RobotBody from './RobotBody.jsx';
import { FoldTitle, useFold } from './Fold.jsx';
import { boxCorners } from '../sim/arena.js';
import { sensorColor } from '../util.js';
import { fmt } from '../i18n.js';
import { CubeIcon, ResetIcon, TrashIcon, PlusIcon, EraserIcon } from '../icons.jsx';

// The virtual robot's arena seen from above (y up in the world, so it is turned over for the screen). The obstacles can be
// dragged with a finger or the mouse; the robot is drawn with its seven sensor beams, as long as the readings are large.
const SPEEDS = [1, 2, 5, 10];

export default function Arena({ t, sim, speed, onSpeed, hit, foldable = true, compact = false }) {
  const arena = sim.robot.arena;
  const [open, toggle] = useFold('arena', foldable);       // the arena can be hidden: the virtual robot goes on without it
  // the arena is mutable and moves 50 times a second: it paints itself on its own clock
  const [, bump] = useReducer((n) => n + 1, 0);
  const tick = bump;
  useEffect(() => {
    if (!open) return undefined;
    let raf = 0;
    let last = 0;
    const loop = (now) => { if (now - last > 32) { last = now; bump(); } raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open]);
  const svg = useRef(null);
  const drag = useRef(null);
  const [picked, setPicked] = useState(null);

  const toWorld = (e) => {
    const m = svg.current.getScreenCTM().inverse();
    const p = svg.current.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const q = p.matrixTransform(m);
    return [q.x, arena.height - q.y];
  };
  const down = (o) => (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const [wx, wy] = toWorld(e);
    drag.current = { id: o.id, dx: o.x - wx, dy: o.y - wy, moved: false };
    setPicked(o.id);
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    const [wx, wy] = toWorld(e);
    d.moved = true;
    arena.move(d.id, wx + d.dx, wy + d.dy);
    tick();
  };
  const up = () => { drag.current = null; };

  const { pose } = arena;
  const prox = sim.robot.prox;
  const view = (x, y) => [x, arena.height - y];
  const [rx, ry] = view(pose.x, pose.y);
  const deg = -(pose.h * 180) / Math.PI;
  const trail = arena.trail.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${(arena.height - y).toFixed(1)}`).join('');
  const hitFresh = hit && sim.robot.clock - hit.t < 1500;

  return (
    <section className={`card arena ${compact ? 'compact' : ''} ${open ? '' : 'folded'}`} aria-label={t.arena.title}>
      <header className="card-head">
        <div>
          <FoldTitle open={open} onToggle={toggle} controls="arena-body" foldable={foldable}>{t.arena.title}</FoldTitle>
          {open && <p className="muted small">{t.arena.hint}</p>}
        </div>
      </header>
      {open && <div id="arena-body">
        <div className="arena-wrap">
          <svg ref={svg} viewBox={`-6 -6 ${arena.width + 12} ${arena.height + 12}`} className="arena-svg" role="img" aria-label={t.arena.robot}
            onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
            <rect x="0" y="0" width={arena.width} height={arena.height} className="floor" />
            <rect x="0" y="0" width={arena.width} height={arena.height} className="walls" />
            {trail && <path d={trail} className="trail" />}
            {arena.obstacles.map((o) => {
              const [ox, oy] = view(o.x, o.y);
              const on = picked === o.id;
              return o.kind === 'disc'
                ? <circle key={o.id} cx={ox} cy={oy} r={o.r} className={`obstacle ${on ? 'picked' : ''}`} onPointerDown={down(o)} tabIndex={0} aria-label={t.arena.addDisc} />
                : <polygon key={o.id} points={boxCorners(o).map(([x, y]) => view(x, y).join(',')).join(' ')} className={`obstacle ${on ? 'picked' : ''}`} onPointerDown={down(o)} tabIndex={0} aria-label={t.arena.addBox} />;
            })}
            <g transform={`translate(${rx} ${ry}) rotate(${deg})`} className="vrobot">
              {SENSORS.map((s) => {
                const v = Math.min(1, (prox[s.id] || 0) / PROX_MAX);
                if (v < 0.02) return null;
                const len = distanceFromProx(prox[s.id] || 0);
                return <line key={s.id} x1={s.y} y1={s.x} x2={s.y + Math.cos((s.angle * Math.PI) / 180) * len} y2={s.x - Math.sin((s.angle * Math.PI) / 180) * len} className="beam" style={{ stroke: sensorColor(s.id), opacity: 0.3 + 0.7 * v }} />;
              })}
              <g transform="rotate(90) scale(0.95)"><RobotBody hit={hitFresh} /></g>
              {SENSORS.map((s) => {
                const over = s.id < 5 && (prox[s.id] || 0) > COLLISION;
                return <circle key={s.id} cx={s.y} cy={s.x} r="5.2" className={`sdot ${over ? 'over' : ''}`} style={{ fill: sensorColor(s.id), fillOpacity: 0.35 + 0.65 * Math.min(1, (prox[s.id] || 0) / PROX_MAX) }} />;
              })}
            </g>
          </svg>
        </div>
        <div className="arena-tools">
          <div className="seg" role="group" aria-label={t.arena.speed}>
            <span className="seg-label">{t.arena.speed}</span>
            {SPEEDS.map((s) => <button key={s} type="button" className={speed === s ? 'on' : ''} aria-pressed={speed === s} onClick={() => onSpeed(s)}>×{s}</button>)}
          </div>
          <div className="btn-row tight">
            <button type="button" className="btn small" onClick={() => { arena.reset(); tick(); }}><ResetIcon size={15} />{t.arena.replace}</button>
            <button type="button" className="btn small" onClick={() => { arena.trail = []; tick(); }}><EraserIcon size={15} />{t.arena.clearTrail}</button>
            <button type="button" className="btn small" onClick={() => { arena.add({ kind: 'disc', x: arena.width * 0.5, y: arena.height * 0.5, r: 30 }); tick(); }}><PlusIcon size={15} />{t.arena.addDisc}</button>
            <button type="button" className="btn small" onClick={() => { arena.add({ kind: 'box', x: arena.width * 0.5, y: arena.height * 0.7, w: 90, h: 30, a: 0 }); tick(); }}><CubeIcon size={15} />{t.arena.addBox}</button>
            <button type="button" className="btn small" disabled={picked == null} onClick={() => { arena.remove(picked); setPicked(null); tick(); }}><TrashIcon size={15} />{t.arena.remove}</button>
          </div>
          <p className="muted small">{fmt(t.arena.time, { s: Math.round(sim.robot.clock / 1000) })}</p>
        </div>
      </div>}
    </section>
  );
}

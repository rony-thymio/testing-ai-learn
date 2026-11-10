import React, { useId } from 'react';
import { ACTIONS, K } from '../ai/actions.js';

// The picture of an action, as in AlphAI: the robot seen from above (its nose up) and an arrow for where it goes. A turn on the
// spot is an arc around the robot, as long as the angle; stop is a square; the red light a red dot on the robot.
const C = { x: 18, y: 19.8 };

function arcPath(degrees) {
  // from the top of a circle around the robot, turning left (anticlockwise on the screen) for positive degrees
  const r = Math.abs(degrees) < 45 ? 13 : 15.5;                   // a small angle is drawn closer, so that it shows
  const a0 = -Math.PI / 2;
  const a1 = a0 - (degrees * Math.PI) / 180;
  const p = (a) => [C.x + r * Math.cos(a), C.y + r * Math.sin(a)];
  const [x0, y0] = p(a0);
  const short = Math.min(0.22, Math.abs(a1 - a0) * 0.3);          // a little short, for the arrow head
  const [x1, y1] = p(a1 + (degrees > 0 ? short : -short));
  const large = Math.abs(degrees) > 180 ? 1 : 0;
  const sweep = degrees > 0 ? 0 : 1;
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} ${sweep} ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

function drivePath(a, b) {
  // the share of each wheel: the same = straight, different = a curve towards the side of the slower wheel (forwards or
  // backwards: with the right wheel faster the robot drifts to its left either way)
  const back = a < 0 && b < 0;
  const bend = (Math.abs(b) - Math.abs(a)) / 100;                 // > 0: the right wheel is faster
  const y0 = back ? 29.5 : 10.5;
  const dir = back ? 1 : -1;
  if (Math.abs(bend) < 0.01) return `M${C.x},${y0} V${y0 + dir * 7}`;
  const end = [C.x - bend * 13, y0 + dir * (8 - Math.abs(bend) * 3)];
  return `M${C.x},${y0} Q${C.x},${y0 + dir * 6.5} ${end[0].toFixed(2)},${end[1].toFixed(2)}`;
}

export default function ActionIcon({ id, size = 34, className = '' }) {
  const marker = useId().replace(/:/g, '');
  const act = ACTIONS[id];
  if (!act) return null;
  const robot = (
    <g className="ai-icon-robot">
      <path d="M11,15.5 Q11,11 18,11 Q25,11 25,15.5 V28.5 H11 Z" />
      <circle cx="18" cy="15" r="1.4" className="ai-icon-nose" />
    </g>
  );
  let extra = null;
  if (act.kind === K.STOP) {
    return (
      <svg viewBox="0 0 36 36" width={size} height={size} className={`ai-icon ${className}`} aria-hidden="true" focusable="false">
        <rect x="10" y="10" width="16" height="16" rx="2" className="ai-icon-stop" />
      </svg>
    );
  }
  if (act.kind === K.LIGHT) extra = <circle cx="18" cy="19.5" r="4.5" className={`ai-icon-light l${act.a}`} />;
  const path = act.kind === K.TURN ? arcPath(act.a) : act.kind === K.DRIVE ? drivePath(act.a, act.b) : null;
  return (
    <svg viewBox="0 0 36 36" width={size} height={size} className={`ai-icon ${className}`} aria-hidden="true" focusable="false">
      <defs>
        <marker id={marker} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.3" markerHeight="3.3" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 Z" className="ai-icon-head" />
        </marker>
      </defs>
      {robot}
      {extra}
      {path && <path d={path} className="ai-icon-arrow" markerEnd={`url(#${marker})`} />}
    </svg>
  );
}

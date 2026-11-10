import React from 'react';
import RobotBody from './RobotBody.jsx';
import { ACTIONS, K } from '../ai/actions.js';

// The picture of an action, in the style of the rest of the application: the Thymio 3 seen from above (front up, as in the
// pictures of the network), and beside each wheel an arrow for what that wheel does: up and blue forwards, down and red
// backwards, as long as its share of the speed. A turn on the spot says its angle on the body; stop has no arrow and a square;
// a light colours the body, as the real robot does.
const ARROW_X = 70;                         // the arrows, outside the wheels
const WHEEL_Y = 26;                         // the middle of the wheels (RobotBody's WHEEL.y)
const LIGHT = ['#e02b2b', '#19b33a', '#2a6fe0'];

function WheelArrow({ side, share }) {
  if (!share) return null;
  const x = side * ARROW_X;
  const len = 18 + 46 * Math.min(1, Math.abs(share) / 100);
  const dir = share > 0 ? -1 : 1;           // forwards: up on the screen
  const y0 = WHEEL_Y + (dir < 0 ? 20 : -20);
  const y1 = y0 + dir * len;
  const head = `M${x - 13},${y1 - dir * 2} L${x + 13},${y1 - dir * 2} L${x},${y1 + dir * 16} Z`;
  return (
    <g className={`ai-wheel-arrow ${share > 0 ? 'fwd' : 'back'}`}>
      <path d={`M${x},${y0} V${y1}`} />
      <path d={head} className="head" />
    </g>
  );
}

// The angle of a turn on the spot, as a slice of a disc on the body (from the front, towards the side it turns to).
function AngleWedge({ deg }) {
  const r = 38;
  const cy = -4;
  const a = (Math.min(179.9, Math.abs(deg)) * Math.PI) / 180;
  const side = deg > 0 ? -1 : 1;                            // left: anticlockwise on the screen
  const x = side * r * Math.sin(a);
  const y = cy - r * Math.cos(a);
  const large = Math.abs(deg) > 180 ? 1 : 0;
  return (
    <g className="ai-icon-wedge">
      <circle cx="0" cy={cy} r={r} className="disc" />
      <path d={`M0,${cy} L0,${cy - r} A${r},${r} 0 ${large} ${side > 0 ? 1 : 0} ${x.toFixed(1)},${y.toFixed(1)} Z`} className="slice" />
    </g>
  );
}

export default function ActionIcon({ id, size = 34, className = '' }) {
  const act = ACTIONS[id];
  if (!act) return null;
  let left = 0;
  let right = 0;
  if (act.kind === K.DRIVE) { left = act.a; right = act.b; }
  if (act.kind === K.TURN) { left = act.a > 0 ? -100 : 100; right = -left; }
  const light = act.kind === K.LIGHT ? LIGHT[act.a] : null;
  return (
    <svg viewBox="-92 -84 184 184" width={size} height={size} className={`ai-icon ${className}`} aria-hidden="true" focusable="false">
      <g className="ai-icon-robot" style={light ? { '--body': light } : undefined}>
        <RobotBody details={false} className={light ? 'lit' : ''} />
      </g>
      <WheelArrow side={-1} share={left} />
      <WheelArrow side={1} share={right} />
      {act.kind === K.TURN && <AngleWedge deg={act.a} />}
      {act.kind === K.STOP && <rect x="-15" y="-21" width="30" height="30" rx="4" className="ai-icon-stop" />}
    </svg>
  );
}

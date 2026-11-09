// A small world for the virtual robot: a rectangular arena with obstacles, in millimetres (x to the right, y up, the
// heading in radians counter-clockwise from +x), and the robot in it: two wheels, a round body, seven proximity sensors.
// The sensors follow a curve that looks like the real ones (about 4000 when touching, 3300 at 16 mm, nothing at 11 cm).
import { SENSORS, SENSE_RANGE_MM } from '../spec.js';

export const ROBOT_RADIUS = 55;
export const WHEEL_BASE = 94;
export const MM_PER_UNIT = 150 / 1.8 / 300;         // a wheel speed unit in mm/s (the factory 15 cm in 1.8 s at 300)
export const SENSE_RANGE = SENSE_RANGE_MM;

// What a sensor reads at this distance (mm) from an obstacle straight in front of it.
export function proxFromDistance(d) {
  if (d >= SENSE_RANGE) return 0;
  const v = 4500 * (1 - Math.max(0, d) / SENSE_RANGE) ** 2;
  return Math.min(4095, Math.trunc(v));
}

const rad = (deg) => (deg * Math.PI) / 180;

// The ground sensors: under the nose, a little either side of the middle (x to the right, y to the front, mm), and what they
// read over a light floor and over a black line (a guess until it is measured on a robot: lower is darker).
export const GROUND_SENSORS = [{ x: -8, y: 46 }, { x: 8, y: 46 }];
export const GROUND_WHITE = 900;
export const GROUND_BLACK = 120;

// Whether a point is within `r` of a polyline.
function nearPolyline(px, py, pts, r) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    if (Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) <= r) return true;
  }
  return false;
}

// The first distance along a ray (origin ox, oy; unit direction dx, dy) to a segment, or Infinity.
function raySegment(ox, oy, dx, dy, ax, ay, bx, by) {
  const ex = bx - ax;
  const ey = by - ay;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-9) return Infinity;
  const t = ((ax - ox) * ey - (ay - oy) * ex) / den;
  const u = ((ax - ox) * dy - (ay - oy) * dx) / den;
  return t >= 0 && u >= 0 && u <= 1 ? t : Infinity;
}

function rayCircle(ox, oy, dx, dy, cx, cy, r) {
  const fx = ox - cx;
  const fy = oy - cy;
  const b = fx * dx + fy * dy;
  const c = fx * fx + fy * fy - r * r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const s = Math.sqrt(disc);
  const t = -b - s;
  if (t >= 0) return t;
  const t2 = -b + s;
  return t2 >= 0 ? 0 : Infinity;                    // inside: touching
}

// The four corners of a box obstacle (x, y its centre, w, h its size, a its angle).
export function boxCorners(o) {
  const c = Math.cos(o.a || 0);
  const s = Math.sin(o.a || 0);
  return [[-o.w / 2, -o.h / 2], [o.w / 2, -o.h / 2], [o.w / 2, o.h / 2], [-o.w / 2, o.h / 2]]
    .map(([px, py]) => [o.x + px * c - py * s, o.y + px * s + py * c]);
}

// A deterministic noise, so that two runs of the same arena are the same.
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

export class Arena {
  constructor({ width = 720, height = 460, noise = 10 } = {}) {
    this.width = width;
    this.height = height;
    this.noise = noise;
    this.rand = lcg(7);
    this.nextId = 1;
    this.obstacles = [];
    this.lines = [];                                 // black lines on the floor: { points: [[x, y], ...], width } (mm)
    this.pose = { x: 0, y: 0, h: 0 };
    this.trail = [];
    this.bumped = 0;                                 // counts the contacts of the body, for the interface
    this.layout();
    this.reset();
  }

  // Two discs and a box: enough to meet things from every side.
  layout() {
    this.obstacles = [];
    this.add({ kind: 'disc', x: this.width * 0.62, y: this.height * 0.62, r: 36 });
    this.add({ kind: 'box', x: this.width * 0.38, y: this.height * 0.30, w: 120, h: 34, a: 0.35 });
    this.add({ kind: 'disc', x: this.width * 0.84, y: this.height * 0.30, r: 28 });
  }

  add(o) { const ob = { id: this.nextId++, a: 0, ...o }; this.obstacles.push(ob); return ob; }
  remove(id) { this.obstacles = this.obstacles.filter((o) => o.id !== id); }
  move(id, x, y) {
    const o = this.obstacles.find((q) => q.id === id);
    if (!o) return;
    const m = (o.kind === 'disc' ? o.r : Math.max(o.w, o.h) / 2) + 2;
    o.x = Math.max(m, Math.min(this.width - m, x));
    o.y = Math.max(m, Math.min(this.height - m, y));
  }

  reset() {
    this.pose = { x: this.width * 0.14, y: this.height * 0.5, h: 0 };
    this.trail = [];
  }

  // ---- the robot ----------------------------------------------------------------------------
  // Drive for dtMs with these wheel speeds (units of the firmware: 300 = 83 mm/s).
  step(vl, vr, dtMs) {
    const dt = dtMs / 1000;
    const v = ((vl + vr) / 2) * MM_PER_UNIT;
    const w = ((vr - vl) / WHEEL_BASE) * MM_PER_UNIT;
    const p = this.pose;
    p.h += w * dt;
    p.x += Math.cos(p.h) * v * dt;
    p.y += Math.sin(p.h) * v * dt;
    this.collide();
    const last = this.trail[this.trail.length - 1];
    if (!last || Math.hypot(last[0] - p.x, last[1] - p.y) > 4) {
      this.trail.push([p.x, p.y]);
      if (this.trail.length > 600) this.trail.shift();
    }
  }

  // The body is a disc: pushed out of the walls and the obstacles.
  collide() {
    const p = this.pose;
    const R = ROBOT_RADIUS;
    let touched = false;
    const push = (nx, ny, depth) => { p.x += nx * depth; p.y += ny * depth; touched = true; };
    if (p.x < R) push(1, 0, R - p.x);
    if (p.x > this.width - R) push(-1, 0, p.x - (this.width - R));
    if (p.y < R) push(0, 1, R - p.y);
    if (p.y > this.height - R) push(0, -1, p.y - (this.height - R));
    for (const o of this.obstacles) {
      if (o.kind === 'disc') {
        const dx = p.x - o.x;
        const dy = p.y - o.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        if (d < R + o.r) push(dx / d, dy / d, R + o.r - d);
      } else {
        const c = Math.cos(-(o.a || 0));
        const s = Math.sin(-(o.a || 0));
        const lx = (p.x - o.x) * c - (p.y - o.y) * s;
        const ly = (p.x - o.x) * s + (p.y - o.y) * c;
        const qx = Math.max(-o.w / 2, Math.min(o.w / 2, lx));
        const qy = Math.max(-o.h / 2, Math.min(o.h / 2, ly));
        const dx = lx - qx;
        const dy = ly - qy;
        const d = Math.hypot(dx, dy);
        if (d < R) {
          // back to the world: the normal is (dx, dy) / d turned by the angle of the box
          const nx = d > 1e-6 ? dx / d : 1;
          const ny = d > 1e-6 ? dy / d : 0;
          const ca = Math.cos(o.a || 0);
          const sa = Math.sin(o.a || 0);
          push(nx * ca - ny * sa, nx * sa + ny * ca, R - d);
        }
      }
    }
    if (touched) this.bumped += 1;
  }

  // The distance from a point along a direction to the nearest wall or obstacle.
  castRay(ox, oy, a) {
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let best = Infinity;
    const W = this.width;
    const H = this.height;
    const walls = [[0, 0, W, 0], [W, 0, W, H], [W, H, 0, H], [0, H, 0, 0]];
    for (const [ax, ay, bx, by] of walls) best = Math.min(best, raySegment(ox, oy, dx, dy, ax, ay, bx, by));
    for (const o of this.obstacles) {
      if (o.kind === 'disc') best = Math.min(best, rayCircle(ox, oy, dx, dy, o.x, o.y, o.r));
      else {
        const k = boxCorners(o);
        for (let i = 0; i < 4; i++) {
          const [ax, ay] = k[i];
          const [bx, by] = k[(i + 1) % 4];
          best = Math.min(best, raySegment(ox, oy, dx, dy, ax, ay, bx, by));
        }
      }
    }
    return best;
  }

  // Where a sensor sits in the world, and where it looks.
  sensorPose(sensor) {
    const { x, y, h } = this.pose;
    const f = [Math.cos(h), Math.sin(h)];
    const l = [-Math.sin(h), Math.cos(h)];
    return {
      x: x + sensor.y * f[0] - sensor.x * l[0],
      y: y + sensor.y * f[1] - sensor.x * l[1],
      a: h + rad(sensor.angle),
    };
  }

  // The two ground sensors, under the front of the robot (GROUND_SENSORS): a light floor reads high, a black line low.
  senseGround() {
    const { x, y, h } = this.pose;
    const f = [Math.cos(h), Math.sin(h)];
    const l = [-Math.sin(h), Math.cos(h)];
    return GROUND_SENSORS.map((g) => {
      const px = x + g.y * f[0] - g.x * l[0];
      const py = y + g.y * f[1] - g.x * l[1];
      const black = this.lines.some((ln) => nearPolyline(px, py, ln.points, ln.width / 2));
      const v = black ? GROUND_BLACK : GROUND_WHITE;
      const noisy = this.noise ? v + (this.rand() - 0.5) * 2 * this.noise : v;
      return Math.max(0, Math.round(noisy));
    });
  }

  // The seven readings. Each sensor looks through a narrow cone: three rays, the outer ones count for less.
  sense() {
    return SENSORS.map((s) => {
      const { x, y, a } = this.sensorPose(s);
      let best = 0;
      for (const [off, gain] of [[-12, 0.8], [0, 1], [12, 0.8]]) {
        const d = this.castRay(x, y, a + rad(off));
        best = Math.max(best, proxFromDistance(d) * gain);
      }
      const noisy = best > 0 && this.noise ? best + (this.rand() - 0.5) * 2 * this.noise : best;
      return Math.max(0, Math.min(4095, Math.round(noisy)));
    });
  }
}

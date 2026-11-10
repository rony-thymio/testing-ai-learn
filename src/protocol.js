// The words between the interface and the mode that runs on the robot (src/py/ann_mode.py).
// Pure helpers, no import of the browser: Node can test them.
import { STATES } from './spec.js';
import { PHASES } from './ai/actions.js';

// ---- robot -> interface: "@@word ..." lines on stdout -------------------------------------------
// stdout arrives in BLE notifications cut anywhere: rebuild complete lines. A line ends with a newline,
// or with \x1e (record separator): the mode pads its lines to 100 bytes and ends them that way so that
// the firmware sends them at once (see say() in ann_mode.py).
export class LineAssembler {
  constructor() { this.rest = ''; }
  push(text) {
    const parts = (this.rest + text).split(/[\r\n\x1e]+/);
    this.rest = parts.pop();
    return parts.filter((l) => l.trim());           // blank lines go; the others keep their indentation (a Traceback has some)
  }
}

const ints = (a, n) => a.slice(0, n).map(Number);
const finite = (a) => a.every(Number.isFinite);

// One line of stdout -> an event, or null for anything else (print() of other scripts, noise).
//   @@n state p0..p6 left right learnt learning   every 100 ms; learning is 1 when the robot learns, 0 when it is frozen (also while paused)
//   @@w l0..l6 r0..r6                    the weights, in tenths, when they change (and every 3 s)
//   @@p step baseL baseR forget          the settings: learning step and the speed of each wheel with nothing in front, in tenths; forgetting in seconds
//   @@hit mask                           a collision: bit i = sensor i was over the threshold
//   @@learn n / @@forget n               the weights were just changed by a lesson / by forgetting; n lessons held
//   @@ack msg                            the message of the interface was applied
export function parseRobotLine(line) {
  const l = line.trim();
  // (a Traceback is several lines: the robot backend reads it as a whole)
  if (/^\w*(Error|Exception)\b/.test(l)) return { type: 'error', message: l };
  const m = /^@@(\w+)\s*(.*)$/.exec(l);
  if (!m) return null;
  const [, word, rest] = m;
  const a = rest.split(/\s+/).filter(Boolean);
  switch (word) {
    case 'hello': return { type: 'hello', version: Number(a[0]) || 1 };
    case 'bat': { const v = Number(a[0]); return { type: 'battery', volts: v > 100 ? v / 1000 : v }; }
    case 'state': return Object.values(STATES).includes(a[0]) ? { type: 'state', state: a[0] } : null;
    case 'n': {
      const v = ints(a, 12);
      if (v.length < 11 || !finite(v)) return null;
      const state = STATES[v[0]] || 'drive';
      // (a mode that does not say it: learning is off in the freeze state)
      return { type: 'n', state, prox: v.slice(1, 8), motors: [v[8], v[9]], learnt: v[10], learning: v.length > 11 ? v[11] !== 0 : state !== 'freeze' };
    }
    case 'w': {
      const v = ints(a, 14);
      if (v.length < 14 || !finite(v)) return null;
      return { type: 'w', left: v.slice(0, 7).map((x) => x / 10), right: v.slice(7, 14).map((x) => x / 10) };
    }
    case 'p': {
      const v = ints(a, 4);
      if (v.length < 4 || !finite(v)) return null;
      return { type: 'p', step: v[0] / 10, baseLeft: v[1] / 10, baseRight: v[2] / 10, forget: v[3] };
    }
    case 'hit': { const mask = Number(a[0]) || 0; return { type: 'hit', mask, sensors: Array.from({ length: 7 }, (_, i) => !!(mask & (1 << i))) }; }
    case 'learn': return { type: 'learn', count: Number(a[0]) || 0 };
    case 'forget': return { type: 'forget', count: Number(a[0]) || 0 };
    case 'ack': return { type: 'ack', msg: Number(a[0]) };
    // the AI Lab program (src/py/ai_mode.py)
    case 'a': {
      const v = ints(a, 13);
      if (v.length < 13 || !finite(v)) return null;
      return { type: 'a', phase: PHASES[v[0]] || 'idle', action: v[1], prox: v.slice(2, 9), ground: v.slice(9, 11), motors: [v[11], v[12]] };
    }
    case 'go': {
      const v = ints(a, 2);
      if (v.length < 2 || !finite(v)) return null;
      return { type: word, count: v[0], action: v[1] };
    }
    case 'done': {
      // the sensors as they read when the action is done (for the page to choose the next one)
      const v = ints(a, 11);
      if (v.length < 2 || !finite(v)) return null;
      const ev = { type: 'done', count: v[0], action: v[1] };
      if (v.length >= 11) { ev.prox = v.slice(2, 9); ev.ground = v.slice(9, 11); }
      return ev;
    }
    case 's': {
      const v = ints(a, 4);
      if (v.length < 4 || !finite(v)) return null;
      return { type: 's', duration: v[0] / 100, pause: v[1] / 100, maxSpeed: v[2], turnGain: v[3] };
    }
    case 'exit': return { type: 'exit' };
    case 'bye': return { type: 'bye' };
    default: return null;
  }
}

// ---- interface -> robot: messages written in the four body LEDs ------------------------------------
// The firmware stores the LEDs it is given by the Bluetooth command and the mode reads them back (see
// rx_poll in ann_mode.py, which is the other end of this). A frame is twelve 4-bit values, one per colour
// channel of the four body LEDs: 0 message number, 1 always 15 (the mode never writes 15 on that channel),
// 2 last-frame flag (8) + frame number, 3..10 eight nibbles of the message, 11 checksum. The message: the
// number of items (two nibbles), then the items, five nibbles each: a key (two) and a value (three, signed
// 12 bits). At most eight frames: 12 items. Keys: 0..6 and 7..13 the weights of the sensors towards the left
// and the right wheel (tenths), 14 and 15 the weight of the constant input "1" towards each wheel, which is the
// speed of that wheel with nothing in front (tenths of speed), 16 learning step (tenths), 18 forgetting (s).
export const KEY = { LEFT: 0, RIGHT: 7, BASE_LEFT: 14, BASE_RIGHT: 15, STEP: 16, FORGET: 18, COMMAND: 19 };
export const CMD = { RESET: 1, PAUSE: 2, RESUME: 3, FREEZE: 4, LEARN: 5, QUIT: 6, REPORT: 7 };
export const LIVE_MARK = 15;
export const MAX_FRAMES = 8;
export const MAX_ITEMS = 12;

export const frameSum = (n) => { let t = 5; for (let i = 0; i < 11; i++) t += (i + 1) * n[i]; return t & 15; };
export const isFrame = (n) => !!n && n.length === 12 && n[1] === LIVE_MARK && frameSum(n) === n[11];

// The items that say a weight, a setting or a command. A weight is in the firmware's unit, sent in tenths.
export const weightItem = (side, sensor, w) => [(side === 'right' ? KEY.RIGHT : KEY.LEFT) + sensor, Math.max(-1000, Math.min(1000, Math.round(w * 10)))];
export const stepItem = (step) => [KEY.STEP, Math.max(0, Math.min(200, Math.round(step * 10)))];
export const baseItem = (side, base) => [side === 'right' ? KEY.BASE_RIGHT : KEY.BASE_LEFT, Math.max(0, Math.min(2000, Math.round(base * 10)))];
export const forgetItem = (seconds) => [KEY.FORGET, Math.max(0, Math.min(2000, Math.round(seconds)))];
export const commandItem = (code) => [KEY.COMMAND, code];

// The frames (1 to 8) that carry these [key, value] items, or null when they do not fit.
export function encodeMessage(items, msg = 1) {
  if (items.length > MAX_ITEMS) return null;
  const stream = [items.length >> 4, items.length & 15];
  for (const [key, value] of items) {
    const v = value & 0xfff;
    stream.push(key >> 4, key & 15, (v >> 8) & 15, (v >> 4) & 15, v & 15);
  }
  const count = Math.max(1, Math.ceil(stream.length / 8));
  if (count > MAX_FRAMES) return null;
  const frames = [];
  for (let i = 0; i < count; i++) {
    const data = stream.slice(i * 8, i * 8 + 8);
    while (data.length < 8) data.push(0);
    const frame = [msg & 15, LIVE_MARK, (i === count - 1 ? 8 : 0) | i, ...data, 0];
    frame[11] = frameSum(frame);
    frames.push(frame);
  }
  return frames;
}

// What the mode does with the frames it reads: the same as rx_poll. Returns { msg, items } when a message
// is complete, null otherwise (an incomplete message, a frame that is not one).
export class FrameReceiver {
  constructor() { this.msg = -1; this.got = new Map(); this.last = -1; }

  push(n) {
    if (n.length !== 12 || n[1] !== LIVE_MARK || frameSum(n) !== n[11]) return null;
    if (n[0] !== this.msg) { this.msg = n[0]; this.got = new Map(); this.last = -1; }
    this.got.set(n[2] & 7, n.slice(3, 11));
    if (n[2] & 8) this.last = n[2] & 7;
    if (this.last < 0) return null;
    let stream = [];
    for (let i = 0; i <= this.last; i++) {
      if (!this.got.has(i)) return null;
      stream = stream.concat(this.got.get(i));
    }
    this.got = new Map();
    this.last = -1;
    const count = stream[0] * 16 + stream[1];
    if (stream.length < 2 + 5 * count) return null;
    const items = [];
    for (let k = 0, pos = 2; k < count; k++, pos += 5) {
      let v = (stream[pos + 2] << 8) | (stream[pos + 3] << 4) | stream[pos + 4];
      if (v >= 2048) v -= 4096;
      items.push([stream[pos] * 16 + stream[pos + 1], v]);
    }
    return { msg: this.msg, items };
  }
}

// A frame as the Bluetooth command of the API wants it (thymio.setActuatorState). What the command also
// carries is set to what the mode shows anyway, or to nothing: the mode puts its own lights back at its
// next tick (20 ms). The motors are the exception: the firmware sets them to what the command says, so they
// are given the speeds the robot has just been told by the mode ("@@n"), and the mode gives them again at
// its next tick anyway.
const nib = (v) => Math.max(0, Math.min(15, Math.round(v)));
export const liveActuator = (frame, { circle = new Array(8).fill(0), lego = 0, motors = [0, 0] } = {}) => ({
  circleLEDs: circle.map(nib),
  frontLegoLEDs: Array.from({ length: 8 }, (_, i) => (i >= 8 - Math.min(lego, 8) ? 15 : 0)),
  rearLegoLEDs: Array.from({ length: 8 }, (_, i) => (i >= 16 - Math.min(lego, 16) ? 15 : 0)),
  flRGB: { r: frame[0], g: frame[1], b: frame[2] },
  frRGB: { r: frame[3], g: frame[4], b: frame[5] },
  blRGB: { r: frame[6], g: frame[7], b: frame[8] },
  brRGB: { r: frame[9], g: frame[10], b: frame[11] },
  motorLeft: Math.round(motors[0]) || 0, motorRight: Math.round(motors[1]) || 0, sound: 0,
  smallBottomRGB: { r: 0, g: 0, b: 0 }, smallBackRGB: { r: 0, g: 0, b: 0 },
  buttonLEDs: [0, 0, 0, 0], receiverLED: 0, microphoneLED: false,
});
export const liveNibbles = (a) => [a.flRGB, a.frRGB, a.blRGB, a.brRGB].flatMap((c) => [c.r, c.g, c.b]);

// What the interface asks for, as the items of one or more messages. `change` is any of
// { left: {i: w}, right: {i: w}, step, baseLeft, baseRight, forget, command }; the weights come before the command, which
// applies to the state the mode is in once they are set. Returns arrays of at most MAX_ITEMS items.
export function itemsFor(change) {
  const items = [];
  for (const side of ['left', 'right']) {
    for (const [i, w] of Object.entries(change[side] || {})) items.push(weightItem(side, Number(i), w));
  }
  if (change.step != null) items.push(stepItem(change.step));
  if (change.baseLeft != null) items.push(baseItem('left', change.baseLeft));
  if (change.baseRight != null) items.push(baseItem('right', change.baseRight));
  if (change.forget != null) items.push(forgetItem(change.forget));
  if (change.command != null) items.push(commandItem(change.command));
  const out = [];
  for (let i = 0; i < items.length; i += MAX_ITEMS) out.push(items.slice(i, i + MAX_ITEMS));
  return out;
}

// ---- the AI Lab program (src/py/ai_mode.py): the same frames, other keys ---------------------------------------
// 20 an action to carry out (its number, see src/ai/actions.js), 21 the duration of an action and 22 the pause after it
// (hundredths of a second), 23 the max speed, 24 the colour of the body (r, g, b: 4 bits each; -1: the program's own),
// 25 the correction of the turning time (percent), 19 a command (AI_CMD).
export const AI_KEY = { COMMAND: 19, ACTION: 20, DURATION: 21, PAUSE: 22, MAX_SPEED: 23, LIGHT: 24, TURN_GAIN: 25 };
export const AI_CMD = { QUIT: 6, STOP: 8 };
const lim = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
export const lightValue = (rgb) => (rgb == null ? -1 : (lim(rgb[0], 0, 15) << 8) | (lim(rgb[1], 0, 15) << 4) | lim(rgb[2], 0, 15));

// `change`: any of { duration, pause (seconds), maxSpeed, turnGain, light: [r, g, b] | null, command, action }. The settings
// come first and the action last: an action carries out the settings sent with it.
export function aiItemsFor(change) {
  const items = [];
  if (change.duration != null) items.push([AI_KEY.DURATION, lim(change.duration * 100, 1, 500)]);
  if (change.pause != null) items.push([AI_KEY.PAUSE, lim(change.pause * 100, 0, 500)]);
  if (change.maxSpeed != null) items.push([AI_KEY.MAX_SPEED, lim(change.maxSpeed, 0, 500)]);
  if (change.turnGain != null) items.push([AI_KEY.TURN_GAIN, lim(change.turnGain, 10, 400)]);
  if (change.light !== undefined) items.push([AI_KEY.LIGHT, lightValue(change.light)]);
  if (change.command != null) items.push([AI_KEY.COMMAND, change.command]);
  if (change.action != null) items.push([AI_KEY.ACTION, change.action]);
  return items.length ? [items] : [];
}

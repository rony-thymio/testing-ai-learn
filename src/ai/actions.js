// The actions of the AI Lab, as in AlphAI: what the robot can be asked to do, one at a time. The numbers and what each
// action does are the same as ACTIONS in src/py/ai_mode.py (tests/ai.test.js checks it). Pure data and pure functions:
// no import, so that Node can test everything.

export const K = { DRIVE: 0, TURN: 1, STOP: 2, LIGHT: 3 };

// id: the number the robot knows; kind, a, b: what it does (see ai_mode.py): drive with the left wheel at a % and the right
// one at b % of the max speed, turn on the spot by a degrees (positive: left), stop, a light (a: 0 red, 1 green, 2 blue).
export const ACTIONS = [
  { id: 0, kind: K.STOP, a: 0, b: 0, name: 'stop' },
  { id: 1, kind: K.DRIVE, a: 100, b: 100, name: 'forward' },
  { id: 2, kind: K.DRIVE, a: -100, b: -100, name: 'backward' },
  { id: 3, kind: K.DRIVE, a: 60, b: 100, name: 'slightForwardLeft' },
  { id: 4, kind: K.DRIVE, a: 100, b: 60, name: 'slightForwardRight' },
  { id: 5, kind: K.DRIVE, a: 10, b: 100, name: 'forwardLeft' },
  { id: 6, kind: K.DRIVE, a: 100, b: 10, name: 'forwardRight' },
  { id: 7, kind: K.DRIVE, a: -60, b: -100, name: 'slightBackwardLeft' },
  { id: 8, kind: K.DRIVE, a: -100, b: -60, name: 'slightBackwardRight' },
  { id: 9, kind: K.DRIVE, a: -10, b: -100, name: 'backwardLeft' },
  { id: 10, kind: K.DRIVE, a: -100, b: -10, name: 'backwardRight' },
  { id: 11, kind: K.TURN, a: 15, b: 0, name: 'turn15Left' },
  { id: 12, kind: K.TURN, a: -15, b: 0, name: 'turn15Right' },
  { id: 13, kind: K.TURN, a: 30, b: 0, name: 'turn30Left' },
  { id: 14, kind: K.TURN, a: -30, b: 0, name: 'turn30Right' },
  { id: 15, kind: K.TURN, a: 60, b: 0, name: 'turn60Left' },
  { id: 16, kind: K.TURN, a: -60, b: 0, name: 'turn60Right' },
  { id: 17, kind: K.TURN, a: 90, b: 0, name: 'turn90Left' },
  { id: 18, kind: K.TURN, a: -90, b: 0, name: 'turn90Right' },
  { id: 19, kind: K.TURN, a: 120, b: 0, name: 'turn120Left' },
  { id: 20, kind: K.TURN, a: -120, b: 0, name: 'turn120Right' },
  { id: 21, kind: K.TURN, a: 150, b: 0, name: 'turn150Left' },
  { id: 22, kind: K.TURN, a: -150, b: 0, name: 'turn150Right' },
  { id: 23, kind: K.TURN, a: 180, b: 0, name: 'turn180' },
  { id: 24, kind: K.LIGHT, a: 0, b: 0, name: 'redLight' },
  { id: 25, kind: K.LIGHT, a: 1, b: 0, name: 'greenLight' },
  { id: 26, kind: K.LIGHT, a: 2, b: 0, name: 'blueLight' },
];
// The colours of the light actions, as the robot shows them (r, g, b: 0..16).
export const LIGHTS = [[16, 0, 0], [0, 16, 0], [0, 0, 16]];

// The buttons of the Actions settings, in AlphAI's order (three a row): a button chooses one action, or a pair (left and right).
export const ACTION_GROUPS = [
  { id: 'forward', actions: [1] },
  { id: 'slightForward', actions: [3, 4] },
  { id: 'forwardTurns', actions: [5, 6] },
  { id: 'backward', actions: [2] },
  { id: 'slightBackward', actions: [7, 8] },
  { id: 'backwardTurns', actions: [9, 10] },
  { id: 'stop', actions: [0] },
  { id: 'turn15', actions: [11, 12] },
  { id: 'turn30', actions: [13, 14] },
  { id: 'turn60', actions: [15, 16] },
  { id: 'turn90', actions: [17, 18] },
  { id: 'turn120', actions: [19, 20] },
  { id: 'turn150', actions: [21, 22] },
  { id: 'turn180', actions: [23] },
  { id: 'redLight', actions: [24] },
  { id: 'greenLight', actions: [25] },
  { id: 'blueLight', actions: [26] },
];

// The settings of the actions (AlphAI's defaults: 0.25 s, a pause of 0.1 s, speed 150).
export const DEFAULT_ACTION_SETTINGS = { duration: 0.25, pause: 0.1, maxSpeed: 150, turnGain: 100 };
export const ACTION_RANGES = {
  duration: { min: 0.05, max: 2, step: 0.05 },
  pause: { min: 0, max: 1, step: 0.05 },
  maxSpeed: { min: 50, max: 400, step: 10 },
  turnGain: { min: 50, max: 200, step: 5 },
};
// The actions selected at first (AlphAI's first activity starts from forward, backward and stop).
export const DEFAULT_SELECTED = [1, 2, 0];

// ---- what an action does: the twin of plan() in ai_mode.py (same arithmetic, so the same numbers) ------------------
export const MM_PER_UNIT = 150.0 / 1.8 / 300.0;
export const WHEEL_BASE = 94.0;

export function turnMs(degrees, speed, gain) {
  if (speed <= 0) return 0;
  const rad = (Math.abs(degrees) * 3.14159265) / 180.0;
  return Math.trunc((((((rad * WHEEL_BASE) / (2.0 * speed * MM_PER_UNIT)) * 1000.0) * gain) / 100.0));
}

// { left, right, ms, light }: the wheel speeds, how long, and the light that is on (-1: none, else its number in LIGHTS).
const z = (v) => v + 0;                  // no -0 (a speed of 0 backwards is a speed of 0)
export function plan(id, durationMs, maxSpeed, gain) {
  const act = ACTIONS[id];
  if (act.kind === K.DRIVE) return { left: z(Math.floor((act.a * maxSpeed) / 100)), right: z(Math.floor((act.b * maxSpeed) / 100)), ms: durationMs, light: -1 };
  if (act.kind === K.TURN) {
    const s = act.a > 0 ? maxSpeed : -maxSpeed;
    return { left: z(-s), right: z(s), ms: turnMs(act.a, maxSpeed, gain), light: -1 };
  }
  return { left: 0, right: 0, ms: durationMs, light: act.kind === K.LIGHT ? act.a : -1 };
}

// The phases of the robot's program.
export const PHASES = { 0: 'idle', 1: 'act', 2: 'rest' };

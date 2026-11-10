// The learning of the AI Lab, as in AlphAI: what the robot senses becomes the inputs of a neural network (values from 0 to 1),
// the network gives a score to each action, and it learns from examples (supervised learning: "in this situation, do this").
// Pure JavaScript, no import of the page, so that Node can test it.

import { ACTIONS } from './actions.js';

// ---- the inputs ---------------------------------------------------------------------------------------------------
// AlphAI's Sensors tab. proximity: 'all' (the 7 sensors), 'front' (the 5 at the front) or 'off'; ground: 'off', 'binary'
// (black or not) or 'values'; proxBinary: each proximity sensor is 0 or 1 (something there or not).
export const DEFAULT_SENSOR_CONFIG = { proximity: 'all', proxBinary: false, ground: 'off' };
export const PROX_FULL = 4000;          // a reading of 4000 or more counts as 1 (an object touching the sensor)
export const GROUND_WHITE = 1000;       // a ground reading of 1000 or more counts as white (black detection 0)
const BINARY = 0.5;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const proxValue = (raw) => clamp01((raw || 0) / PROX_FULL);
// "black detection": 0 over a white floor, close to 1 over black (the ground sensors read less light over black)
export const blackValue = (raw) => (raw < 0 ? 0 : clamp01(1 - raw / GROUND_WHITE));

// The inputs a configuration uses, in order: { kind: 'prox' | 'ground', index }.
export function inputList(config) {
  const out = [];
  if (config.proximity === 'all') for (let i = 0; i < 7; i++) out.push({ kind: 'prox', index: i });
  else if (config.proximity === 'front') for (let i = 0; i < 5; i++) out.push({ kind: 'prox', index: i });
  if (config.ground === 'binary' || config.ground === 'values') for (let i = 0; i < 2; i++) out.push({ kind: 'ground', index: i });
  return out;
}

// What the network sees, from what the robot read (prox: 7 readings, ground: 2 readings or -1).
export function inputsFrom(config, prox, ground) {
  return inputList(config).map(({ kind, index }) => {
    if (kind === 'prox') {
      const v = proxValue(prox[index]);
      return config.proxBinary ? (v >= BINARY ? 1 : 0) : v;
    }
    const v = blackValue(ground ? ground[index] : -1);
    return config.ground === 'binary' ? (v >= BINARY ? 1 : 0) : v;
  });
}

// ---- the network --------------------------------------------------------------------------------------------------
// AlphAI's AI tab: the intermediate layers of neurons ("10 20": two layers, of 10 and 20 neurons) and the learning speed.
export const DEFAULT_AI_CONFIG = { hidden: [], learningRate: 0.02 };
export const LEARNING_RATE_RANGE = { min: 0.002, max: 0.1, step: 0.002 };

// "10 20" -> [10, 20]; anything that is not a list of positive numbers (up to 4 layers of up to 200) is left out.
export function parseLayers(text) {
  return String(text || '').split(/[\s,;]+/).filter(Boolean).map(Number)
    .filter((n) => Number.isInteger(n) && n > 0).map((n) => Math.min(200, n)).slice(0, 4);
}

// A pseudo-random generator, so that a network starts the same way from the same seed (tests).
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export class Network {
  // sizes: [inputs, ...hidden, outputs]
  constructor(sizes, seed = 1) {
    this.sizes = sizes;
    const rand = rng(seed);
    this.W = [];
    this.b = [];
    for (let l = 0; l + 1 < sizes.length; l++) {
      const nIn = sizes[l];
      const nOut = sizes[l + 1];
      const last = l + 2 === sizes.length;
      // no hidden layer: everything starts at 0 (all actions equally likely, as in AlphAI). Otherwise small random weights.
      const scale = sizes.length === 2 ? 0 : (last ? 0.3 : 1) * Math.sqrt(1 / Math.max(1, nIn));
      this.W.push(Array.from({ length: nOut }, () => Array.from({ length: nIn }, () => (rand() * 2 - 1) * scale)));
      this.b.push(new Array(nOut).fill(0));
    }
  }

  // All the layers' values for these inputs: [inputs, hidden..., probabilities]. Hidden neurons: tanh; outputs: softmax.
  forward(x) {
    const acts = [x];
    let a = x;
    for (let l = 0; l < this.W.length; l++) {
      const last = l === this.W.length - 1;
      const z = this.W[l].map((row, j) => {
        let s = this.b[l][j];
        for (let i = 0; i < row.length; i++) s += row[i] * a[i];
        return s;
      });
      a = last ? softmax(z) : z.map(Math.tanh);
      acts.push(a);
    }
    return acts;
  }

  predict(x) { return this.forward(x)[this.W.length]; }

  // One step of gradient descent on one example (cross-entropy). Returns the loss before the step.
  learn(x, target, rate) {
    const acts = this.forward(x);
    const L = this.W.length;
    const p = acts[L];
    let delta = p.map((v, j) => v - (j === target ? 1 : 0));
    const loss = -Math.log(Math.max(1e-9, p[target]));
    for (let l = L - 1; l >= 0; l--) {
      const a = acts[l];
      const W = this.W[l];
      let back = null;
      if (l > 0) {
        back = new Array(a.length).fill(0);
        for (let j = 0; j < W.length; j++) for (let i = 0; i < a.length; i++) back[i] += W[j][i] * delta[j];
        back = back.map((g, i) => g * (1 - a[i] * a[i]));          // tanh'
      }
      for (let j = 0; j < W.length; j++) {
        const d = delta[j] * rate;
        if (d === 0) continue;
        const row = W[j];
        for (let i = 0; i < a.length; i++) row[i] -= d * a[i];
        this.b[l][j] -= d;
      }
      delta = back;
    }
    return loss;
  }

  // The largest weight, to scale the drawing.
  maxWeight() {
    let m = 0;
    for (const W of this.W) for (const row of W) for (const w of row) m = Math.max(m, Math.abs(w));
    return m;
  }
}

export function softmax(z) {
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((x, y) => x + y, 0);
  return e.map((v) => v / s);
}

// ---- the brain: the network, the examples it learns from, its settings --------------------------------------------------
// An example keeps what the robot read (raw), so that it still counts when the sensors chosen change.
export class Brain {
  constructor({ sensors = DEFAULT_SENSOR_CONFIG, ai = DEFAULT_AI_CONFIG, actions = [1, 2, 0], examples = [], seed = 1 } = {}) {
    this.sensors = { ...DEFAULT_SENSOR_CONFIG, ...sensors };
    this.ai = { ...DEFAULT_AI_CONFIG, ...ai };
    this.actions = actions.slice();
    this.examples = examples.slice();
    this.seed = seed;
    this.version = 0;              // changes whenever the network or the examples change (for the page to redraw)
    this.rebuild();
  }

  get inputs() { return inputList(this.sensors); }

  // A new network, with the settings of now (the examples stay; it learns them again).
  rebuild() {
    this.seed = (this.seed * 1103515245 + 12345) >>> 0 || 1;
    this.net = new Network([this.inputs.length, ...this.ai.hidden, Math.max(1, this.actions.length)], this.seed);
    this.loss = null;
    this.version += 1;
  }

  configure({ sensors, ai, actions }) {
    let changed = false;
    if (sensors && JSON.stringify({ ...this.sensors, ...sensors }) !== JSON.stringify(this.sensors)) { this.sensors = { ...this.sensors, ...sensors }; changed = true; }
    if (ai) {
      const next = { ...this.ai, ...ai };
      if (JSON.stringify(next.hidden) !== JSON.stringify(this.ai.hidden)) changed = true;
      this.ai = next;
    }
    if (actions && actions.join() !== this.actions.join()) { this.actions = actions.slice(); changed = true; }
    if (changed) this.rebuild();
    else this.version += 1;
    return changed;
  }

  x(prox, ground) { return inputsFrom(this.sensors, prox, ground); }

  // The score of each action (in the order of this.actions), from 0 to 1, adding up to 1.
  probabilities(prox, ground) { return this.net.predict(this.x(prox, ground)); }

  // The action the network prefers (its number in src/ai/actions.js), or -1 when there is none.
  best(prox, ground) {
    if (!this.actions.length) return -1;
    const p = this.probabilities(prox, ground);
    let k = 0;
    for (let i = 1; i < p.length; i++) if (p[i] > p[k]) k = i;
    return this.actions[k];
  }

  // The examples that count now: those of an action that is selected.
  usable() { return this.examples.filter((e) => this.actions.includes(e.action)); }

  addExample(prox, ground, action) {
    this.examples.push({ prox: prox.slice(0, 7), ground: ground ? ground.slice(0, 2) : [-1, -1], action });
    this.version += 1;
    // a few steps at once, so that the new example shows at once
    this.train(60, this.examples.length - 1);
  }

  forgetLast() {
    if (!this.examples.length) return false;
    this.examples.pop();
    this.rebuild();
    this.train(2000);
    return true;
  }

  reset() {
    this.examples = [];
    this.rebuild();
  }

  // `steps` steps of learning on examples taken at random (or on example `focus` for the first half). Returns the mean loss.
  train(steps, focus = -1) {
    const data = this.usable();
    if (!data.length || !this.actions.length) return null;
    const rand = rng((this.seed + this.examples.length * 7919 + this.version) >>> 0);
    let total = 0;
    for (let s = 0; s < steps; s++) {
      const e = focus >= 0 && s < steps / 2 && this.actions.includes(this.examples[focus].action)
        ? this.examples[focus] : data[Math.floor(rand() * data.length)];
      total += this.net.learn(this.x(e.prox, e.ground), this.actions.indexOf(e.action), this.ai.learningRate);
    }
    this.loss = total / steps;
    this.version += 1;
    return this.loss;
  }

  // How many examples of each action (for the page).
  counts() {
    const c = {};
    for (const e of this.examples) c[e.action] = (c[e.action] || 0) + 1;
    return c;
  }

  toJSON() { return { sensors: this.sensors, ai: this.ai, actions: this.actions, examples: this.examples }; }
}

export const actionName = (id) => ACTIONS[id]?.name || '';

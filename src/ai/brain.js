// The learning of the AI Lab: what the robot senses becomes the inputs of a neural network (values from 0 to 1), and the network
// gives a score to each action. Two ways to learn:
//   supervised      from examples ("in this situation, do this"): the scores are probabilities (softmax);
//   reinforcement   from rewards (activity 2): the robot tries actions, gets a reward or a penalty after each one, and the
//                   network learns the value of each action in each situation (Q-learning); the robot does the action of
//                   highest value, and now and then another one (exploration).
// Pure JavaScript, no import of the page, so that Node can test it.

import { ACTIONS, K } from './actions.js';

// ---- the inputs ---------------------------------------------------------------------------------------------------
// AlphAI's Sensors tab. proximity: 'all' (the 7 sensors), 'front' (the 5 at the front) or 'off'; ground: 'off', 'binary'
// (black or not) or 'values'; proxBinary: each proximity sensor is 0 or 1 (something there or not).
export const DEFAULT_SENSOR_CONFIG = { proximity: 'all', proxBinary: false, ground: 'off' };
export const PROX_FULL = 4000;          // a reading of 4000 or more counts as 1 (an object touching the sensor)
export const GROUND_WHITE = 1000;       // a ground reading of 1000 or more counts as white (black detection 0)
const BINARY = 0.5;
// reinforcement learning
const WALL = 0.8;                       // a front sensor at 0.8 or more after going forwards: it went against a wall
const CLEAR = 0.2;                      // all front sensors under 0.2: nothing in front
export const GAMMA = 0.6;               // how much what comes next counts in the value of an action
export const EXPLORATION = 0.15;        // how often the robot tries another action than the best one (exploration on)
const MAX_TRANSITIONS = 3000;
const TARGET_EVERY = 400;

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
export const DEFAULT_AI_CONFIG = { kind: 'supervised', hidden: [], learningRate: 0.02, penalty: 1, exploration: true };
export const PENALTY_RANGE = { min: 0, max: 3, step: 0.1 };
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
  // sizes: [inputs, ...hidden, outputs]; output: 'softmax' (probabilities) or 'linear' (values, for reinforcement learning)
  constructor(sizes, seed = 1, output = 'softmax') {
    this.sizes = sizes;
    this.output = output;
    const rand = rng(seed);
    this.W = [];
    this.b = [];
    for (let l = 0; l + 1 < sizes.length; l++) {
      const nIn = sizes[l];
      const nOut = sizes[l + 1];
      const last = l + 2 === sizes.length;
      // supervised without hidden layer: everything starts at 0 (all actions equally likely). Otherwise small random weights
      // (for reinforcement learning, the first choices are then a matter of chance, as in activity 2).
      const scale = sizes.length === 2 ? (output === 'linear' ? 0.05 : 0) : (last ? 0.3 : 1) * Math.sqrt(1 / Math.max(1, nIn));
      this.W.push(Array.from({ length: nOut }, () => Array.from({ length: nIn }, () => (rand() * 2 - 1) * scale)));
      this.b.push(new Array(nOut).fill(0));
    }
  }

  // All the layers' values for these inputs: [inputs, hidden..., outputs]. Hidden neurons: tanh; outputs: softmax or linear.
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
      a = last ? (this.output === 'linear' ? z : softmax(z)) : z.map(Math.tanh);
      acts.push(a);
    }
    return acts;
  }

  predict(x) { return this.forward(x)[this.W.length]; }

  // One step of gradient descent on one example (cross-entropy). Returns the loss before the step.
  learn(x, target, rate) {
    const acts = this.forward(x);
    const p = acts[this.W.length];
    this.backprop(acts, p.map((v, j) => v - (j === target ? 1 : 0)), rate);
    return -Math.log(Math.max(1e-9, p[target]));
  }

  // One step towards `value` for output `k` only (squared error, linear outputs). Returns the error before the step.
  learnValue(x, k, value, rate) {
    const acts = this.forward(x);
    const q = acts[this.W.length];
    const err = Math.max(-2, Math.min(2, q[k] - value));          // clipped, so that one surprise does not throw everything off
    this.backprop(acts, q.map((_, j) => (j === k ? err : 0)), rate);
    return err * err;
  }

  backprop(acts, delta0, rate) {
    const L = this.W.length;
    let delta = delta0;
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
  }

  toJSON() {
    const r = (v) => Math.round(v * 1000) / 1000;
    return { sizes: this.sizes, output: this.output, W: this.W.map((m) => m.map((row) => row.map(r))), b: this.b.map((row) => row.map(r)) };
  }

  // The weights of a saved network, when it has the same shape.
  load(saved) {
    if (!saved || JSON.stringify(saved.sizes) !== JSON.stringify(this.sizes) || (saved.output || 'softmax') !== this.output) return false;
    this.W = saved.W.map((m) => m.map((row) => row.map(Number)));
    this.b = saved.b.map((row) => row.map(Number));
    return true;
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
  constructor({ sensors = DEFAULT_SENSOR_CONFIG, ai = DEFAULT_AI_CONFIG, actions = [1, 2, 0], examples = [], network = null, seed = 1 } = {}) {
    this.sensors = { ...DEFAULT_SENSOR_CONFIG, ...sensors };
    this.ai = { ...DEFAULT_AI_CONFIG, ...ai };
    this.actions = actions.slice();
    this.examples = examples.slice();
    this.transitions = [];         // reinforcement learning: what happened, { x, k, r, x2 } (inputs, action, reward, inputs after)
    this.seed = seed;
    this.version = 0;              // changes whenever the network or the examples change (for the page to redraw)
    this.rebuild();
    if (network && this.net.load(network)) this.syncTarget();
  }

  get reinforcement() { return this.ai.kind === 'reinforcement'; }

  get inputs() { return inputList(this.sensors); }

  // A new network, with the settings of now (the examples stay; it learns them again).
  rebuild() {
    this.seed = (this.seed * 1103515245 + 12345) >>> 0 || 1;
    this.net = new Network([this.inputs.length, ...this.ai.hidden, Math.max(1, this.actions.length)], this.seed, this.reinforcement ? 'linear' : 'softmax');
    this.transitions = [];
    this.syncTarget();
    this.loss = null;
    this.version += 1;
  }

  configure({ sensors, ai, actions }) {
    let changed = false;
    if (sensors && JSON.stringify({ ...this.sensors, ...sensors }) !== JSON.stringify(this.sensors)) { this.sensors = { ...this.sensors, ...sensors }; changed = true; }
    if (ai) {
      const next = { ...this.ai, ...ai };
      if (JSON.stringify(next.hidden) !== JSON.stringify(this.ai.hidden) || next.kind !== this.ai.kind) changed = true;
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

  // The action the network prefers (its number in src/ai/actions.js), or -1 when there is none. Equal scores: chance decides.
  best(prox, ground, rand = Math.random) {
    if (!this.actions.length) return -1;
    const p = this.probabilities(prox, ground);
    const top = Math.max(...p);
    const ties = p.map((v, i) => (v >= top - 1e-9 ? i : -1)).filter((i) => i >= 0);
    return this.actions[ties[Math.floor(rand() * ties.length) % ties.length]];
  }

  // ---- reinforcement learning ------------------------------------------------------------------------------------------
  // The reward of an action, from what the front sensors read once it is done (activity 2): going forwards with nothing close
  // in front is rewarded by how fast it goes forwards (100 straight, 55 for a turn forwards); going against a wall, or
  // backwards with nothing in front, is a penalty (-50 times the penalty setting); the rest is 0.
  reward(action, proxAfter) {
    const act = ACTIONS[action];
    if (!act) return 0;
    let front = 0;
    for (let i = 0; i < 5; i++) front = Math.max(front, proxValue(proxAfter[i]));
    const forward = act.kind === K.DRIVE ? (act.a + act.b) / 2 : 0;
    const penalty = -50 * this.ai.penalty;
    if (forward > 0) return front >= WALL ? penalty : Math.round(forward);
    if (forward < 0) return front < CLEAR ? penalty : 0;
    return 0;
  }

  // The values the network gives the actions now, in the units of the rewards (about what each action brings per step).
  values(prox, ground) { return this.net.predict(this.x(prox, ground)).map((q) => q * (1 - GAMMA) * 100); }

  // The action to do: the one of highest value, or (exploration on, now and then) another one. { action, explored }
  chooseRL(prox, ground, rand = Math.random) {
    if (!this.actions.length) return { action: -1, explored: false };
    if (this.ai.exploration && this.actions.length > 1 && rand() < EXPLORATION) {
      const best = this.best(prox, ground, rand);
      const others = this.actions.filter((a) => a !== best);
      return { action: others[Math.floor(rand() * others.length) % others.length], explored: true };
    }
    return { action: this.best(prox, ground, rand), explored: false };
  }

  // What happened after an action: the situation before, the action, the situation after. Returns the reward.
  experience(proxBefore, groundBefore, action, proxAfter, groundAfter) {
    const r = this.reward(action, proxAfter);
    const k = this.actions.indexOf(action);
    if (k < 0) return r;
    this.transitions.push({ x: this.x(proxBefore, groundBefore), k, r, x2: this.x(proxAfter, groundAfter) });
    if (this.transitions.length > MAX_TRANSITIONS) this.transitions.splice(0, this.transitions.length - MAX_TRANSITIONS);
    // learn a little at once from what just happened, then from all the past (train)
    for (let i = 0; i < 3; i++) this.learnTransition(this.transitions[this.transitions.length - 1]);
    this.version += 1;
    return r;
  }

  // The value of what comes next is read from a copy of the network that follows it slowly (every TARGET_EVERY steps): learning
  // from its own changing guesses would make the network chase its tail.
  learnTransition(t) {
    const next = this.target.predict(t.x2);
    const goal = t.r / 100 + GAMMA * Math.max(...next);
    this.steps = (this.steps || 0) + 1;
    if (this.steps % TARGET_EVERY === 0) this.syncTarget();
    return this.net.learnValue(t.x, t.k, goal, this.ai.learningRate);
  }

  syncTarget() {
    if (!this.target || JSON.stringify(this.target.sizes) !== JSON.stringify(this.net.sizes)) this.target = new Network(this.net.sizes, 1, this.net.output);
    this.target.load(this.net.toJSON());
  }

  // The examples that count now: those of an action that is selected (reinforcement learning: what happened).
  usable() { return this.reinforcement ? this.transitions : this.examples.filter((e) => this.actions.includes(e.action)); }

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
    if (!this.reinforcement) this.examples = [];
    this.rebuild();
  }

  // `steps` steps of learning on examples taken at random (or on example `focus` for the first half). Returns the mean loss.
  train(steps, focus = -1) {
    const data = this.usable();
    if (!data.length || !this.actions.length) return null;
    const rand = rng((this.seed + this.examples.length * 7919 + this.version) >>> 0);
    let total = 0;
    if (this.reinforcement) {
      for (let s = 0; s < steps; s++) total += this.learnTransition(data[Math.floor(rand() * data.length)]);
      this.loss = total / steps;
      this.version += 1;
      return this.loss;
    }
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

  toJSON() { return { sensors: this.sensors, ai: this.ai, actions: this.actions, examples: this.examples, network: this.net.toJSON() }; }
}

export const actionName = (id) => ACTIONS[id]?.name || '';

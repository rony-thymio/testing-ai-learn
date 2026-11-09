// What the interface knows about the robot, built from the events of a backend (robot or virtual): the latest readings,
// the weights, the settings, and the history that the charts draw. Plain JavaScript with no React: React reads it with
// useSyncExternalStore (see useTelemetry in App.jsx) and Node can test it.
import { DEFAULT_BASE, DEFAULT_FORGET, DEFAULT_STEP, emptyWeights } from './spec.js';
import { DEFAULT_ACTION_SETTINGS } from './ai/actions.js';

export const KEEP_READINGS = 9000;        // 15 minutes of readings (10 a second)
export const KEEP_WEIGHTS = 3000;
export const KEEP_EVENTS = 600;

const zeros = (n) => new Array(n).fill(0);
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

function fresh() {
  return {
    version: 0,
    link: { status: 'idle', device: '', firmware: null, error: '' },
    running: false,                       // the mode has said hello and not goodbye
    greeted: false,                       // the mode has said hello since this history began (it is starting until then)
    state: 'drive',
    learning: true,                       // the robot learns from its hits (false: frozen, and it stays so through a pause)
    prox: zeros(7),
    motors: [0, 0],
    learnt: 0,                            // lessons held, 0..16 (the Lego LEDs)
    weights: emptyWeights(),
    haveWeights: false,
    changed: {},                          // "wheel-sensor" -> t when that weight last changed
    params: { step: DEFAULT_STEP, baseLeft: DEFAULT_BASE, baseRight: DEFAULT_BASE, forget: DEFAULT_FORGET },
    t: 0,                                 // ms, the time of the last event (the robot's own clock: virtual or real)
    t0: 0,                                // ms, when this history began
    lastHit: null,                        // { t, sensors: [bool x 7] }
    lastLearn: 0,                         // t of the last lesson
    lastForget: 0,
    hits: 0,
    lessons: 0,
    live: { failures: 0, lastMs: 0, sending: 0, giveUp: false },
    battery: 0,
    error: '',
    hist: { n: [], w: [], events: [] },
    // the AI Lab program (src/py/ai_mode.py): what it is doing, its ground sensors, its settings, the last action
    ai: { phase: 'idle', action: -1, ground: [-1, -1], settings: { ...DEFAULT_ACTION_SETTINGS }, count: 0, lastGo: null, lastDone: null },
  };
}

export class Telemetry {
  constructor() {
    this.s = fresh();
    this.listeners = new Set();
    this.snap = { ...this.s };
    this.queued = false;
    this.subscribe = (fn) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
    this.getSnapshot = () => this.snap;
  }

  // Forget everything but the link (a new run).
  clear() {
    const link = this.s.link;
    const params = this.s.params;
    const settings = this.s.ai.settings;
    this.s = fresh();
    this.s.link = link;
    this.s.params = params;
    this.s.ai.settings = settings;
    this.publish();
  }

  // The link only: used when the source changes (virtual / robot).
  setLink(link) { this.s.link = { ...this.s.link, ...link }; this.publish(); }

  push(ev) {
    const s = this.s;
    if (ev.t != null && ev.t > 0) {
      if (!s.t0 || ev.t < s.t0) s.t0 = ev.t;
      s.t = ev.t;
    }
    switch (ev.type) {
      case 'conn':
        s.link = { ...s.link, status: ev.status, device: ev.device ?? s.link.device, firmware: ev.firmware ?? s.link.firmware, error: ev.error ?? (ev.status === 'connected' ? '' : s.link.error) };
        if (ev.status === 'disconnected' || ev.status === 'reconnect') s.running = false;
        break;
      case 'hello': s.running = true; s.greeted = true; s.live = { ...s.live, failures: 0, giveUp: false }; break;
      case 'battery': s.battery = ev.volts; break;
      case 'state': s.state = ev.state; break;
      case 'n':
        s.state = ev.state;
        s.learning = ev.learning ?? ev.state !== 'freeze';
        s.prox = ev.prox;
        s.motors = ev.motors;
        s.learnt = ev.learnt;
        s.hist.n.push({ t: ev.t ?? s.t, prox: ev.prox, motors: ev.motors });
        if (s.hist.n.length > KEEP_READINGS + 100) s.hist.n.splice(0, s.hist.n.length - KEEP_READINGS);
        break;
      case 'w': {
        const prev = s.hist.w[s.hist.w.length - 1];
        if (s.haveWeights) {
          const changed = { ...s.changed };
          ev.left.forEach((v, i) => { if (v !== s.weights.left[i]) changed[`0-${i}`] = ev.t ?? s.t; });
          ev.right.forEach((v, i) => { if (v !== s.weights.right[i]) changed[`1-${i}`] = ev.t ?? s.t; });
          s.changed = changed;
        }
        s.weights = { left: ev.left, right: ev.right };
        s.haveWeights = true;
        if (!prev || !same(prev.left, ev.left) || !same(prev.right, ev.right)) {
          s.hist.w.push({ t: ev.t ?? s.t, left: ev.left, right: ev.right });
          if (s.hist.w.length > KEEP_WEIGHTS + 100) s.hist.w.splice(0, s.hist.w.length - KEEP_WEIGHTS);
        }
        break;
      }
      case 'p': s.params = { step: ev.step, baseLeft: ev.baseLeft, baseRight: ev.baseRight, forget: ev.forget }; break;
      case 'hit':
        s.lastHit = { t: ev.t ?? s.t, sensors: ev.sensors };
        s.hits += 1;
        this.event({ t: ev.t ?? s.t, kind: 'hit', sensors: ev.sensors });
        break;
      case 'learn':
        s.lastLearn = ev.t ?? s.t;
        s.lessons += 1;
        s.learnt = ev.count;
        this.event({ t: ev.t ?? s.t, kind: 'learn' });
        break;
      case 'forget':
        s.lastForget = ev.t ?? s.t;
        s.learnt = ev.count;
        this.event({ t: ev.t ?? s.t, kind: 'forget' });
        break;
      case 'a':
        s.prox = ev.prox;
        s.motors = ev.motors;
        s.ai = { ...s.ai, phase: ev.phase, action: ev.action, ground: ev.ground };
        break;
      case 'go': s.ai = { ...s.ai, count: ev.count, action: ev.action, phase: 'act', lastGo: { t: ev.t ?? s.t, action: ev.action, count: ev.count } }; break;
      case 'done': s.ai = { ...s.ai, phase: s.ai.phase === 'act' || s.ai.phase === 'rest' ? 'idle' : s.ai.phase, lastDone: { t: ev.t ?? s.t, action: ev.action, count: ev.count } }; break;
      case 's': s.ai = { ...s.ai, settings: { duration: ev.duration, pause: ev.pause, maxSpeed: ev.maxSpeed, turnGain: ev.turnGain } }; break;
      case 'bye': case 'exit': case 'script-ended': s.running = false; break;
      case 'error': s.error = ev.message; break;
      case 'live-ok': s.live = { ...s.live, failures: 0, lastMs: ev.ms }; break;
      case 'live-failed': s.live = { ...s.live, failures: ev.failures }; break;
      case 'live-giveup': s.live = { ...s.live, giveUp: true }; break;
      default: break;
    }
    this.publish();
  }

  event(e) {
    const ev = this.s.hist.events;
    ev.push(e);
    if (ev.length > KEEP_EVENTS + 50) ev.splice(0, ev.length - KEEP_EVENTS);
  }

  // The interface is waiting for the robot to confirm something it sent (a counter, for a small indicator).
  sending(delta) { this.s.live = { ...this.s.live, sending: Math.max(0, this.s.live.sending + delta) }; this.publish(); }

  // One snapshot per animation frame at most: the robot may say 100 things a second (a fast virtual one). A timer backs the frame up:
  // a page in the background gets no frames, and the interface must not stay behind what the robot has said.
  publish() {
    if (this.queued) return;
    this.queued = true;
    let raf = 0;
    let timer = 0;
    const run = () => {
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      clearTimeout(timer);
      this.queued = false;
      this.s.version += 1;
      this.snap = { ...this.s };
      for (const fn of this.listeners) fn();
    };
    if (typeof requestAnimationFrame === 'function') {
      raf = requestAnimationFrame(run);
      timer = setTimeout(run, 120);
    } else {
      Promise.resolve().then(run);
    }
  }
}

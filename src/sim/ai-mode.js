// The JavaScript twin of the AI Lab program (src/py/ai_mode.py), for the virtual robot: the same ticks, the same lines,
// the same speeds (tests/ai.test.js replays what the Python program did, tick by tick). tick() takes what the sensors read
// and the frame the page wrote in the LEDs (or null), and returns what the program said and did.
import { FrameReceiver } from '../protocol.js';
import { ACTIONS, plan } from '../ai/actions.js';

export const TICK_MS = 20;
const REPORT_TICKS = 5;
const HEARTBEAT_TICKS = 150;
const SPEED_LIMIT = 500;
const MAXB = 16;
const KEY = { COMMAND: 19, ACTION: 20, DURATION: 21, PAUSE: 22, MAX_SPEED: 23, LIGHT: 24, TURN_GAIN: 25 };
const CMD_QUIT = 6;
const CMD_STOP = 8;
const P = { IDLE: 0, ACT: 1, REST: 2 };
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export class AiMode {
  constructor({ durationCs = 25, pauseCs = 10, maxSpeed = 150, turnGain = 100, hasGround = true } = {}) {
    this.durationMs = clamp(durationCs, 1, 500) * 10;
    this.pauseMs = clamp(pauseCs, 0, 500) * 10;
    this.maxSpeed = clamp(maxSpeed, 0, SPEED_LIMIT);
    this.turnGain = clamp(turnGain, 10, 400);
    this.hasGround = hasGround;
    this.phase = P.IDLE;
    this.action = -1;
    this.count = 0;
    this.timer = 0;
    this.length = 0;
    this.ml = 0;
    this.mr = 0;
    this.red = false;
    this.light = -1;
    this.p = new Array(7).fill(0);
    this.g = [-1, -1];
    this.ticks = 0;
    this.beat = 0;
    this.quit = false;
    this.rx = new FrameReceiver();
    this.centre = 0;
    this.lines = [];
    this.body = [0, 0, 0];
  }

  say(...parts) { this.lines.push(`@@${parts.join(' ')}`); }

  // ---- actions --------------------------------------------------------------------------------
  startAction(id) {
    if (id < 0 || id >= ACTIONS.length) return;
    this.count += 1;
    this.action = id;
    const p = plan(id, this.durationMs, this.maxSpeed, this.turnGain);
    this.ml = p.left;
    this.mr = p.right;
    this.length = p.ms;
    this.red = p.red;
    this.phase = P.ACT;
    this.timer = 0;
    this.say('go', this.count, id);
  }

  stopNow() {
    const was = this.phase;
    this.ml = 0;
    this.mr = 0;
    this.red = false;
    this.phase = P.IDLE;
    this.timer = 0;
    if (was !== P.IDLE) this.say('done', this.count, this.action);
  }

  runPhase() {
    if (this.phase === P.ACT) {
      if (this.timer >= this.length) {
        this.ml = 0;
        this.mr = 0;
        this.red = false;
        this.phase = P.REST;
        this.timer = 0;
      } else {
        this.timer += TICK_MS;
      }
    }
    if (this.phase === P.REST) {
      if (this.timer >= this.pauseMs) {
        this.phase = P.IDLE;
        this.timer = 0;
        this.say('done', this.count, this.action);
      } else {
        this.timer += TICK_MS;
      }
    }
  }

  // ---- reports --------------------------------------------------------------------------------
  reportSettings() {
    this.say('s', Math.trunc(this.durationMs / 10), Math.trunc(this.pauseMs / 10), this.maxSpeed, this.turnGain);
    this.beat = 0;
  }

  report() { this.say('a', this.phase, this.action, ...this.p, ...this.g, this.ml, this.mr); }

  // ---- the page's messages ----------------------------------------------------------------------
  item(key, v) {
    if (key === KEY.ACTION) this.startAction(v);
    else if (key === KEY.DURATION) this.durationMs = clamp(v, 1, 500) * 10;
    else if (key === KEY.PAUSE) this.pauseMs = clamp(v, 0, 500) * 10;
    else if (key === KEY.MAX_SPEED) this.maxSpeed = clamp(v, 0, SPEED_LIMIT);
    else if (key === KEY.TURN_GAIN) this.turnGain = clamp(v, 10, 400);
    else if (key === KEY.LIGHT) this.light = v >= 0 ? v : -1;
    else if (key === KEY.COMMAND) {
      if (v === CMD_STOP) this.stopNow();
      else if (v === CMD_QUIT) { this.say('exit'); this.quit = true; }
    }
  }

  rxPoll(frame) {
    if (!frame) return;
    const got = this.rx.push(frame);
    if (!got) return;
    const before = [this.durationMs, this.pauseMs, this.maxSpeed, this.turnGain].join();
    for (const [key, v] of got.items) this.item(key, v);
    this.say('ack', got.msg);
    if (before !== [this.durationMs, this.pauseMs, this.maxSpeed, this.turnGain].join()) this.reportSettings();
  }

  // ---- one tick ---------------------------------------------------------------------------------
  setBody() {
    if (this.red) this.body = [MAXB, 0, 0];
    else if (this.light >= 0) this.body = [(this.light >> 8) & 15, (this.light >> 4) & 15, this.light & 15];
    else if (this.phase === P.ACT) this.body = [8, 8, 8];
    else this.body = [2, 2, 6];
  }

  start() {
    this.lines = [];
    this.setBody();
    this.say('hello', 2);
    this.say('bat', 4012);
    this.reportSettings();
    return { lines: this.lines, body: this.body };
  }

  // prox: the 7 readings; ground: the 2 ground readings; buttons: [BACKWARD, LEFT, CENTER, FORWARD, RIGHT]; frame: 12 nibbles or null
  tick({ prox, ground = [900, 900], buttons = [0, 0, 0, 0, 0], frame = null }) {
    this.lines = [];
    const c = buttons[2] ? 1 : 0;
    if (c && !this.centre) {
      this.say('exit');
      this.quit = true;
      return this.out();
    }
    this.centre = c;
    this.rxPoll(frame);
    if (this.quit) return this.out();
    for (let i = 0; i < 7; i++) this.p[i] = prox[i];
    if (this.hasGround) this.g = [ground[0], ground[1]];
    this.runPhase();
    this.ticks += 1;
    if (this.ticks % REPORT_TICKS === 0) this.report();
    this.beat += 1;
    if (this.beat >= HEARTBEAT_TICKS) this.reportSettings();
    this.setBody();
    return this.out();
  }

  out() { return { lines: this.lines, speed: [this.ml, this.mr], sounds: [], body: this.body }; }
}

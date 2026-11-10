import { VirtualRobot } from './virtual-robot.js';
import { parseRobotLine, encodeMessage, itemsFor, aiItemsFor } from '../protocol.js';
import { DEFAULT_ACTION_SETTINGS } from '../ai/actions.js';
import { TICK_MS } from './ann-mode.js';
import { DEFAULT_BASE, DEFAULT_STEP, DEFAULT_FORGET } from '../spec.js';

// The virtual robot as the interface sees it: the same events as the real one (see robot/robot-backend-core.js), the same
// messages to change the weights and the settings. The interface calls advance() with the real time that has passed;
// `speed` of the simulation says how much robot time a real second is worth.
export class SimBackend {
  constructor(emit, { robot = new VirtualRobot(), speed = 1 } = {}) {
    this.emit = emit;
    this.robot = robot;
    this.speed = speed;
    this.acc = 0;
    this.msg = 0;
    this.kind = 'virtual';
    this.program = 'ann';            // 'ann': the learning mode of the firmware, 'ai': the AI Lab program
  }

  setProgram(program) { this.program = program; }

  get connected() { return this.robot.running; }

  // The program starts with these weights and settings (defaults: the firmware's), or with these settings of the actions.
  start(init = {}) {
    if (this.program === 'ai') {
      const a = { ...DEFAULT_ACTION_SETTINGS, ...init };
      this.emitLines(this.robot.start({ program: 'ai', durationCs: Math.round(a.duration * 100), pauseCs: Math.round(a.pause * 100), maxSpeed: Math.round(a.maxSpeed), turnGain: Math.round(a.turnGain) }).lines);
      return;
    }
    const out = this.robot.start({
      step10: Math.round((init.step ?? DEFAULT_STEP) * 10),
      base10: Math.round((init.baseLeft ?? DEFAULT_BASE) * 10),
      base10r: Math.round((init.baseRight ?? init.baseLeft ?? DEFAULT_BASE) * 10),
      forgetS: init.forget ?? DEFAULT_FORGET,
      weights: init.weights ? [...init.weights.left, ...init.weights.right].map((w) => Math.round(w * 10)) : '',
    });
    this.emitLines(out.lines);
  }

  stop() {
    if (!this.robot.running) return;
    this.robot.stop();
    this.emit({ type: 'bye', t: this.robot.clock });
  }

  emitLines(lines) {
    for (const line of lines) {
      const ev = parseRobotLine(line);
      if (ev) this.emit({ ...ev, t: this.robot.clock });
    }
  }

  // The messages to the mode go through the frames, as with the real robot (one frame at each tick).
  apply(change) {
    if (this.program === 'ai' && change.action != null && change.seq == null) { this.aiSeq = ((this.aiSeq || 0) % 63) + 1; change = { ...change, seq: this.aiSeq }; }
    for (const items of (this.program === 'ai' ? aiItemsFor : itemsFor)(change)) {
      this.msg = (this.msg % 15) + 1;
      this.robot.pushFrames(encodeMessage(items, this.msg));
    }
    return Promise.resolve();
  }

  advance(realMs) {
    if (!this.robot.running) return;
    this.acc = Math.min(this.acc + realMs * this.speed, 1000);
    while (this.acc >= TICK_MS && this.robot.running) {
      this.acc -= TICK_MS;
      const out = this.robot.tick();
      if (out) this.emitLines(out.lines);
      if (this.robot.mode?.quit) { this.stop(); break; }
    }
  }
}

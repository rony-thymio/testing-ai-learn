// The virtual Thymio: the arena (sim/arena.js) with the JavaScript twin of a program in it: the learning mode of the firmware
// (sim/ann-mode.js) or the AI Lab program (sim/ai-mode.js). One tick() is 20 ms of the robot's life: the wheels move the
// body, the sensors read the world, the program decides.
import { Arena } from './arena.js';
import { AnnMode, TICK_MS } from './ann-mode.js';
import { AiMode } from './ai-mode.js';

export class VirtualRobot {
  constructor(options = {}) {
    this.arena = options.arena || new Arena(options);
    this.mode = null;
    this.queue = [];                  // frames that the interface wrote, one is read at each tick
    this.buttons = [0, 0, 0, 0, 0];
    this.speed = [0, 0];              // what the wheels are told
    this.prox = new Array(7).fill(0);
    this.ground = [900, 900];
    this.clock = 0;                   // ms of virtual time
    this.body = [0, 0, 0];
  }

  // Start a program: returns what it says at once. `init`: { step10, base10, base10r, forgetS, weights } as for AnnMode, or
  // { program: 'ai', durationCs, pauseCs, maxSpeed, turnGain } for the AI Lab program.
  start(init = {}) {
    this.mode = init.program === 'ai' ? new AiMode(init) : new AnnMode(init);
    this.speed = [0, 0];
    this.queue = [];
    const out = this.mode.start();
    this.body = out.body;
    return out;
  }

  stop() {
    this.mode = null;
    this.speed = [0, 0];
    this.queue = [];
  }

  get running() { return !!this.mode; }

  pushFrames(frames) { this.queue.push(...frames); }

  // The Bluetooth command of the interface also sets the wheels, to the speeds in it; the mode sets them again at its next tick.
  poke(left, right) { this.speed = [left, right]; }

  tick() {
    this.arena.step(this.speed[0], this.speed[1], TICK_MS);
    this.prox = this.arena.sense();
    this.ground = this.arena.senseGround();
    this.clock += TICK_MS;
    if (!this.mode) return null;
    const frame = this.queue.length ? this.queue.shift() : null;
    const out = this.mode.tick({ prox: this.prox, ground: this.ground, buttons: this.buttons, frame });
    this.speed = out.speed;
    this.body = out.body;
    return out;
  }
}

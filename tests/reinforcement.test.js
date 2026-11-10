// Reinforcement learning on the virtual robot, as in activity 2: in an arena with walls, the robot tries actions, gets rewards
// and penalties, and its level (the mean of the rewards) goes up as it learns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SimBackend } from '../src/sim/sim-backend.js';
import { Telemetry } from '../src/store.js';
import { Brain } from '../src/ai/brain.js';

function rnd(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

test('in the arena of activity 2, the level goes up', () => {
  const b = new Brain({ actions: [1, 5, 6, 9, 10], sensors: { proximity: 'front' }, ai: { kind: 'reinforcement', hidden: [10, 20] }, seed: 21 });
  const rand = rnd(3);
  const tele = new Telemetry();
  const sim = new SimBackend((ev) => tele.push(ev));
  sim.robot.arena.obstacles = [];
  sim.setProgram('ai');
  sim.start({ duration: 0.25, pause: 0.1, maxSpeed: 150 });
  let waiting = null;
  let prev = null;
  const rewards = [];
  for (let t = 0; t < 6 * 60000; t += 20) {
    sim.advance(20);
    if (t % 60 === 0) b.train(20);                         // the page learns in the background the same way
    const s = tele.s;
    if (!s.running) continue;
    if (waiting !== null && (s.ai.lastDone?.count ?? 0) > waiting) waiting = null;
    if (waiting !== null || s.ai.phase !== 'idle') continue;
    if (prev) rewards.push([t, b.experience(prev.prox, prev.ground, prev.action, s.prox, s.ai.ground)]);
    const { action } = b.chooseRL(s.prox, s.ai.ground, rand);
    prev = { prox: s.prox.slice(), ground: s.ai.ground.slice(), action };
    waiting = s.ai.lastDone?.count ?? 0;
    sim.apply({ action });
  }
  const level = (from, to) => {
    const r = rewards.filter(([t]) => t >= from * 60000 && t < to * 60000).map(([, v]) => v);
    return r.reduce((x, y) => x + y, 0) / r.length;
  };
  const start = level(0, 1);
  const end = level(4, 6);
  console.log(`    level: first minute ${start.toFixed(1)}, minutes 4 to 6 ${end.toFixed(1)}`);
  assert.ok(end > 50, `level at the end ${end.toFixed(1)}`);
  assert.ok(end > start + 10, `from ${start.toFixed(1)} to ${end.toFixed(1)}`);
});

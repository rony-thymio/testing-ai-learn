// The whole chain of the AI Lab, without a robot: the virtual robot runs the AI Lab program (src/sim/ai-mode.js) in its arena,
// the telemetry (src/store.js) follows it, and a network taught a few examples (src/ai/brain.js) drives it, the way
// src/ai/useAiLab.js does in the page: when an action is done, the next one, chosen from the sensors read then.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SimBackend } from '../src/sim/sim-backend.js';
import { Telemetry } from '../src/store.js';
import { Brain } from '../src/ai/brain.js';

const near = (i, v = 3200) => { const p = [0, 0, 0, 0, 0, 0, 0]; if (i >= 0) for (const k of [].concat(i)) p[k] = v; return p; };

function drive(brain, seconds, settings = {}, { walls = false } = {}) {
  const tele = new Telemetry();
  const sim = new SimBackend((ev) => tele.push(ev));
  if (walls) sim.robot.arena.obstacles = [];                // only the walls of the arena
  sim.setProgram('ai');
  sim.start({ duration: 0.25, pause: 0.1, maxSpeed: 150, ...settings });
  let waiting = null;
  const done = [];
  const bumpedBefore = sim.robot.arena.bumped;
  let travelled = 0;
  let pose = { ...sim.robot.arena.pose };
  for (let t = 0; t < seconds * 1000; t += 20) {
    sim.advance(20);
    const p = sim.robot.arena.pose;
    travelled += Math.hypot(p.x - pose.x, p.y - pose.y);
    pose = { ...p };
    const s = tele.s;                                   // the latest state (the page reads it the same way)
    if (!s.running) continue;
    if (waiting !== null && (s.ai.lastDone?.count ?? 0) > waiting) waiting = null;
    if (waiting !== null || s.ai.phase !== 'idle') continue;
    const next = brain.best(s.prox, s.ai.ground);
    waiting = (s.ai.lastDone?.count ?? 0);
    done.push(next);
    sim.apply({ action: next });
  }
  return { actions: done, bumped: sim.robot.arena.bumped - bumpedBefore, travelled, sim, tele };
}

test('taught to avoid obstacles, the virtual robot drives itself around its arena without touching anything', () => {
  const b = new Brain({ actions: [1, 15, 16] });           // forward, turn 60° left, turn 60° right
  b.addExample(near(-1), null, 1);
  b.addExample(near([5, 6], 1500), null, 1);              // something behind: forward anyway
  for (const i of [0, 1, 2, 3, 4]) b.addExample(near(i, 400), null, 1);   // something far away: forward still
  for (const s of [[0, 3000], [1, 3000], [0, 1500], [1, 1500], [2, 3000], [[1, 2], 2500]]) b.addExample(near(s[0], s[1]), null, 16);
  for (const s of [[4, 3000], [3, 3000], [4, 1500], [3, 1500], [[2, 3], 2500]]) b.addExample(near(s[0], s[1]), null, 15);
  b.train(8000);
  // In the arena with only its walls (between two obstacles close together it may get stuck turning left and right, not knowing
  // which way it has just turned: activity 4 is about that).
  const run = drive(b, 120, { duration: 0.15, pause: 0, maxSpeed: 200 }, { walls: true });         // the settings of activities 3 and 5
  const counts = {};
  for (const a of run.actions) counts[a] = (counts[a] || 0) + 1;
  // it keeps going, forward and turning when it must, and hardly touches the walls
  const info = `${run.actions.length} actions ${JSON.stringify(counts)}, ${Math.round(run.travelled)} mm, ${run.bumped} ticks touching`;
  assert.ok(run.actions.length > 150, info);
  assert.ok(counts[1] > 100 && (counts[15] || 0) + (counts[16] || 0) > 5, info);
  assert.ok(run.travelled > 3000, info);
  assert.equal(run.bumped, 0, info);
  console.log(`    ${info}`);
});

test('an untaught robot (stop only) does not move, and "done" brings the sensors to the telemetry', () => {
  const b = new Brain({ actions: [0] });
  const run = drive(b, 3);
  assert.ok(run.actions.every((a) => a === 0));
  const s = run.tele.s;
  assert.equal(s.prox.length, 7);
  assert.ok(s.ai.lastDone.count > 3);
  assert.equal(s.ai.ground.length, 2);
});

// The AI Lab: the JavaScript twin of the robot's program (src/sim/ai-mode.js) against the Python program (src/py/ai_mode.py),
// the table of actions on both sides, and the words between the page and the program (src/protocol.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AiMode } from '../src/sim/ai-mode.js';
import { ACTIONS, ACTION_GROUPS, K, plan } from '../src/ai/actions.js';
import { aiItemsFor, AI_KEY, AI_CMD, encodeMessage, FrameReceiver, parseRobotLine, lightValue } from '../src/protocol.js';

const golden = JSON.parse(readFileSync(new URL('./golden-ai.json', import.meta.url), 'utf8'));
const python = readFileSync(new URL('../src/py/ai_mode.py', import.meta.url), 'utf8');

for (const sc of golden.scenarios) {
  test(`the JavaScript program does what the Python program did (scenario ${sc.seed})`, () => {
    const mode = new AiMode();
    const frames = new Map(sc.frames);
    const lines = [];
    const speeds = [];
    for (const l of mode.start().lines) lines.push([0, l]);
    for (let t = 0; t < sc.ticks; t++) {
      const out = mode.tick({ prox: sc.prox[t], ground: sc.ground[t], frame: frames.get(t) || null });
      for (const l of out.lines) lines.push([t, l]);
      if (mode.quit) break;
      speeds.push([t, out.speed[0], out.speed[1]]);
    }
    assert.equal(lines.length, sc.lines.length, 'same number of lines');
    for (let i = 0; i < sc.lines.length; i++) assert.deepEqual(lines[i], sc.lines[i], `line ${i}`);
    assert.deepEqual(speeds, sc.speeds);
  });
}

test('the actions are the same in the Python program and in the page', () => {
  const kinds = { K_DRIVE: K.DRIVE, K_TURN: K.TURN, K_STOP: K.STOP, K_LIGHT: K.LIGHT };
  const block = python.slice(python.indexOf('ACTIONS = ['), python.indexOf(']', python.indexOf('ACTIONS = [')));
  const rows = [...block.matchAll(/\((K_\w+),\s*(-?\d+),\s*(-?\d+)\)/g)].map((m) => ({ kind: kinds[m[1]], a: Number(m[2]), b: Number(m[3]) }));
  assert.equal(rows.length, ACTIONS.length);
  ACTIONS.forEach((act, i) => {
    assert.equal(act.id, i);
    assert.deepEqual({ kind: act.kind, a: act.a, b: act.b }, rows[i], `action ${i} (${act.name})`);
  });
});

test('every action is on exactly one button of the Actions settings', () => {
  const seen = ACTION_GROUPS.flatMap((g) => g.actions).sort((a, b) => a - b);
  assert.deepEqual(seen, ACTIONS.map((a) => a.id));
});

test('what an action does', () => {
  assert.deepEqual(plan(1, 250, 150, 100), { left: 150, right: 150, ms: 250, red: false });
  assert.deepEqual(plan(7, 250, 155, 100), { left: -93, right: -155, ms: 250, red: false });
  assert.deepEqual(plan(9, 250, 155, 100), { left: -16, right: -155, ms: 250, red: false }, 'rounded down, like Python');
  const left = plan(17, 250, 150, 100);
  const right = plan(18, 250, 150, 100);
  assert.deepEqual([left.left, left.right, right.left, right.right], [-150, 150, 150, -150]);
  assert.ok(left.ms > 1700 && left.ms < 1800, `90 degrees in ${left.ms} ms`);
  assert.ok(Math.abs(plan(23, 250, 150, 100).ms - 2 * left.ms) <= 1, 'half a turn takes twice as long as a quarter');
  assert.ok(Math.abs(plan(17, 250, 150, 50).ms - left.ms / 2) <= 1, 'the gain scales the time');
  assert.ok(Math.abs(plan(17, 250, 300, 100).ms - left.ms / 2) <= 1, 'twice the speed, half the time');
  assert.deepEqual(plan(24, 300, 150, 100), { left: 0, right: 0, ms: 300, red: true });
  assert.deepEqual(plan(0, 300, 150, 100), { left: 0, right: 0, ms: 300, red: false });
});

test('the messages to the program: settings first, the action last, in the units of the program', () => {
  const [items] = aiItemsFor({ action: 5, duration: 0.25, pause: 0.1, maxSpeed: 150, turnGain: 120, light: [0, 15, 0] });
  assert.deepEqual(items, [[AI_KEY.DURATION, 25], [AI_KEY.PAUSE, 10], [AI_KEY.MAX_SPEED, 150], [AI_KEY.TURN_GAIN, 120], [AI_KEY.LIGHT, 0x0f0], [AI_KEY.ACTION, 5]]);
  assert.deepEqual(aiItemsFor({ light: null }), [[[AI_KEY.LIGHT, -1]]]);
  assert.deepEqual(aiItemsFor({ command: AI_CMD.STOP }), [[[AI_KEY.COMMAND, AI_CMD.STOP]]]);
  assert.deepEqual(aiItemsFor({}), []);
  assert.equal(lightValue([16, 3, -2]), 0xf30);
  // they go through the frames whole, negative values too
  const rx = new FrameReceiver();
  let got = null;
  for (const f of encodeMessage(items, 9)) got = rx.push(f) || got;
  assert.deepEqual(got, { msg: 9, items });
  got = null;
  for (const f of encodeMessage([[AI_KEY.LIGHT, -1]], 3)) got = rx.push(f) || got;
  assert.deepEqual(got.items, [[AI_KEY.LIGHT, -1]]);
});

test('the lines of the program', () => {
  assert.deepEqual(parseRobotLine('@@a 1 5 0 100 2000 300 0 0 4000 850 -1 15 150'), {
    type: 'a', phase: 'act', action: 5, prox: [0, 100, 2000, 300, 0, 0, 4000], ground: [850, -1], motors: [15, 150],
  });
  assert.deepEqual(parseRobotLine('@@go 3 17'), { type: 'go', count: 3, action: 17 });
  assert.deepEqual(parseRobotLine('@@done 3 17'), { type: 'done', count: 3, action: 17 });
  assert.deepEqual(parseRobotLine('@@s 25 10 150 100'), { type: 's', duration: 0.25, pause: 0.1, maxSpeed: 150, turnGain: 100 });
  assert.equal(parseRobotLine('@@a 1 2 3'), null);
  assert.equal(parseRobotLine('@@hello 2').version, 2);
});

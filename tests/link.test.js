// The link to a real robot, without Bluetooth: RobotBackendCore talks to the demonstration robot (src/dev/fake-thymio.js), which runs
// the JavaScript twin of the mode in the virtual arena. What the "robot" prints goes back through the stdout notifications.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// the browser the fake robot expects
globalThis.document = new EventTarget();
globalThis.window = globalThis;
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };

const fake = await import('../src/dev/fake-thymio.js');
const { RobotBackendCore, runArgs, mergeChange } = await import('../src/robot/robot-backend-core.js');
const { buildModuleFrom, moduleNameFor } = await import('../src/script-core.js');
const { Telemetry } = await import('../src/store.js');
const { CMD } = await import('../src/protocol.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(here, '..', 'src', 'py', 'ann_mode.py'), 'utf8');
const MODULE_TEXT = buildModuleFrom(SOURCE);
const MODULE = { name: moduleNameFor(MODULE_TEXT), text: MODULE_TEXT };
const AI_TEXT = buildModuleFrom(fs.readFileSync(path.join(here, '..', 'src', 'py', 'ai_mode.py'), 'utf8'));
const AI_MODULE = { name: moduleNameFor(AI_TEXT, 'aim_'), text: AI_TEXT };
const EV = { connected: 'thymio-connected', manualReconnect: 'thymio-prompt-manual-reconnection', stdout: 'thymio-std-out-values', pyStatus: 'thymio-python-execution-status', pyLoad: 'thymio-python-load-result' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, ms = 8000) => {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await wait(5); }
};

window.fakeRobot.flags.byteMs = 0.01;       // a module of 9 KB in a tenth of a second
window.fakeRobot.flags.slow = 8;            // the robot's clock goes 8 times faster

function link(options = {}, tele = null) {
  const events = [];
  const log = [];
  const core = new RobotBackendCore((e) => { events.push(e); tele?.push(e); }, {
    thymio: fake, events: EV, module: MODULE, aiModule: AI_MODULE, doc: document, win: new EventTarget(), onLog: (kind, text) => log.push([kind, text]),
    liveAckMs: 500, helloTimeoutMs: 3000, moduleHelloTimeoutMs: 3000, haltTimeoutMs: 1500, unknownHaltMs: 300, ...options,
  });
  core.attach();
  return { core, events, log, last: (type) => events.filter((e) => e.type === type).at(-1) };
}

async function connected(options, tele) {
  const l = link(options, tele);
  await l.core.connect();
  await until(() => l.events.some((e) => e.type === 'conn' && e.status === 'connected'));
  return l;
}

test('connect, install the module once, start the mode: the robot says hello and its weights', async () => {
  const l = await connected();
  await l.core.start({});
  assert.ok(l.events.some((e) => e.type === 'hello'));
  await until(() => l.last('w') && l.last('p') && l.last('n'));
  assert.deepEqual(l.last('w').left, [0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(l.last('p'), { type: 'p', step: 3, baseLeft: 67, baseRight: 67, forget: 16, t: l.last('p').t });
  assert.equal(l.last('n').state, 'drive');
  assert.ok(fake.listFiles && window.fakeRobot.files.includes(`${MODULE.name}.py`), 'the module is on the robot');
  assert.ok(l.log.some(([, t]) => /launcher/.test(t)), 'started by the two-line launcher');
  await l.core.stop();
  l.core.detach();
});

test('a weight and a setting are changed in the running mode and acknowledged', async () => {
  const l = await connected();
  await l.core.start({});
  await until(() => l.last('w'));
  await l.core.apply({ left: { 0: 4.5 }, right: { 4: -2 }, step: 5, baseLeft: 90, baseRight: 70 });
  await until(() => l.last('w').left[0] === 4.5);
  assert.equal(l.last('w').right[4], -2);
  await until(() => l.last('p').step === 5);
  assert.equal(l.last('p').baseLeft, 90);
  assert.equal(l.last('p').baseRight, 70, 'each wheel has its own base speed');
  assert.ok(l.last('live-ok'), 'acknowledged');
  assert.ok(l.events.some((e) => e.type === 'ack'));
  // the wheels follow the new speed (the demonstration robot gives them 0 at the command, and the mode gives them again)
  await until(() => l.last('n').motors[0] === 90 || l.last('n').motors[0] > 0);
  await l.core.stop();
  l.core.detach();
});

test('changes that come quickly are merged; a command keeps its place after the weights', () => {
  const list = [];
  mergeChange(list, { left: { 0: 1 } });
  mergeChange(list, { left: { 1: 2 }, right: { 0: 3 } });
  mergeChange(list, { left: { 0: 5 } });
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].left, { 0: 5, 1: 2 });
  mergeChange(list, { command: CMD.RESET });
  mergeChange(list, { left: { 2: 7 } });
  assert.equal(list.length, 2);
  assert.equal(list[0].command, CMD.RESET);
  assert.deepEqual(list[1].left, { 2: 7 });
});

test('a dragged slider sends few messages, the last value wins', async () => {
  const l = await connected();
  await l.core.start({});
  await until(() => l.last('w'));
  const before = l.log.filter(([, t]) => /live update: \d+ item/.test(t)).length;
  for (let v = 0; v <= 20; v += 0.5) l.core.apply({ left: { 2: v } });
  await until(() => l.last('w').left[2] === 20);
  const sent = l.log.filter(([, t]) => /live update: \d+ item/.test(t)).length - before;
  assert.ok(sent <= 3, `${sent} messages for 41 values`);
  await l.core.stop();
  l.core.detach();
});

test('commands: pause, resume, freeze, reset', async () => {
  const l = await connected();
  await l.core.start({ weights: { left: [3, 0, 0, 0, 0, 0, 0], right: [0, 0, 0, 0, 0, 0, 0] } });
  await until(() => l.last('w') && l.last('w').left[0] === 3);
  await l.core.apply({ command: CMD.PAUSE });
  await until(() => l.last('n') && l.last('n').state === 'pause');
  assert.deepEqual(l.last('n').motors, [0, 0]);
  await l.core.apply({ command: CMD.RESUME });
  await until(() => l.last('n').state === 'drive');
  await l.core.apply({ command: CMD.FREEZE });
  await until(() => l.last('n').state === 'freeze');
  await l.core.apply({ command: CMD.LEARN });
  await until(() => l.last('n').state === 'drive');
  await l.core.apply({ command: CMD.RESET });
  await until(() => l.last('w').left[0] === 0);
  await l.core.stop();
  l.core.detach();
});

test('frames that are lost: the mode is started again with the change, and nothing learnt is lost', async () => {
  const l = await connected({ liveAckMs: 250 });
  await l.core.start({ weights: { left: [6, 0, 0, 0, 0, 0, 0], right: [-6, 0, 0, 0, 0, 0, 0] } });
  await until(() => l.last('w') && l.last('w').left[0] === 6);
  window.fakeRobot.flags.live = 'drop';
  const restarted = new Promise((resolve) => setTimeout(() => { window.fakeRobot.flags.live = 'ok'; resolve(); }, 1300));
  const sent = l.core.apply({ left: { 1: 9 } });
  await restarted;
  await sent;
  await until(() => l.events.some((e) => e.type === 'live-failed'));
  await until(() => l.last('w') && l.last('w').left[1] === 9 && l.last('w').left[0] === 6, 12000);
  assert.deepEqual(l.last('w').right.slice(0, 2), [-6, 0], 'the other weights are as they were');
  await l.core.stop();
  l.core.detach();
});

test('the store follows the events, and keeps a history', async () => {
  const tele = new Telemetry();
  const l = await connected({}, tele);
  await l.core.start({});
  window.fakeRobot.robot.arena.pose = { x: 600, y: 230, h: 0 };          // against the right wall
  await until(() => l.last('hit'), 20000);
  await until(() => tele.s.hist.w.length >= 2, 20000);
  assert.ok(tele.s.hits >= 1);
  assert.ok(tele.s.hist.n.length > 5);
  assert.ok(tele.s.hist.events.some((e) => e.kind === 'hit'));
  await l.core.stop();
  l.core.detach();
});

test('runArgs: the arguments of the launcher', () => {
  assert.equal(runArgs({}), '30, 670, 16, "", 670');
  assert.equal(runArgs({ step: 5, baseLeft: 90, baseRight: 70, forget: 0, weights: { left: [1, 0, 0, 0, 0, 0, -2.5], right: [0, 0, 0, 0, 0, 0, 0] } }), '50, 900, 0, "10,0,0,0,0,0,-25,0,0,0,0,0,0,0", 700');
});

test('the AI Lab program: installed when it is first started, it carries out actions and says when they are done', async () => {
  const l = await connected();
  l.core.setProgram('ai');
  await l.core.start({ duration: 0.2, pause: 0.05, maxSpeed: 120 });
  assert.ok(window.fakeRobot.files.includes(`${AI_MODULE.name}.py`), 'the module is on the robot');
  await until(() => l.last('s') && l.last('a'));
  assert.deepEqual(l.last('s'), { type: 's', duration: 0.2, pause: 0.05, maxSpeed: 120, turnGain: 100, t: l.last('s').t });
  assert.equal(l.last('a').phase, 'idle');
  const ms = await l.core.act(1);
  assert.ok(ms > 0);
  await until(() => l.last('done'));
  assert.deepEqual([l.last('go').action, l.last('done').action], [1, 1]);
  // settings with an action: the action is carried out with them
  await l.core.act(2, { maxSpeed: 200 });
  await until(() => l.last('s').maxSpeed === 200 && l.last('done').action === 2);
  // the learning mode again, on the same link
  l.core.setProgram('ann');
  await l.core.start({});
  await until(() => l.last('w') && l.last('n'));
  assert.ok(window.fakeRobot.files.includes(`${MODULE.name}.py`) && window.fakeRobot.files.includes(`${AI_MODULE.name}.py`), 'both modules stay');
  await l.core.disconnect();
  l.core.detach();
});

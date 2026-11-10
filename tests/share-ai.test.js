// Sharing a trained AI (src/ai/share-ai.js): another device gets the same AI, in a link, a QR code or a file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Brain } from '../src/ai/brain.js';
import { encodeSetup, decodeSetup, packSetup, isAiCode, linkFor, QR_LIMIT } from '../src/ai/share-ai.js';
import { PRESETS } from '../src/ai/presets.js';
import { ACTIONS } from '../src/ai/actions.js';

const near = (i, v = 3200) => { const p = [0, 0, 0, 0, 0, 0, 0]; if (i >= 0) p[i] = v; return p; };
const setupOf = (b, actionSettings = { duration: 0.15, pause: 0.1, maxSpeed: 200, turnGain: 100 }) => ({ ...b.toJSON(), actionSettings });

function trained(n = 30, hidden = [10, 20]) {
  const b = new Brain({ actions: [1, 15, 16], ai: { hidden } });
  for (let k = 0; k < n; k++) {
    const i = k % 6;
    b.addExample(near(i < 5 ? i : -1, 1000 + 97 * k), [800, 820], i === 5 ? 1 : i < 2 ? 16 : i > 2 ? 15 : 16);
  }
  b.train(3000);
  return b;
}

test('a trained AI goes through a code and comes back the same', async () => {
  const b = trained();
  const code = await encodeSetup(setupOf(b));
  assert.ok(code.startsWith('TAI1.'));
  console.log(`    30 examples, network 7-10-20-3: ${code.length} characters (QR limit ${QR_LIMIT})`);
  assert.ok(code.length < QR_LIMIT, `${code.length} characters: too long for a QR code`);
  for (const text of [code, linkFor(code, 'https://example.org/app/#old'), `  ${code}\n`]) {
    const s = await decodeSetup(text);
    assert.ok(s, 'decoded');
    const other = new Brain(s);
    assert.deepEqual(other.actions, b.actions);
    assert.equal(other.examples.length, 30);
    assert.deepEqual(s.actionSettings, { duration: 0.15, pause: 0.1, maxSpeed: 200, turnGain: 100 });
    // the network itself came: the same choices at once, without learning again
    for (const p of [near(-1), near(0, 3000), near(4, 3000), near(2, 2000)]) {
      assert.equal(other.best(p, [800, 800]), b.best(p, [800, 800]));
      const pa = other.probabilities(p, [800, 800]);
      const pb = b.probabilities(p, [800, 800]);
      pa.forEach((v, k) => assert.ok(Math.abs(v - pb[k]) < 0.02, `${v} vs ${pb[k]}`));
    }
  }
  assert.equal(linkFor('TAI1.abc', 'https://x.org/a/#ai=old'), 'https://x.org/a/#ai=TAI1.abc');
});

test('the file is plain JSON, and opens the same way', async () => {
  const b = trained(8, []);
  const file = JSON.stringify(packSetup(setupOf(b)), null, 2);
  assert.ok(isAiCode(file));
  const s = await decodeSetup(file);
  assert.equal(s.examples.length, 8);
  assert.ok(new Brain(s).net.load(b.net.toJSON()));
});

test('what is not an AI is refused', async () => {
  for (const text of ['', 'hello', 'TAI1.!!!', 'TAI1.AAAA', '{"format":"other"}', '{bad json', JSON.stringify({ format: 'thymio-ai-lab', sensors: {}, ai: {} })]) {
    assert.equal(await decodeSetup(text), null, text);
  }
  assert.ok(!isAiCode('LEARN1:abc'));
  assert.ok(isAiCode('https://x.org/#ai=TAI1.abc'));
});

test('the ready-made settings of the activities are complete and use known actions', () => {
  assert.deepEqual(PRESETS.map((p) => p.id), ['a1', 'a2', 'a3', 'a4', 'a5']);
  for (const p of PRESETS) {
    assert.ok(p.actions.every((id) => ACTIONS[id]), p.id);
    const b = new Brain({ sensors: p.sensors, ai: p.ai, actions: p.actions });
    assert.ok(b.inputs.length > 0, p.id);
  }
  assert.equal(PRESETS[1].ai.kind, 'reinforcement');
});

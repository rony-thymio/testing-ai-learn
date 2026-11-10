// The learning of the AI Lab (src/ai/brain.js): the inputs, the network, learning from examples.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Brain, Network, inputList, inputsFrom, parseLayers, proxValue, blackValue, softmax } from '../src/ai/brain.js';

const near = (i, v = 3200) => { const p = [0, 0, 0, 0, 0, 0, 0]; if (i >= 0) p[i] = v; return p; };
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('the inputs: values from 0 to 1, in the order of the Sensors settings', () => {
  assert.equal(proxValue(0), 0);
  assert.equal(proxValue(2000), 0.5);
  assert.equal(proxValue(4095), 1);
  assert.equal(blackValue(1000), 0);
  assert.equal(blackValue(100), 0.9);
  assert.equal(blackValue(-1), 0, 'no ground sensor: no black');
  assert.equal(inputList({ proximity: 'all', ground: 'off' }).length, 7);
  assert.equal(inputList({ proximity: 'front', ground: 'values' }).length, 7);
  assert.equal(inputList({ proximity: 'off', ground: 'binary' }).length, 2);
  const prox = [4000, 0, 1000, 0, 0, 0, 2000];
  assert.deepEqual(inputsFrom({ proximity: 'all', proxBinary: false, ground: 'off' }, prox, [900, 100]), [1, 0, 0.25, 0, 0, 0, 0.5]);
  assert.deepEqual(inputsFrom({ proximity: 'front', proxBinary: true, ground: 'binary' }, prox, [900, 100]), [1, 0, 0, 0, 0, 0, 1]);
  const v = inputsFrom({ proximity: 'off', ground: 'values' }, prox, [900, 100]);
  assert.ok(close(v[0], 0.1) && close(v[1], 0.9));
});

test('the layers typed in the AI settings', () => {
  assert.deepEqual(parseLayers('10 20'), [10, 20]);
  assert.deepEqual(parseLayers(' 5,10 '), [5, 10]);
  assert.deepEqual(parseLayers(''), []);
  assert.deepEqual(parseLayers('a 0 -3 7 1000'), [7, 200]);
});

test('a network without hidden layer starts with every action equally likely', () => {
  const n = new Network([7, 3]);
  assert.deepEqual(n.predict([1, 0, 0, 0, 0, 0, 0]).map((v) => v.toFixed(3)), ['0.333', '0.333', '0.333']);
  const h = new Network([7, 10, 20, 3]);
  const p = h.predict([1, 0, 0, 0, 0, 0, 0]);
  assert.equal(p.length, 3);
  assert.ok(close(p.reduce((a, b) => a + b, 0), 1, 1e-12));
  assert.ok(close(softmax([1000, 1000])[0], 0.5), 'no overflow');
});

test('the gradient is right (checked numerically)', () => {
  const n = new Network([3, 4, 2], 7);
  const x = [0.3, 0.8, 0.1];
  const loss = (net) => -Math.log(net.predict(x)[1]);
  const eps = 1e-6;
  // numerical gradient of one weight of each layer, against the change made by one step of learn()
  for (const [l, j, i] of [[0, 2, 1], [1, 0, 3]]) {
    const w0 = n.W[l][j][i];
    n.W[l][j][i] = w0 + eps;
    const up = loss(n);
    n.W[l][j][i] = w0 - eps;
    const down = loss(n);
    n.W[l][j][i] = w0;
    const numeric = (up - down) / (2 * eps);
    const copy = new Network([3, 4, 2], 7);
    copy.W = JSON.parse(JSON.stringify(n.W));
    copy.b = JSON.parse(JSON.stringify(n.b));
    copy.learn(x, 1, 1e-3);
    const analytic = (w0 - copy.W[l][j][i]) / 1e-3;
    assert.ok(Math.abs(numeric - analytic) < 1e-5, `layer ${l}: ${numeric} vs ${analytic}`);
  }
});

for (const hidden of [[], [10, 20]]) {
  test(`it learns "Thymio the fearful" (activity 1), layers [${hidden}]`, () => {
    const b = new Brain({ actions: [2, 0], ai: { hidden } });
    b.addExample(near(2), [-1, -1], 2);
    b.addExample(near(-1), [-1, -1], 0);
    b.train(4000);
    assert.equal(b.best(near(2), null), 2, 'a hand in front: backward');
    assert.equal(b.best(near(-1), null), 0, 'nothing: stop');
    assert.ok(b.probabilities(near(2), null)[0] > 0.9);
  });

  test(`it learns to avoid obstacles, and to follow a line with the ground sensors, layers [${hidden}]`, () => {
    const c = new Brain({ actions: [1, 15, 16], ai: { hidden } });
    c.addExample(near(-1), null, 1);
    for (const [i, v] of [[0, 3000], [1, 3000], [1, 1500]]) c.addExample(near(i, v), null, 16);
    for (const [i, v] of [[4, 3000], [3, 3000], [3, 1500]]) c.addExample(near(i, v), null, 15);
    c.train(6000);
    assert.equal(c.best(near(-1), null), 1);
    assert.equal(c.best(near(0, 2500), null), 16);
    assert.equal(c.best(near(4, 2500), null), 15);
    // a line: left sensor on black -> turn left, right on black -> turn right, both white -> forward
    const g = new Brain({ actions: [1, 5, 6], sensors: { proximity: 'off', ground: 'values' }, ai: { hidden } });
    g.addExample(near(-1), [900, 900], 1);
    g.addExample(near(-1), [120, 900], 5);
    g.addExample(near(-1), [900, 120], 6);
    g.addExample(near(-1), [120, 120], 1);
    g.train(8000);
    assert.equal(g.best(near(-1), [150, 850]), 5);
    assert.equal(g.best(near(-1), [850, 150]), 6);
    assert.equal(g.best(near(-1), [880, 880]), 1);
  });
}

test('forget the last example, reset, and the examples of actions that are not selected', () => {
  const b = new Brain({ actions: [2, 0] });
  b.addExample(near(2), null, 2);
  b.addExample(near(-1), null, 0);
  b.addExample(near(-1), null, 2);              // a mistake
  assert.equal(b.examples.length, 3);
  assert.ok(b.forgetLast());
  assert.equal(b.examples.length, 2);
  assert.equal(b.best(near(-1), null), 0);
  // an action no longer selected: its examples wait, they are not lost
  b.configure({ actions: [0] });
  assert.equal(b.usable().length, 1);
  assert.equal(b.net.sizes.at(-1), 1);
  b.configure({ actions: [2, 0] });
  assert.equal(b.usable().length, 2);
  // the network is rebuilt when the sensors or the layers change, not when the learning speed does
  const v = b.net;
  b.configure({ ai: { learningRate: 0.05 } });
  assert.equal(b.net, v);
  b.configure({ ai: { hidden: [5] } });
  assert.notEqual(b.net, v);
  assert.deepEqual(b.net.sizes, [7, 5, 2]);
  b.configure({ sensors: { proximity: 'front', ground: 'values' } });
  assert.deepEqual(b.net.sizes, [7, 5, 2]);
  b.configure({ sensors: { ground: 'off' } });
  assert.deepEqual(b.net.sizes, [5, 5, 2]);
  b.reset();
  assert.equal(b.examples.length, 0);
  assert.equal(b.train(10), null, 'nothing to learn');
  assert.deepEqual(b.counts(), {});
  // what is saved, comes back
  b.addExample(near(1), null, 0);
  const again = new Brain(JSON.parse(JSON.stringify(b.toJSON())));
  assert.deepEqual(again.examples, b.examples);
  assert.deepEqual(again.net.sizes, b.net.sizes);
});

test('no action selected', () => {
  const b = new Brain({ actions: [] });
  assert.equal(b.best(near(1), null), -1);
  b.addExample(near(1), null, 1);
  assert.equal(b.usable().length, 0);
});

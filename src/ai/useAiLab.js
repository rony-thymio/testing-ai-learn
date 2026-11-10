// The AI Lab's brain in the page: the learning, and the robot driving itself.
//
// Supervised learning
//   piloted     the person clicks an action: the robot does it and, if "Learn" is on, the situation and the action become an
//               example; the network learns from all the examples, all the time, while "Learn" is on.
//   autonomous  each time an action is done, the network chooses the next one from what the sensors read then (the robot sends
//               them with "done"), and the robot does it. Learning pauses (as in AlphAI); a click on an action still works.
// Reinforcement learning (activity 2)
//   each action done earns a reward (or a penalty) from what the sensors read then; the robot glows green or red; the level is
//   the mean of the rewards of the last minute. The network learns the value of each action from what happened. In autonomous
//   mode the robot does the action of highest value or, now and then (exploration), another one. A click on an action makes the
//   robot do it, and it learns from it too.
//   step by step  one action chosen by the network, then wait.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Brain, DEFAULT_AI_CONFIG, DEFAULT_SENSOR_CONFIG } from './brain.js';
import { AI_CMD } from '../protocol.js';

const KEY = 'learn.ai.brain';
const TRAIN_EVERY_MS = 50;
const TRAIN_BUDGET_MS = 8;            // at most this long every TRAIN_EVERY_MS (the page stays smooth)
const DRIVE_EVERY_MS = 25;
const STUCK_MS = 2500;                // an action that never says it is done: the autonomous loop goes on anyway, after its time and this
const LEVEL_MS = 60000;               // the level: the mean of the rewards of the last minute
const GREEN = [0, 12, 0];
const RED = [14, 0, 0];

function loadBrain(selected) {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved === 'object') {
      return new Brain({
        sensors: { ...DEFAULT_SENSOR_CONFIG, ...(saved.sensors || {}) },
        ai: { ...DEFAULT_AI_CONFIG, ...(saved.ai || {}) },
        actions: selected,
        examples: Array.isArray(saved.examples) ? saved.examples.filter((e) => Array.isArray(e?.prox) && Number.isInteger(e?.action)) : [],
        network: saved.network || null,
      });
    }
  } catch { /* nothing saved, or not readable */ }
  return new Brain({ actions: selected });
}

const fmt2 = (a) => a.map((v) => v.toFixed(2)).join(' ');

// `snapRef`: the latest telemetry (src/store.js); `send(change)`: tell the program (an action, a command, settings), resolves or
// rejects; `selected`: the actions the network chooses from; `actionMs`: how long the longest action and its pause last (for
// STUCK_MS); `enabled`: the program runs; `active`: the AI Lab is on screen (no learning in the background otherwise); `log`:
// the journal of the link.
export default function useAiLab({ snapRef, send, selected, actionMs, enabled, active = true, log = () => {} }) {
  const brainRef = useRef(null);
  if (!brainRef.current) brainRef.current = loadBrain(selected);
  const brain = brainRef.current;
  const [, setVersion] = useState(0);
  const [learn, setLearn] = useState(true);
  const [auto, setAuto] = useState(false);
  const [decision, setDecision] = useState(null);       // the last action the network chose: { id, p, explored, at }
  const [rewards, setRewards] = useState([]);           // reinforcement: [{ at, r }] of the last minute
  const live = useRef({});
  live.current = { learn, auto, enabled, send, actionMs, active, log };

  // the robot gone (or the program stopped): it no longer drives itself
  useEffect(() => { if (!enabled) setAuto(false); }, [enabled]);

  const save = useCallback(() => {
    try { localStorage.setItem(KEY, JSON.stringify(brain.toJSON())); } catch { /* full or blocked: it stays for this visit */ }
  }, [brain]);
  const changed = useCallback(() => { setVersion(brain.version); save(); }, [brain, save]);

  // the actions chosen in the Actions settings are the outputs of the network
  useEffect(() => { if (brain.configure({ actions: selected })) changed(); }, [brain, selected.join(), changed]);       // eslint-disable-line react-hooks/exhaustive-deps

  // learning, all the time while "Learn" is on (a little at a time); what was learnt is saved now and then
  useEffect(() => {
    let shown = brain.version;
    let saved = Date.now();
    const id = setInterval(() => {
      if (!live.current.learn || !live.current.active || !brain.usable().length) return;
      const t0 = performance.now();
      while (performance.now() - t0 < TRAIN_BUDGET_MS) brain.train(20);
      // the picture of the network follows, a few times a second
      if (brain.version - shown > 0) { shown = brain.version; setVersion(shown); }
      if (Date.now() - saved > 5000) { saved = Date.now(); save(); }
    }, TRAIN_EVERY_MS);
    return () => clearInterval(id);
  }, [brain, save]);

  // ---- the body's light (reinforcement: green for a reward, red for a penalty) ------------------------------------------------
  const light = useRef(null);
  const setLight = useCallback((rgb) => {
    const key = rgb ? rgb.join() : '';
    if (light.current === key) return;
    light.current = key;
    live.current.send({ light: rgb }).catch(() => { light.current = null; });
  }, []);
  useEffect(() => { if (!enabled) light.current = null; }, [enabled]);

  // ---- carrying out actions ------------------------------------------------------------------------------------------
  const waiting = useRef(null);       // { since, done: the count of actions done when it was sent }
  const pending = useRef(null);       // reinforcement: the action sent and the situation it was sent in, until it is done
  const doAction = useCallback((id) => {
    const s = snapRef.current;
    const done = s.ai.lastDone?.count ?? 0;
    waiting.current = { since: performance.now(), done };
    pending.current = brain.reinforcement ? { prox: s.prox.slice(), ground: s.ai.ground.slice(), action: id, done } : null;
    return live.current.send({ action: id }).catch((err) => { waiting.current = null; pending.current = null; throw err; });
  }, [snapRef, brain]);

  // Reinforcement: an action is done, here is its reward (and what it teaches, with "Learn" on).
  const rewarded = useCallback((s) => {
    const p = pending.current;
    pending.current = null;
    const r = live.current.learn
      ? brain.experience(p.prox, p.ground, p.action, s.prox, s.ai.ground)
      : brain.reward(p.action, s.prox);
    const now = Date.now();
    setRewards((list) => [...list.filter((e) => now - e.at < LEVEL_MS), { at: now, r }]);
    if (r > 0) setLight(GREEN);
    else if (r < 0) setLight(RED);
    live.current.log('info', `AI: action ${p.action} done, sensors after ${fmt2(brain.x(s.prox, s.ai.ground))}, reward ${r}`);
    setVersion(brain.version);
  }, [brain, setLight]);

  // What the network chooses now, from the latest readings (those sent with "done" are the latest when the robot has just stopped).
  const choose = useCallback(() => {
    const s = snapRef.current;
    let id;
    let explored = false;
    if (brain.reinforcement) ({ action: id, explored } = brain.chooseRL(s.prox, s.ai.ground));
    else id = brain.best(s.prox, s.ai.ground);
    if (id >= 0) {
      const k = brain.actions.indexOf(id);
      const scores = brain.reinforcement ? brain.values(s.prox, s.ai.ground) : brain.probabilities(s.prox, s.ai.ground).map((v) => v * 100);
      setDecision({ id, p: scores[k], explored, at: Date.now() });
      // in the journal of the link: what the network saw and what it chose (to understand a robot that does something odd)
      live.current.log('info', `AI: inputs ${fmt2(brain.x(s.prox, s.ai.ground))} -> ${brain.actions.map((a, j) => `${a}:${Math.round(scores[j])}${brain.reinforcement ? '' : '%'}`).join(' ')} -> action ${id}${explored ? ' (exploring)' : ''}`);
    }
    return id;
  }, [brain, snapRef]);

  // Every few milliseconds: a reward for the action just done (reinforcement), and the next action when the robot drives itself.
  useEffect(() => {
    const id = setInterval(() => {
      const { auto: on, enabled: ok, actionMs: ms } = live.current;
      const s = snapRef.current;
      if (pending.current && (s.ai.lastDone?.count ?? 0) > pending.current.done) rewarded(s);
      if (!on || !ok) { waiting.current = null; return; }
      const w = waiting.current;
      const stuck = w && performance.now() - w.since > ms + STUCK_MS;
      if (w) {
        const doneSince = (s.ai.lastDone?.count ?? 0) > w.done;
        if (!doneSince && !stuck) return;
        waiting.current = null;
      }
      if (s.ai.phase !== 'idle' && !stuck) return;
      if (stuck) pending.current = null;
      const next = choose();
      if (next < 0) { setAuto(false); return; }
      doAction(next).catch(() => {});
    }, DRIVE_EVERY_MS);
    return () => clearInterval(id);
  }, [snapRef, choose, doAction, rewarded]);

  // ---- what the person does --------------------------------------------------------------------------------------------
  // A click on an action: the robot does it; with "Learn" on (supervised), it is also an example.
  const teach = useCallback((id) => {
    const s = snapRef.current;
    if (!brain.reinforcement && live.current.learn && selected.includes(id)) {
      brain.addExample(s.prox, s.ai.ground, id);
      live.current.log('info', `AI: example ${brain.examples.length}: inputs ${fmt2(brain.x(s.prox, s.ai.ground))} -> action ${id}`);
      changed();
    }
    return doAction(id);
  }, [brain, snapRef, selected, doAction, changed]);

  const step = useCallback(() => {
    const next = choose();
    if (next >= 0) doAction(next).catch(() => {});
  }, [choose, doAction]);

  const forgetLast = useCallback(() => { if (brain.forgetLast()) changed(); }, [brain, changed]);
  const reset = useCallback(() => { brain.reset(); setRewards([]); setDecision(null); changed(); }, [brain, changed]);
  const configure = useCallback((c) => {
    const wasRl = brain.reinforcement;
    brain.configure(c);
    if (wasRl !== brain.reinforcement) { setRewards([]); setDecision(null); if (!brain.reinforcement) setLight(null); }
    changed();
  }, [brain, changed, setLight]);
  // A whole AI from elsewhere (a file, a link, a QR code): its settings, its examples, its network.
  const load = useCallback((setup) => {
    const wasRl = brain.reinforcement;
    brain.examples = setup.examples.slice();
    brain.configure({ sensors: setup.sensors, ai: setup.ai, actions: setup.actions });
    brain.rebuild();
    if (setup.network && brain.net.load(setup.network)) brain.syncTarget();
    else if (!brain.reinforcement) brain.train(3000);
    setRewards([]);
    setDecision(null);
    if (wasRl && !brain.reinforcement) setLight(null);
    live.current.log('info', `AI: loaded "${setup.name || ''}": ${brain.examples.length} examples, network ${brain.net.sizes.join('-')}`);
    changed();
  }, [brain, changed, setLight]);

  // Supervised: learning pauses when the robot drives itself, as in AlphAI (Learn can be switched on again by hand).
  // Reinforcement: learning goes on, that is how it learns.
  const toggleAuto = useCallback(() => {
    const was = live.current.auto;
    setAuto(!was);
    live.current.log('info', `AI: autonomous ${was ? 'off' : 'on'} (${brain.reinforcement ? 'reinforcement' : 'supervised'}, ${brain.usable().length} ${brain.reinforcement ? 'steps' : 'examples'}, actions ${brain.actions.join(' ')})`);
    if (!was && !brain.reinforcement) setLearn(false);
    if (!was && brain.reinforcement) setLearn(true);
    if (was) { waiting.current = null; send({ command: AI_CMD.STOP }).catch(() => {}); save(); }        // the robot stops at once
  }, [send, brain, save]);

  const now = Date.now();
  const recent = rewards.filter((e) => now - e.at < LEVEL_MS);
  const level = recent.length ? recent.reduce((a, e) => a + e.r, 0) / recent.length : null;
  const lastReward = rewards.length ? rewards[rewards.length - 1].r : null;

  return { brain, learn, setLearn, auto, setAuto, toggleAuto, teach, step, forgetLast, reset, configure, load, decision, level, lastReward };
}

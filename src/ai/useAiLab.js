// The AI Lab's brain in the page: the examples, the learning, and the robot driving itself (AlphAI's control bar).
//
//   piloted     the person clicks an action: the robot does it and, if "Learn" is on, the situation and the action become an
//               example; the network learns from all the examples, all the time, while "Learn" is on.
//   autonomous  each time an action is done, the network chooses the next one from what the sensors read then (the robot
//               sends them with "done"), and the robot does it. A click on an action still works (and teaches, if "Learn" is on).
//   step by step  one action chosen by the network, then wait.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Brain, DEFAULT_AI_CONFIG, DEFAULT_SENSOR_CONFIG } from './brain.js';
import { AI_CMD } from '../protocol.js';

const KEY = 'learn.ai.brain';
const TRAIN_EVERY_MS = 50;
const TRAIN_BUDGET_MS = 8;            // at most this long every TRAIN_EVERY_MS (the page stays smooth)
const DRIVE_EVERY_MS = 25;
const STUCK_MS = 2500;                // an action that never says it is done: the autonomous loop goes on anyway, after its time and this

function loadBrain(selected) {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved === 'object') {
      return new Brain({
        sensors: { ...DEFAULT_SENSOR_CONFIG, ...(saved.sensors || {}) },
        ai: { ...DEFAULT_AI_CONFIG, ...(saved.ai || {}) },
        actions: selected,
        examples: Array.isArray(saved.examples) ? saved.examples.filter((e) => Array.isArray(e?.prox) && Number.isInteger(e?.action)) : [],
      });
    }
  } catch { /* nothing saved, or not readable */ }
  return new Brain({ actions: selected });
}

// `snapRef`: the latest telemetry (src/store.js); `send(change)`: tell the program (an action, a command, settings), resolves or
// rejects; `selected`: the actions the network chooses from; `actionMs`: how long the longest action and its pause last (for
// STUCK_MS); `enabled`: the program runs; `active`: the AI Lab is on screen (no learning in the background otherwise).
export default function useAiLab({ snapRef, send, selected, actionMs, enabled, active = true }) {
  const brainRef = useRef(null);
  if (!brainRef.current) brainRef.current = loadBrain(selected);
  const brain = brainRef.current;
  const [, setVersion] = useState(0);
  const [learn, setLearn] = useState(true);
  const [auto, setAuto] = useState(false);
  const live = useRef({});
  live.current = { learn, auto, enabled, send, actionMs, active };

  // the robot gone (or the program stopped): it no longer drives itself
  useEffect(() => { if (!enabled) setAuto(false); }, [enabled]);

  const changed = useCallback(() => {
    setVersion(brain.version);
    try { localStorage.setItem(KEY, JSON.stringify(brain.toJSON())); } catch { /* full or blocked: the examples stay for this visit */ }
  }, [brain]);

  // the actions chosen in the Actions settings are the outputs of the network
  useEffect(() => { if (brain.configure({ actions: selected })) changed(); }, [brain, selected.join(), changed]);       // eslint-disable-line react-hooks/exhaustive-deps

  // learning, all the time while "Learn" is on (a little at a time)
  useEffect(() => {
    let shown = brain.version;
    const id = setInterval(() => {
      if (!live.current.learn || !live.current.active || !brain.usable().length) return;
      const t0 = performance.now();
      while (performance.now() - t0 < TRAIN_BUDGET_MS) brain.train(20);
      // the picture of the network follows, a few times a second
      if (brain.version - shown > 0) { shown = brain.version; setVersion(shown); }
    }, TRAIN_EVERY_MS);
    return () => clearInterval(id);
  }, [brain]);

  // ---- carrying out actions ------------------------------------------------------------------------------------------
  const waiting = useRef(null);       // { since, done: the count of actions done when it was sent }
  const doAction = useCallback((id) => {
    const s = snapRef.current;
    waiting.current = { since: performance.now(), done: s.ai.lastDone?.count ?? 0 };
    return live.current.send({ action: id }).catch((err) => { waiting.current = null; throw err; });
  }, [snapRef]);

  // What the network chooses now, from the latest readings (those sent with "done" are the latest when the robot has just stopped).
  const choose = useCallback(() => {
    const s = snapRef.current;
    return brain.best(s.prox, s.ai.ground);
  }, [brain, snapRef]);

  // the robot drives itself: as soon as an action is done, the next one
  useEffect(() => {
    const id = setInterval(() => {
      const { auto: on, enabled: ok, actionMs: ms } = live.current;
      if (!on || !ok) { waiting.current = null; return; }
      const s = snapRef.current;
      const w = waiting.current;
      if (w) {
        const doneSince = (s.ai.lastDone?.count ?? 0) > w.done;
        const stuck = performance.now() - w.since > ms + STUCK_MS;
        if (!doneSince && !stuck) return;
        waiting.current = null;
      }
      if (s.ai.phase !== 'idle' && !(w && performance.now() - w.since > ms + STUCK_MS)) return;
      const next = choose();
      if (next < 0) { setAuto(false); return; }
      doAction(next).catch(() => {});
    }, DRIVE_EVERY_MS);
    return () => clearInterval(id);
  }, [snapRef, choose, doAction]);

  // ---- what the person does --------------------------------------------------------------------------------------------
  // A click on an action: the robot does it; with "Learn" on, it is also an example.
  const teach = useCallback((id) => {
    const s = snapRef.current;
    if (live.current.learn && selected.includes(id)) {
      brain.addExample(s.prox, s.ai.ground, id);
      changed();
    }
    return doAction(id);
  }, [brain, snapRef, selected, doAction, changed]);

  const step = useCallback(() => {
    const next = choose();
    if (next >= 0) doAction(next).catch(() => {});
  }, [choose, doAction]);

  const forgetLast = useCallback(() => { if (brain.forgetLast()) changed(); }, [brain, changed]);
  const reset = useCallback(() => { brain.reset(); changed(); }, [brain, changed]);
  const configure = useCallback((c) => { brain.configure(c); changed(); }, [brain, changed]);
  const toggleAuto = useCallback(() => {
    const was = live.current.auto;
    setAuto(!was);
    if (was) { waiting.current = null; send({ command: AI_CMD.STOP }).catch(() => {}); }        // the robot stops at once
  }, [send]);

  return { brain, learn, setLearn, auto, setAuto, toggleAuto, teach, step, forgetLast, reset, configure };
}

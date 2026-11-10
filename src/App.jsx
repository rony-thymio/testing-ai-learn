import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Network from './components/Network.jsx';
import CycleStrip from './components/CycleStrip.jsx';
import ControlBar from './components/ControlBar.jsx';
import Timeline from './components/Timeline.jsx';
import Arena from './components/Arena.jsx';
import LinkInfo from './components/LinkInfo.jsx';
import LearningRule from './components/LearningRule.jsx';
import Settings from './components/Settings.jsx';
import Help from './components/Help.jsx';
import QrShow from './components/QrShow.jsx';
import QrScan from './components/QrScan.jsx';
import AiLab, { AiActionSettings, AiBrainSettings, AiSensorSettings, AiShare } from './components/AiLab.jsx';
import { DEFAULT_AI_CONFIG } from './ai/brain.js';
import { decodeSetup, encodeSetup, isAiCode, linkFor, packSetup, QR_LIMIT } from './ai/share-ai.js';
import { aiText } from './ai/i18n-ai.js';
import { DEFAULT_ACTION_SETTINGS, DEFAULT_SELECTED, ACTIONS, plan } from './ai/actions.js';
import useAiLab from './ai/useAiLab.js';
import { BluetoothIcon, HelpIcon, QrIcon, ScanIcon, WarnIcon } from './icons.jsx';
import { I18N, detectLang, fmt } from './i18n.js';
import { Telemetry } from './store.js';
import { SimBackend } from './sim/sim-backend.js';
import { RobotBackend } from './robot/robot-backend.js';
import { supportsBluetooth } from './api.js';
import { CMD } from './protocol.js';
import { APP_LINKS, configChange, decodeConfig, encodeConfig } from './share.js';
import { cleanName, formatWhen, randomName } from './names.js';
import { useMedia, useSize } from './util.js';

const load = (key, fallback) => { try { const v = localStorage.getItem(key); return v == null ? fallback : v; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };

const loadJson = (key, fallback) => { try { const v = JSON.parse(load(key, 'null')); return v ?? fallback; } catch { return fallback; } };
const ACTION_IDS = new Set(ACTIONS.map((x) => x.id));

const weightChange = (left, right) => ({ left: Object.fromEntries(left.map((v, i) => [i, v])), right: Object.fromEntries(right.map((v, i) => [i, v])) });

export default function App() {
  const [lang, setLang] = useState(detectLang);
  const t = I18N[lang] || I18N.fr;
  const a = aiText(lang);
  // which program runs: 'ann' (Neurons: the robot learns by itself, the white mode of the firmware) or 'ai' (the AI Lab)
  const [program, setProgramState] = useState(() => (load('learn.program', 'ann') === 'ai' ? 'ai' : 'ann'));
  const programRef = useRef(program);
  const [aiSelected, setAiSelected] = useState(() => { const v = loadJson('learn.ai.selected', DEFAULT_SELECTED); return Array.isArray(v) ? v.filter((id) => ACTION_IDS.has(id)) : DEFAULT_SELECTED; });
  const [aiSettings, setAiSettings] = useState(() => ({ ...DEFAULT_ACTION_SETTINGS, ...loadJson('learn.ai.settings', {}) }));
  const aiSettingsRef = useRef(aiSettings);
  aiSettingsRef.current = aiSettings;
  const [theme, setTheme] = useState(() => load('learn.theme', 'auto'));
  const [tab, setTab] = useState('net');
  const [source, setSource] = useState('virtual');                  // 'virtual' | 'robot'
  const [simSpeed, setSimSpeed] = useState(1);
  const [settings, setSettings] = useState(false);
  const [help, setHelp] = useState(() => load('learn.help', '') !== '1');
  const [log, setLog] = useState([]);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState('');
  const [qr, setQr] = useState(null);                                 // the QR code shown ({ show, caption }) or the scanner ({ scan })
  const [showName, setShowName] = useState(() => load('learn.pseudo.show', '0') === '1');   // the pseudonym is written under the QR code only when the adult turns it on (kept only once chosen)
  const chooseShowName = (v) => { setShowName(v); save('learn.pseudo.show', v ? '1' : '0'); };
  const [name, setName] = useState(() => { const kept = load('learn.name', null); return kept === null ? randomName() : cleanName(kept); });   // under the QR code, drawn at random the first time
  const bluetooth = supportsBluetooth();

  const tele = useRef(null);
  if (!tele.current) tele.current = new Telemetry();
  const snap = useSyncExternalStore(tele.current.subscribe, tele.current.getSnapshot);

  const sim = useRef(null);
  const robot = useRef(null);
  const sourceRef = useRef('virtual');
  const started = useRef(false);                                    // the mode was started on the current connection
  const connecting = useRef(false);
  if (!sim.current) { sim.current = new SimBackend((ev) => tele.current.push(ev)); sim.current.setProgram(programRef.current); }

  // (a handle for the console and the tests: window.__learn.sim.advance(ms) moves the virtual robot without waiting)
  useEffect(() => {
    if (import.meta.env?.DEV) window.__learn = { tele: tele.current, sim: sim.current, get robot() { return robot.current; } };
  }, []);

  // ---- theme and language -------------------------------------------------------------------------
  useEffect(() => {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    save('learn.theme', theme);
  }, [theme]);
  useEffect(() => { save('learn.name', name); }, [name]);
  useEffect(() => { document.documentElement.lang = lang; save('learn.lang', lang); document.title = t.app.title; }, [lang, t.app.title]);

  // ---- the virtual robot's clock ---------------------------------------------------------------------
  const initFromSettings = () => {
    if (programRef.current === 'ai') return { ...aiSettingsRef.current };
    const p = tele.current.s.params;
    return { step: p.step, baseLeft: p.baseLeft, baseRight: p.baseRight, forget: p.forget };
  };
  useEffect(() => { sim.current.speed = simSpeed; }, [simSpeed]);
  useEffect(() => {
    sim.current.start(initFromSettings());
    let raf = 0;
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min(100, now - last);
      last = now;
      if (sourceRef.current === 'virtual') sim.current.advance(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); sim.current.stop(); };
  }, []);

  // ---- the real robot ------------------------------------------------------------------------------------
  const onLog = useCallback((kind, text) => setLog((l) => [...l.slice(-500), { at: Date.now(), kind, text }]), []);

  const backToVirtual = useCallback((reason = '') => {
    sourceRef.current = 'virtual';
    setSource('virtual');
    started.current = false;
    connecting.current = false;
    tele.current.clear();
    tele.current.setLink({ status: 'idle', device: '', firmware: null });
    sim.current.start(initFromSettings());
    setNotice(reason);
  }, []);

  const onRobotEvent = useCallback((ev) => {
    if (sourceRef.current !== 'robot') return;
    tele.current.push(ev);
    if (ev.type === 'conn') {
      if (ev.status === 'connected' && !started.current) {
        started.current = true;
        robot.current.start(initFromSettings()).catch((err) => {
          started.current = false;
          tele.current.push({ type: 'error', message: err?.message || String(err) });
        });
      }
      if (ev.status === 'disconnected' || ev.status === 'reconnect') {
        started.current = false;
        if (connecting.current && ev.error) backToVirtual(ev.error);
      }
    }
  }, [backToVirtual]);

  const connect = useCallback(async () => {
    if (!bluetooth) { setSettings(true); return; }
    setNotice('');
    if (!robot.current) {
      robot.current = new RobotBackend((ev) => onRobotEvent(ev), { onLog });
      robot.current.setProgram(programRef.current);
      robot.current.attach();
    }
    sim.current.stop();
    sourceRef.current = 'robot';
    setSource('robot');
    started.current = false;
    connecting.current = true;
    tele.current.clear();
    tele.current.setLink({ status: 'connecting' });
    try { await robot.current.connect(); } finally { connecting.current = false; }
  }, [bluetooth, onLog, onRobotEvent]);

  const disconnect = useCallback(async () => {
    try { await robot.current?.disconnect(); } catch { /* ignore */ }
    backToVirtual('');
  }, [backToVirtual]);

  const restartMode = useCallback(() => {
    if (sourceRef.current === 'robot') {
      started.current = true;
      robot.current.start(initFromSettings()).catch((err) => tele.current.push({ type: 'error', message: err?.message || String(err) }));
    } else {
      tele.current.clear();
      sim.current.start(initFromSettings());
    }
  }, []);

  // Neurons or the AI Lab: the other program is started on the robot (or the virtual one) with what the person last chose for it.
  const chooseProgram = useCallback((next) => {
    if (next === programRef.current) return;
    programRef.current = next;
    setProgramState(next);
    save('learn.program', next);
    setNotice('');
    tele.current.clear();
    sim.current.setProgram(next);
    robot.current?.setProgram(next);
    if (sourceRef.current === 'robot') {
      if (tele.current.s.link.status === 'connected') {
        started.current = true;
        robot.current.start(initFromSettings()).catch((err) => tele.current.push({ type: 'error', message: err?.message || String(err) }));
      }
    } else {
      sim.current.start(initFromSettings());
    }
  }, []);

  // ---- what the person asks for ----------------------------------------------------------------------
  const send = useCallback(async (change) => {
    if (sourceRef.current === 'robot') {
      const b = robot.current;
      if (!b) return;
      tele.current.sending(1);
      try { await b.apply(change); } finally { tele.current.sending(-1); }
    } else {
      sim.current.apply(change);
    }
  }, []);

  // the AI Lab: the settings of the actions, the actions the robot can use (the learning: src/ai/useAiLab.js)
  const changeAiSettings = useCallback((change) => {
    setAiSettings((prev) => { const next = { ...prev, ...change }; save('learn.ai.settings', JSON.stringify(next)); return next; });
    send(change).catch(() => {});
  }, [send]);
  const chooseActions = useCallback((ids) => {
    const next = ACTIONS.map((x) => x.id).filter((id) => ids.includes(id));
    setAiSelected(next);
    save('learn.ai.selected', JSON.stringify(next));
  }, []);

  const setWeight = useCallback((sensor, wheel, w) => send({ [wheel === 0 ? 'left' : 'right']: { [sensor]: w } }), [send]);
  const setBase = useCallback((wheel, v) => send({ [wheel === 0 ? 'baseLeft' : 'baseRight']: v }), [send]);
  const applyPreset = useCallback((p) => send(weightChange(p.left, p.right)), [send]);

  // ---- the QR code of the configuration: what it shows, and what a scanned one sets up (share.js) -------------------
  const showQr = () => setQr({
    show: encodeConfig({ lang, showName, ...snap.params, weights: snap.weights }),
    caption: { name: showName ? name.trim() : '', when: formatWhen(new Date(), lang) },
  });
  const scanQr = () => setQr({ scan: true });
  const showLink = (kind) => { if (APP_LINKS[kind]) { setSettings(false); setQr({ show: APP_LINKS[kind], link: kind }); } };      // from the settings: the address of the application, for the devices of the class
  const applyScanned = useCallback((text) => {
    if (isAiCode(text)) {                                         // a trained AI (AI Lab)
      decodeSetup(text).then((setup) => { if (setup) aiRef.current.adoptShared(setup); else aiRef.current.say(aiRef.current.a.share.notAi); });
      setTimeout(() => setQr(null), 700);
      return true;
    }
    const cfg = decodeConfig(text);
    if (!cfg) return false;
    if (cfg.lang) setLang(cfg.lang);
    if (cfg.showName !== undefined) chooseShowName(cfg.showName);
    const change = configChange(cfg);
    if (Object.keys(change).length) send(change);
    setTimeout(() => setQr(null), 700);                           // the frame goes green for a moment
    return true;
  }, [send]);

  const selfTest = useCallback(async () => {
    if (!robot.current) return;
    setTesting(true);
    try { await robot.current.selfTest(); } finally { setTesting(false); }
  }, []);

  // ---- keys ---------------------------------------------------------------------------------------------------
  const live = source === 'robot';
  const online = snap.running && (!live || snap.link.status === 'connected');

  // the AI Lab's brain: the examples, the learning, autonomous driving
  const snapRef = useMemo(() => ({ get current() { return tele.current.s; } }), []);           // the latest state, not the last published one
  const actionMs = useMemo(() => {
    const d = Math.round(aiSettings.duration * 1000);
    const longest = Math.max(d, ...aiSelected.map((id) => plan(id, d, aiSettings.maxSpeed, aiSettings.turnGain).ms));
    return longest + Math.round(aiSettings.pause * 1000);
  }, [aiSettings, aiSelected]);
  const lab = useAiLab({ snapRef, send, selected: aiSelected, actionMs, enabled: online && program === 'ai', active: program === 'ai', log: onLog });

  // ---- sharing a trained AI (src/ai/share-ai.js): a QR code, a link, a file; and the ready-made settings of the activities ------
  const [shareMsg, setShareMsg] = useState('');
  const [offer, setOffer] = useState(null);                         // an AI opened from a link, waiting for "Use it"
  const currentSetup = () => ({ ...lab.brain.toJSON(), actions: aiSelected, actionSettings: aiSettings, name: name.trim() });
  const applySetup = useCallback((setup) => {
    const ids = ACTIONS.map((x) => x.id).filter((id) => setup.actions.includes(id));
    setAiSelected(ids);
    save('learn.ai.selected', JSON.stringify(ids));
    const st = { ...DEFAULT_ACTION_SETTINGS, ...(setup.actionSettings || {}) };
    setAiSettings(st);
    save('learn.ai.settings', JSON.stringify(st));
    send({ duration: st.duration, pause: st.pause, maxSpeed: st.maxSpeed, turnGain: st.turnGain }).catch(() => {});
    lab.load({ ...setup, actions: ids, examples: setup.examples || [], ai: { ...DEFAULT_AI_CONFIG, ...setup.ai } });
  }, [lab, send]);
  const applyActivity = useCallback((p) => {
    applySetup({ ...p, examples: [], network: null, actionSettings: { ...p.actionSettings, turnGain: aiSettings.turnGain } });   // the calibration of this robot stays
  }, [applySetup, aiSettings.turnGain]);
  const describe = (setup) => {
    const kind = setup.ai.kind === 'reinforcement' ? a.headline.reinforcement : a.headline.supervised;
    const names = setup.actions.map((id) => a.action[ACTIONS[id]?.name]).filter(Boolean).join(', ');
    return `${setup.name ? `"${setup.name}" · ` : ''}${fmt(setup.ai.kind === 'reinforcement' ? a.share.what1Rl : a.share.what1, { kind, n: setup.examples.length, actions: names })}`;
  };
  const adoptShared = useCallback((setup) => {
    if (programRef.current !== 'ai') chooseProgram('ai');
    applySetup(setup);
    setShareMsg(fmt(a.share.loaded, { what: describe(setup) }));
    setNotice(fmt(a.share.loaded, { what: describe(setup) }));
  }, [applySetup, chooseProgram, a]);                                // eslint-disable-line react-hooks/exhaustive-deps
  const aiRef = useRef({});
  aiRef.current = { adoptShared, a, say: setShareMsg };
  const shareLink = async () => linkFor(await encodeSetup(currentSetup()), window.location.href);
  const showAiQr = async () => {
    setShareMsg('');
    const link = await shareLink();
    if (link.length > QR_LIMIT + 80) { setShareMsg(fmt(a.share.tooBig, { n: link.length })); setNotice(fmt(a.share.tooBig, { n: link.length })); return; }
    setQr({ show: link, caption: { name: showName ? name.trim() : '', when: formatWhen(new Date(), lang) } });
  };
  const copyAiLink = async () => {
    try { await navigator.clipboard.writeText(await shareLink()); setShareMsg(a.share.copied); } catch { setShareMsg(a.share.copyFailed); }
  };
  const saveAiFile = () => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const fileName = `thymio-ai-${stamp}.json`;
    const url = URL.createObjectURL(new Blob([JSON.stringify(packSetup(currentSetup()), null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setShareMsg(fmt(a.share.saved, { name: fileName }));
  };
  const openAiFile = async (text) => {
    const setup = await decodeSetup(text);
    if (setup) adoptShared(setup);
    else setShareMsg(a.share.notAi);
  };
  // a link with #ai=...: the AI it carries is offered (not used without asking)
  useEffect(() => {
    if (!/#ai=TAI1\./.test(window.location.hash)) return;
    decodeSetup(window.location.hash).then((setup) => { if (setup) setOffer(setup); });
    try { window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch { /* the address stays */ }
  }, []);

  const keyState = useRef({});
  keyState.current = { snap, online, send, ai: program === 'ai', lab };
  useEffect(() => {
    const on = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || e.target?.isContentEditable) return;
      const { snap: s, online: ok, send: go, ai, lab: l } = keyState.current;
      if (e.key === 'd' || e.key === 'D') { setSettings((v) => !v); return; }
      if (ok && ai && e.key === ' ') { e.preventDefault(); l.toggleAuto(); return; }        // as in AlphAI: the space bar
      if (!ok || ai) return;
      if (e.key === ' ') { e.preventDefault(); go({ command: s.state === 'pause' ? CMD.RESUME : CMD.PAUSE }); }
      else if (e.key === 'g' || e.key === 'G') go({ command: s.learning ? CMD.FREEZE : CMD.LEARN });
      else if (e.key === '0') go({ command: CMD.RESET });
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  // the network is turned a quarter turn when its box is narrow
  const [netRef, { width: netWidth }] = useSize({ width: 800, height: 500 });
  const vertical = netWidth < 600;
  const wide = useMedia('(min-width: 1001px)');                // the controls are in the top bar on a wide screen, a tab of their own on a narrow one

  const link = snap.link;
  const lost = live && (link.status === 'disconnected' || link.status === 'reconnect') && !connecting.current;
  // (starting: the program is being installed and started, which takes a few seconds the first time; ended: it said hello, then stopped)
  const starting = live && link.status === 'connected' && !snap.running && !snap.error && started.current && !snap.greeted;
  const modeEnded = live && link.status === 'connected' && !snap.running && snap.greeted;
  const enabled = online;
  const brainNow = snap.weights;
  const isAi = program === 'ai';
  const tabs = isAi
    ? ['lab', 'setup']                                                                     // the arena is in the lab
    : (live ? ['net', 'settings', 'curves'] : ['net', 'settings', 'curves', 'arena']);       // the real robot has no arena
  const shownTab = tabs.includes(tab) ? tab : tabs[0];
  const tabName = (id) => (isAi ? a.tabs[id] : t.tabs[id]);

  return (
    <div className={`app tab-${shownTab}`}>
      <div className="topbar">
        <header className="top">
          <div className="brand">
            <button type="button" className="app-icon" onClick={() => setSettings(true)} aria-label={t.head.diag} title={`${t.head.diag} (D)`} aria-haspopup="dialog">
              <img src="icon.svg" alt="" width="32" height="32" />
            </button>
            <div>
              <h1>{t.app.title}</h1>
              <p>{program === 'ai' ? a.appSubtitle : t.app.subtitle}</p>
            </div>
          </div>
          <div className="top-mid">
            <div className="seg program" role="group" aria-label={a.program.label}>
              <button type="button" className={!isAi ? 'on' : ''} aria-pressed={!isAi} title={a.program.annHint} onClick={() => chooseProgram('ann')}>{a.program.ann}</button>
              <button type="button" className={isAi ? 'on' : ''} aria-pressed={isAi} title={a.program.aiHint} onClick={() => chooseProgram('ai')}>{a.program.ai}</button>
            </div>
            <div className="seg source" role="group" aria-label={t.head.source}>
              <button type="button" className={!live ? 'on' : ''} aria-pressed={!live} onClick={() => live && disconnect()}>{t.head.virtual}</button>
              <button type="button" className={live ? 'on' : ''} aria-pressed={live} onClick={() => !live && connect()}>{t.head.real}</button>
            </div>
            {live && <LinkInfo t={t} link={link} battery={snap.battery} />}
          </div>
          <div className="top-end">
            {live && link.status === 'connected' && <button type="button" className="btn small" onClick={disconnect}>{t.head.disconnect}</button>}
            {!live && bluetooth && <button type="button" className="btn small hide-narrow" onClick={connect}><BluetoothIcon size={16} />{t.head.connect}</button>}
            <button type="button" className="icon-btn bar-btn" onClick={isAi ? showAiQr : showQr} aria-label={isAi ? a.share.qr : t.qr.show} title={isAi ? a.share.qr : t.qr.show}><QrIcon /></button>
            <button type="button" className="icon-btn bar-btn scan" onClick={scanQr} disabled={!isAi && !enabled} aria-label={isAi ? a.share.scan : t.qr.scan} title={isAi ? a.share.scan : t.qr.scan}><ScanIcon /></button>
            <button type="button" className="icon-btn bar-btn" onClick={() => setHelp(true)} aria-label={t.head.help} title={t.head.help}><HelpIcon /></button>
          </div>
        </header>
        {wide && !isAi && <ControlBar t={t} state={snap.state} learning={snap.learning} params={snap.params} enabled={enabled} live={snap.live} onChange={send} onPreset={applyPreset} />}
      </div>

      {(lost || modeEnded || notice || snap.error || starting || snap.live.giveUp) && (
        <div className="banner" role="alert">
          <WarnIcon size={18} />
          <span>
            {lost ? t.head.lost : modeEnded ? (isAi ? a.ended : t.head.ended) : starting ? (isAi ? a.starting : t.head.starting) : snap.live.giveUp ? t.ctl.gaveUp : notice || snap.error}
          </span>
          {lost && <button type="button" className="btn small" onClick={connect}>{t.head.retry}</button>}
          {(modeEnded || snap.live.giveUp) && <button type="button" className="btn small" onClick={restartMode}>{t.head.restart}</button>}
          {!lost && !modeEnded && !starting && (notice || snap.error) && <button type="button" className="btn small" onClick={() => { setNotice(''); tele.current.push({ type: 'error', message: '' }); }}>OK</button>}
        </div>
      )}

      {offer && (
        <div className="banner offer" role="alert">
          <span>{fmt(a.share.offer, { what: describe(offer) })}</span>
          <button type="button" className="btn small primary" onClick={() => { adoptShared(offer); setOffer(null); }}>{a.share.use}</button>
          <button type="button" className="btn small" onClick={() => setOffer(null)}>{a.share.ignore}</button>
        </div>
      )}

      <main>
        {isAi ? (
          <div className="col main">
            {/* the lab and the virtual arena side by side (one above the other on narrow screens), so that you watch the robot while you teach it */}
            <div className={`ai-stage ${live ? '' : 'with-arena'}`} data-tab="lab">
              <AiLab a={a} snap={snap} enabled={enabled} lab={lab} speed={aiSettings.maxSpeed} onSpeed={(v) => changeAiSettings({ maxSpeed: v })} onPreset={applyActivity} />
              {!live && <div className="ai-stage-arena"><Arena t={t} sim={sim.current} speed={simSpeed} onSpeed={setSimSpeed} hit={null} foldable={false} compact /></div>}
            </div>
            <div data-tab="setup">
              <div className="ai-setup">
                <AiSensorSettings a={a} lab={lab} foldable={wide} />
                <AiActionSettings a={a} selected={aiSelected} onSelect={chooseActions} settings={aiSettings} onSettings={changeAiSettings} enabled={enabled} foldable={wide} />
                <AiBrainSettings a={a} lab={lab} onPreset={applyActivity} foldable={wide} />
                <AiShare a={a} onSaveFile={saveAiFile} onOpenFile={openAiFile} onCopyLink={copyAiLink} onShowQr={showAiQr} onScan={scanQr} message={shareMsg} foldable={wide} />
              </div>
            </div>
          </div>
        ) : (
        <div className="col main">
          <section className="card net-card" data-tab="net" aria-label={t.net.title}>
            <header className="card-head net-head">
              <div>
                <h2>{t.net.title}</h2>
                <p className="muted small">{t.net.subtitle}</p>
              </div>
              <CycleStrip t={t} state={snap.running ? snap.state : 'pause'} learning={!snap.running || snap.learning} learnt={snap.learnt} hits={snap.hits} lessons={snap.lessons} />
            </header>
            <div ref={netRef} className="net-wrap">
              <Network
                t={t} weights={brainNow} prox={snap.prox} motors={snap.motors} bases={[snap.params.baseLeft, snap.params.baseRight]} state={snap.running ? snap.state : 'pause'} hit={snap.lastHit} now={snap.t} changed={snap.changed}
                enabled={enabled} onSetWeight={setWeight} onSetBase={setBase} vertical={vertical}
              />
            </div>
            <ul className="net-legend">
              <li><svg width="34" height="14" aria-hidden="true"><path d="M2,7 H22" className="l-pos" /><path d="M20,2 L30,7 L20,12 Z" className="c-pos" /></svg>{t.net.legendPos}</li>
              <li><svg width="34" height="14" aria-hidden="true"><path d="M2,7 H22" className="l-neg" /><path d="M20,2 L30,7 L20,12 Z" className="c-neg" /></svg>{t.net.legendNeg}</li>
              <li><svg width="34" height="22" aria-hidden="true"><path d="M2,11 L32,1 A32,32 0 0 1 32,21 Z" className="l-cone" /><circle cx="4" cy="11" r="3.5" className="l-cone-dot" /></svg>{t.net.legendCone}</li>
              <li><svg width="34" height="22" aria-hidden="true" className="l-base"><rect x="3" y="2" width="28" height="18" rx="9" /><text x="17" y="12" textAnchor="middle" dominantBaseline="central">1</text></svg>{t.net.legendBase}</li>
            </ul>
            <p className="muted small formula">{t.net.formula} {t.net.pick}</p>
            <LearningRule t={t} step={snap.params.step} forget={snap.params.forget} />
          </section>

          {!wide && (
            <div data-tab="settings">
              <ControlBar t={t} state={snap.state} learning={snap.learning} params={snap.params} enabled={enabled} live={snap.live} onChange={send} onPreset={applyPreset} inPage />
            </div>
          )}

          {!live && <div data-tab="arena"><Arena t={t} sim={sim.current} speed={simSpeed} onSpeed={setSimSpeed} hit={snap.lastHit} foldable={wide} /></div>}

          <div data-tab="curves"><Timeline t={t} hist={snap.hist} now={snap.t} t0={snap.t0} foldable={wide} /></div>
        </div>
        )}

      </main>

      <nav className="tabbar" aria-label="Sections">
        {tabs.map((id) => (
          <button key={id} type="button" className={shownTab === id ? 'on' : ''} aria-pressed={shownTab === id} onClick={() => setTab(id)}>{tabName(id)}</button>
        ))}
      </nav>

      {qr && qr.show !== undefined && <QrShow text={qr.show} t={t} label={qr.link ? { web: t.qr.link, ios: t.qr.linkIos }[qr.link] : t.qr.show} caption={qr.caption} onClose={() => setQr(null)} />}
      {qr && qr.scan && <QrScan t={t} onText={applyScanned} onClose={() => setQr(null)} />}
      {help && <Help t={t} onClose={() => { setHelp(false); save('learn.help', '1'); }} />}
      {settings && (
        <Settings
          t={t} lang={lang} onLang={setLang} theme={theme} onTheme={setTheme} link={link} battery={snap.battery} running={snap.running} lastError={snap.error}
          name={name} onName={(v) => setName(cleanName(v))} onNewName={() => setName(randomName())} showName={showName} onShowName={chooseShowName} onShowLink={showLink}
          log={log} onClearLog={() => setLog([])} onTest={selfTest} testing={testing} canTest={live && link.status === 'connected'} onClose={() => setSettings(false)} bluetooth={bluetooth}
        />
      )}
    </div>
  );
}

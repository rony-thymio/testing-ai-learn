// Sharing a trained AI: everything another device needs to drive its robot the same way without teaching it again (the sensors,
// the actions and how they are carried out, the kind of learning, the examples and the network itself), as
//   a file      (JSON, to keep, to send, to put on a shared drive),
//   a code      "TAI1.<base64url of the deflated JSON>", short enough for a link (#ai=<code>) or a QR code.
// The robot keeps nothing: the AI is in the page, and any robot connected to the page drives with it.

export const FORMAT = 'thymio-ai-lab';
const PREFIX = 'TAI1.';
// `setup`: { sensors, ai, actions, actionSettings, examples, network, name? } -> what is saved. `digits`: the decimals kept of the
// weights of the network (3 in a file; 2 in a code, to keep it short: the choices of the network do not change).
export function packSetup(setup, digits = 3) {
  const k = 10 ** digits;
  const ROUND = (v) => Math.round(v * k) / k;
  return {
    format: FORMAT,
    version: 1,
    name: setup.name || '',
    saved: new Date().toISOString(),
    sensors: setup.sensors,
    ai: setup.ai,
    actions: setup.actions,
    actionSettings: setup.actionSettings,
    examples: (setup.examples || []).map((e) => ({ prox: e.prox.map(Math.round), ground: e.ground.map(Math.round), action: e.action })),
    network: setup.network ? { ...setup.network, W: setup.network.W.map((m) => m.map((r) => r.map(ROUND))), b: setup.network.b.map((r) => r.map(ROUND)) } : null,
  };
}

// What was saved -> a setup, or null when it is not one of ours (or not readable).
export function unpackSetup(data) {
  if (!data || data.format !== FORMAT || typeof data.sensors !== 'object' || typeof data.ai !== 'object' || !Array.isArray(data.actions)) return null;
  const ints = (a, n) => Array.isArray(a) && a.length >= n && a.slice(0, n).every((v) => Number.isFinite(Number(v)));
  return {
    name: String(data.name || ''),
    saved: data.saved || '',
    sensors: data.sensors,
    ai: { ...data.ai, hidden: Array.isArray(data.ai.hidden) ? data.ai.hidden.map(Number).filter((n) => n > 0).slice(0, 4) : [] },
    actions: data.actions.map(Number).filter(Number.isInteger),
    actionSettings: data.actionSettings || {},
    examples: Array.isArray(data.examples) ? data.examples.filter((e) => ints(e?.prox, 7) && ints(e?.ground, 2) && Number.isInteger(e?.action)) : [],
    network: data.network && Array.isArray(data.network.W) ? data.network : null,
  };
}

// ---- the code: deflated, then base64url -----------------------------------------------------------------------------------
async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}
const toB64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64 = (text) => {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

export async function encodeSetup(setup) {
  const json = new TextEncoder().encode(JSON.stringify(packSetup(setup, 2)));
  return PREFIX + toB64(await pipe(json, new CompressionStream('deflate-raw')));
}

// A code, a link with #ai=<code>, or the text of a file -> a setup, or null.
export async function decodeSetup(text) {
  const s = String(text || '').trim();
  try {
    if (s.startsWith('{')) return unpackSetup(JSON.parse(s));
    const m = /(?:#ai=|^)(TAI1\.[A-Za-z0-9_-]+)/.exec(s);
    if (!m) return null;
    const bytes = await pipe(fromB64(m[1].slice(PREFIX.length)), new DecompressionStream('deflate-raw'));
    return unpackSetup(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

export const isAiCode = (text) => /(?:#ai=|^\s*)TAI1\./.test(String(text || '')) || /"format"\s*:\s*"thymio-ai-lab"/.test(String(text || ''));
export const linkFor = (code, base) => `${base.split('#')[0]}#ai=${code}`;
// A QR code holds about 2300 characters; above 1800 it gets too dense to scan from a screen.
export const QR_LIMIT = 1800;

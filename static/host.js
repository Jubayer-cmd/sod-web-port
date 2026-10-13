// Browser side of the port. The compiled game (sod.js) talks to this object only, through
// the @JSBody natives in sodweb/Host.java.
import { KEYMAP } from './keymap.js';
import { MidiSynth } from './midi.js';

const W = 240;
const H = 320;

let display = null;
const frame32 = new Uint32Array(W * H);
const frameBytes = new Uint8Array(frame32.buffer);
let canvasEl = null;
let audio = null;
let synth = null;
const queue = [];
const lifecycle = [];

const textCanvas = document.createElement('canvas');
const textCtx = textCanvas.getContext('2d', { willReadFrequently: true });

const players = new Map();
let nextPlayerId = 1;

function push(type, a = 0, b = 0) {
  queue.push([type, a, b]);
}

function toScreen(ev) {
  const r = canvasEl.getBoundingClientRect();
  return [
    Math.floor(((ev.clientX - r.left) / r.width) * W),
    Math.floor(((ev.clientY - r.top) / r.height) * H),
  ];
}

const SODHost = {
  eventA: 0,
  eventB: 0,

  init(canvas, audioContext, out) {
    canvasEl = canvas;
    display = out;
    audio = audioContext;
    synth = new MidiSynth(audio);

    const held = new Set();
    window.addEventListener('keydown', (e) => {
      const code = KEYMAP[e.code];
      if (code === undefined) return;
      e.preventDefault();
      if (held.has(e.code)) return; // MIDP has no auto-repeat on keyPressed
      held.add(e.code);
      push(1, code);
    });
    window.addEventListener('keyup', (e) => {
      const code = KEYMAP[e.code];
      if (code === undefined) return;
      e.preventDefault();
      held.delete(e.code);
      push(2, code);
    });
    window.addEventListener('blur', () => {
      for (const k of held) push(2, KEYMAP[k]);
      held.clear();
    });

    let down = false;
    canvas.addEventListener('pointerdown', (e) => {
      down = true;
      canvas.setPointerCapture(e.pointerId);
      push(3, ...toScreen(e));
    });
    canvas.addEventListener('pointermove', (e) => {
      if (down) push(5, ...toScreen(e));
    });
    const up = (e) => {
      if (!down) return;
      down = false;
      push(4, ...toScreen(e));
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);

    document.addEventListener('visibilitychange', () => {
      lifecycle.push(document.hidden ? 6 : 7);
    });
  },

  // ---- video ----
  present(px, w, h) {
    // Java ARGB int -> little-endian RGBA bytes (ABGR as uint32)
    const n = w * h;
    for (let i = 0; i < n; i++) {
      const c = px[i];
      frame32[i] = 0xff000000 | ((c & 0xff) << 16) | (c & 0xff00) | ((c >> 16) & 0xff);
    }
    display.draw(frameBytes);
  },

  // On-screen buttons feed the same queue as the keyboard.
  pressKey(code) {
    push(1, code);
  },

  releaseKey(code) {
    push(2, code);
  },

  // ---- input ----
  pollEvent() {
    const e = queue.shift();
    if (!e) return 0;
    this.eventA = e[1];
    this.eventB = e[2];
    return e[0];
  },

  pollLifecycle() {
    return lifecycle.shift() ?? 0;
  },

  // ---- text ----
  measureText(text, font) {
    textCtx.font = font;
    return Math.ceil(textCtx.measureText(text).width);
  },

  rasterText(text, font) {
    textCtx.font = font;
    const m = textCtx.measureText(text);
    const ascent = Math.ceil(m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent);
    const descent = Math.ceil(m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent);
    const width = Math.max(1, Math.ceil(m.width));
    const height = Math.max(1, ascent + descent);
    if (textCanvas.width < width || textCanvas.height < height) {
      textCanvas.width = Math.max(textCanvas.width, width);
      textCanvas.height = Math.max(textCanvas.height, height);
    }
    textCtx.clearRect(0, 0, textCanvas.width, textCanvas.height);
    textCtx.font = font;
    textCtx.fillStyle = '#fff';
    textCtx.textBaseline = 'alphabetic';
    textCtx.fillText(text, 0, ascent);
    const rgba = textCtx.getImageData(0, 0, width, height).data;
    const alpha = new Uint8Array(width * height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
    return { width, height, ascent, alpha };
  },

  // ---- audio ----
  audioCreate(data, type) {
    const bytes = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    const id = nextPlayerId++;
    const p = { type, bytes, buffer: null, source: null, endsAt: 0, loops: 1, pendingStart: false };
    if (type.includes('midi')) {
      p.song = synth.parse(bytes);
    } else {
      audio.decodeAudioData(bytes.buffer.slice(0)).then((buf) => {
        p.buffer = buf;
        if (p.pendingStart) SODHost.audioStart(id, p.loops);
      }).catch(() => {});
    }
    players.set(id, p);
    return id;
  },

  audioStart(id, loops) {
    const p = players.get(id);
    if (!p) return;
    SODHost.audioStop(id);
    p.loops = loops;
    if (p.song) {
      p.handle = synth.play(p.song, loops);
      return;
    }
    if (!p.buffer) {
      p.pendingStart = true;
      return;
    }
    p.pendingStart = false;
    const src = audio.createBufferSource();
    src.buffer = p.buffer;
    src.loop = loops < 0 || loops > 1;
    src.connect(audio.destination);
    src.start();
    if (loops > 1) src.stop(audio.currentTime + p.buffer.duration * loops);
    p.source = src;
    p.endsAt = loops < 0 ? Infinity : audio.currentTime + p.buffer.duration * Math.max(1, loops);
  },

  audioStop(id) {
    const p = players.get(id);
    if (!p) return;
    p.pendingStart = false;
    if (p.handle) {
      p.handle.stop();
      p.handle = null;
    }
    if (p.source) {
      try { p.source.stop(); } catch (e) { /* already stopped */ }
      p.source = null;
      p.endsAt = 0;
    }
  },

  audioClose(id) {
    SODHost.audioStop(id);
    players.delete(id);
  },

  audioPlaying(id) {
    const p = players.get(id);
    if (!p) return false;
    if (p.pendingStart) return true;
    if (p.handle) return p.handle.playing();
    return audio.currentTime < p.endsAt;
  },

  exit() {
    for (const id of [...players.keys()]) SODHost.audioClose(id);
    document.body.classList.add('exited');
  },
};

window.SODHost = SODHost;
export default SODHost;

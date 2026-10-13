// Minimal Standard MIDI File player on WebAudio oscillators. Handsets of the era rendered
// these tracks on tiny wavetable chips, so a light chiptune-style voice set is in keeping.

const DRUM_CHANNEL = 9;

function readVar(d, p) {
  let v = 0;
  let b;
  do {
    b = d[p.i++];
    v = (v << 7) | (b & 0x7f);
  } while (b & 0x80);
  return v;
}

function voiceFor(program) {
  if (program >= 32 && program <= 39) return { type: 'triangle', gain: 0.32, release: 0.06 }; // bass
  if (program >= 40 && program <= 51) return { type: 'sawtooth', gain: 0.09, release: 0.25 }; // strings
  if (program >= 52 && program <= 55) return { type: 'sine', gain: 0.18, release: 0.3 };      // choir
  if (program >= 56 && program <= 79) return { type: 'square', gain: 0.08, release: 0.12 };   // brass/reed/pipe
  if (program >= 88 && program <= 103) return { type: 'sine', gain: 0.16, release: 0.4 };     // pads
  if (program <= 7) return { type: 'triangle', gain: 0.2, release: 0.3 };                     // piano
  return { type: 'square', gain: 0.08, release: 0.1 };
}

export class MidiSynth {
  constructor(ctx) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 0.3;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
  }

  // Returns { notes: [{t, dur, ch, note, vel, program}], length } in seconds.
  parse(d) {
    const tag = (p) => String.fromCharCode(d[p], d[p + 1], d[p + 2], d[p + 3]);
    if (tag(0) !== 'MThd') return { notes: [], length: 0 };
    const ntracks = (d[10] << 8) | d[11];
    const division = (d[12] << 8) | d[13];
    let p = 8 + ((d[4] << 24) | (d[5] << 16) | (d[6] << 8) | d[7]);

    // Gather every event with its absolute tick across all tracks.
    const events = [];
    for (let t = 0; t < ntracks && p + 8 <= d.length; t++) {
      const len = (d[p + 4] << 24) | (d[p + 5] << 16) | (d[p + 6] << 8) | d[p + 7];
      const end = p + 8 + len;
      const ptr = { i: p + 8 };
      let tick = 0;
      let status = 0;
      while (ptr.i < end) {
        tick += readVar(d, ptr);
        let b = d[ptr.i];
        if (b & 0x80) {
          status = b;
          ptr.i++;
        }
        const type = status & 0xf0;
        const chn = status & 0x0f;
        if (status === 0xff) {
          const meta = d[ptr.i++];
          const mlen = readVar(d, ptr);
          if (meta === 0x51) {
            events.push({ tick, kind: 'tempo', us: (d[ptr.i] << 16) | (d[ptr.i + 1] << 8) | d[ptr.i + 2] });
          }
          ptr.i += mlen;
        } else if (status === 0xf0 || status === 0xf7) {
          ptr.i += readVar(d, ptr);
        } else if (type === 0x90 || type === 0x80) {
          const note = d[ptr.i++];
          const vel = d[ptr.i++];
          events.push({ tick, kind: type === 0x90 && vel > 0 ? 'on' : 'off', ch: chn, note, vel });
        } else if (type === 0xc0) {
          events.push({ tick, kind: 'program', ch: chn, program: d[ptr.i++] });
        } else if (type === 0xd0) {
          ptr.i += 1;
        } else {
          ptr.i += 2; // A0, B0, E0
        }
      }
      p = end;
    }
    events.sort((a, b) => a.tick - b.tick);

    // Convert ticks to seconds honouring tempo changes, pairing note-on/off.
    let usPerBeat = 500000;
    let lastTick = 0;
    let time = 0;
    const programs = new Array(16).fill(0);
    const open = new Map();
    const notes = [];
    for (const e of events) {
      time += ((e.tick - lastTick) * usPerBeat) / division / 1e6;
      lastTick = e.tick;
      if (e.kind === 'tempo') usPerBeat = e.us;
      else if (e.kind === 'program') programs[e.ch] = e.program;
      else if (e.kind === 'on') {
        open.set(e.ch * 128 + e.note, { t: time, ch: e.ch, note: e.note, vel: e.vel, program: programs[e.ch] });
      } else {
        const n = open.get(e.ch * 128 + e.note);
        if (n) {
          n.dur = Math.max(0.03, time - n.t);
          notes.push(n);
          open.delete(e.ch * 128 + e.note);
        }
      }
    }
    return { notes, length: time };
  }

  // loops: -1 forever, otherwise play count. Returns { stop(), playing() }.
  play(song, loops) {
    const ctx = this.ctx;
    const bus = ctx.createGain();
    bus.connect(this.master);
    let stopped = false;
    let remaining = loops < 0 ? Infinity : Math.max(1, loops);
    let endsAt = 0;
    let timer = 0;

    const schedule = (start) => {
      for (const n of song.notes) this.voice(bus, start + n.t, n);
      endsAt = start + song.length;
      remaining--;
      if (remaining > 0 && song.length > 0) {
        // Queue the next pass shortly before this one ends.
        timer = setTimeout(() => {
          if (!stopped) schedule(endsAt);
        }, Math.max(0, (endsAt - ctx.currentTime - 0.5) * 1000));
      }
    };
    schedule(ctx.currentTime + 0.05);

    return {
      stop() {
        stopped = true;
        clearTimeout(timer);
        bus.gain.setValueAtTime(0, ctx.currentTime);
        setTimeout(() => bus.disconnect(), 50);
      },
      playing() {
        return !stopped && (remaining > 0 || ctx.currentTime < endsAt);
      },
    };
  }

  voice(bus, t, n) {
    const ctx = this.ctx;
    const amp = (n.vel / 127) ** 1.5;
    const g = ctx.createGain();
    g.connect(bus);
    if (n.ch === DRUM_CHANNEL) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      const kick = n.note <= 36;
      f.type = kick ? 'lowpass' : n.note >= 42 ? 'highpass' : 'bandpass';
      f.frequency.value = kick ? 180 : n.note >= 42 ? 7000 : 1800;
      src.connect(f);
      f.connect(g);
      const len = kick ? 0.18 : n.note >= 42 ? 0.05 : 0.12;
      g.gain.setValueAtTime(amp * (kick ? 0.9 : 0.35), t);
      g.gain.exponentialRampToValueAtTime(0.001, t + len);
      src.start(t);
      src.stop(t + len + 0.01);
      return;
    }
    const v = voiceFor(n.program);
    const osc = ctx.createOscillator();
    osc.type = v.type;
    osc.frequency.value = 440 * 2 ** ((n.note - 69) / 12);
    osc.connect(g);
    const peak = v.gain * amp;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.01);
    g.gain.setTargetAtTime(peak * 0.7, t + 0.01, 0.1);
    g.gain.setTargetAtTime(0, t + n.dur, v.release / 3);
    osc.start(t);
    osc.stop(t + n.dur + v.release * 2);
  }
}

// MIDP 2.0 subset (lcdui, media, rms, midlet) in JavaScript, ported from the Java platform
// layer in src/main/java. Talks to the page through SODHost (host.js).
import { $, C, JObject, define, iface, runDue, useExternalClock } from './runtime.js';
import { planMotion } from './smooth.js';
import { decodePng } from './png.js';
import './cldc.js';

const S = 'Ljava/lang/String;';
const W = 240;
const H = 320;
let host = null;
let config = { resolveOk: () => -6, props: new Map() };

/** Wires the MIDP layer to the page. */
export function configure(sodHost, options) {
  host = sodHost;
  config = { ...config, ...options };
}

const VK_OK = 1000;
const EV = { NONE: 0, KEY_DOWN: 1, KEY_UP: 2, POINTER_DOWN: 3, POINTER_UP: 4, POINTER_DRAG: 5, HIDE: 6, SHOW: 7 };

// ------------------------------------------------------------------ Font

class Font extends JObject {
  constructor() {
    super();
    this._face = 0;
    this._style = 0;
    this._size = 0;
    this._px = 13;
    this._css = '';
  }
  static _make(face, style, size) {
    const f = new Font();
    f._face = face;
    f._style = style;
    f._size = size;
    f._px = size === 8 ? 11 : size === 16 ? 15 : 13;
    const family = face === 32 ? 'monospace' : 'Arial, Helvetica, sans-serif';
    f._css = `${style & 2 ? 'italic ' : ''}${style & 1 ? 'bold ' : ''}${f._px}px ${family}`;
    return f;
  }
  static ['getDefaultFont()Ljavax/microedition/lcdui/Font;']() { return DEFAULT_FONT; }
  static ['getFont(III)Ljavax/microedition/lcdui/Font;'](face, style, size) { return Font._make(face, style, size); }
  ['getHeight()I']() { return this._px + 3; }
  ['getBaselinePosition()I']() { return this._px; }
  ['getFace()I']() { return this._face; }
  ['getStyle()I']() { return this._style; }
  ['getSize()I']() { return this._size; }
  [`stringWidth(${S})I`](s) { return host.measureText(s, this._css); }
  ['charWidth(C)I'](c) { return host.measureText(String.fromCharCode(c), this._css); }
  [`substringWidth(${S}II)I`](s, o, n) { return host.measureText(s.substring(o, o + n), this._css); }
}
define('javax/microedition/lcdui/Font', Font);
const DEFAULT_FONT = Font._make(0, 0, 0);

// ------------------------------------------------------------------ Image

let imageSeq = 0;
class Image extends JObject {
  constructor() {
    super();
    this._w = 0;
    this._h = 0;
    this._px = null;
    this._mutable = false;
    this._id = ++imageSeq;
  }
  static _of(w, h, px, mutable) {
    const i = new Image();
    i._w = w;
    i._h = h;
    i._px = px;
    i._mutable = mutable;
    return i;
  }
  static ['createImage(II)Ljavax/microedition/lcdui/Image;'](w, h) {
    if (w <= 0 || h <= 0) $.throwNew('java/lang/IllegalArgumentException');
    return Image._of(w, h, new Int32Array(w * h).fill(-1), true); // opaque white
  }
  static ['createImage([BII)Ljavax/microedition/lcdui/Image;'](data, off, len) {
    let r;
    try {
      r = decodePng(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), off, len);
    } catch (e) {
      $.throwNew('java/lang/IllegalArgumentException', String(e.message));
    }
    return Image._of(r.width, r.height, r.argb, false);
  }
  static [`createImage(${S})Ljavax/microedition/lcdui/Image;`](name) {
    const key = name.startsWith('/') ? name.slice(1) : name;
    const data = $.resources.get(key);
    if (!data) $.throwNew('java/io/IOException', `resource not found: ${name}`);
    const r = decodePng(data, 0, data.length);
    return Image._of(r.width, r.height, r.argb, false);
  }
  static ['createImage(Ljavax/microedition/lcdui/Image;)Ljavax/microedition/lcdui/Image;'](src) {
    return src._mutable ? Image._of(src._w, src._h, src._px.slice(), false) : src;
  }
  static ['createRGBImage([IIIZ)Ljavax/microedition/lcdui/Image;'](rgb, w, h, alpha) {
    const px = new Int32Array(w * h);
    if (rgb.length < px.length) $.throwNew('java/lang/ArrayIndexOutOfBoundsException');
    if (alpha) px.set(rgb.subarray(0, px.length));
    else for (let i = 0; i < px.length; i++) px[i] = rgb[i] | 0xff000000;
    return Image._of(w, h, px, false);
  }
  ['getGraphics()Ljavax/microedition/lcdui/Graphics;']() {
    if (!this._mutable) $.throwNew('java/lang/IllegalStateException');
    return new Graphics(this._px, this._w, this._h);
  }
  ['getWidth()I']() { return this._w; }
  ['getHeight()I']() { return this._h; }
  ['isMutable()Z']() { return this._mutable ? 1 : 0; }
  ['getRGB([IIIIIII)V'](out, offset, scan, x, y, w, h) {
    if (x < 0 || y < 0 || x + w > this._w || y + h > this._h) $.throwNew('java/lang/IllegalArgumentException');
    for (let r = 0; r < h; r++) {
      const s = (y + r) * this._w + x;
      out.set(this._px.subarray(s, s + w), offset + r * scan);
    }
  }
}
define('javax/microedition/lcdui/Image', Image);

// ------------------------------------------------------------------ Graphics

// Software renderer on an ARGB Int32Array: exact clip, all 8 drawRegion transforms, alpha.
class Graphics extends JObject {
  constructor(buf, bw, bh) {
    super();
    this._buf = buf;
    this._bw = bw;
    this._bh = bh;
    this._rec = null; // draw-call list while recording a frame for smooth motion
    this._group = null; // sprite being drawn (set by trackSprites hooks)
    this._reset();
  }

  // Records a draw call with the full state it needs, so the frame can be redrawn later
  // with objects moved to in-between positions.
  _record(op, args) {
    const a = Array.prototype.slice.call(args);
    let key = null;
    let x = 0;
    let y = 0;
    if (op === DRAW_REGION) {
      key = `${a[0]._id}:${a[1]}:${a[2]}:${a[3]}:${a[4]}:${a[5]}`;
      x = a[6];
      y = a[7];
    } else if (op === DRAW_IMAGE) {
      key = `${a[0]._id}:img`;
      x = a[1];
      y = a[2];
    } else if (op === DRAW_RGB) {
      // The game may reuse the pixel array for the next call; keep this call's pixels.
      const end = a[1] + a[2] * Math.max(0, a[6] - 1) + a[5];
      if (a[2] >= 0 && end <= a[0].length) {
        a[0] = a[0].slice(a[1], end);
        a[1] = 0;
      }
    }
    this._rec.push({
      op, a, key, x: x + this._tx, y: y + this._ty, g: this._group,
      color: this._color, tx: this._tx, ty: this._ty,
      c0: this._cx0, c1: this._cy0, c2: this._cx1, c3: this._cy1,
      font: this._font, stroke: this._stroke,
    });
  }

  _replay(c, dx, dy) {
    this._color = c.color;
    this._tx = c.tx + dx;
    this._ty = c.ty + dy;
    this._cx0 = c.c0;
    this._cy0 = c.c1;
    this._cx1 = c.c2;
    this._cy1 = c.c3;
    this._font = c.font;
    this._stroke = c.stroke;
    this[c.op](...c.a);
  }
  _reset() {
    this._color = 0xff000000 | 0;
    this._tx = 0;
    this._ty = 0;
    this._cx0 = 0;
    this._cy0 = 0;
    this._cx1 = this._bw;
    this._cy1 = this._bh;
    this._font = DEFAULT_FONT;
    this._stroke = 0;
  }
  ['translate(II)V'](x, y) { this._tx += x; this._ty += y; }
  ['getTranslateX()I']() { return this._tx; }
  ['getTranslateY()I']() { return this._ty; }
  ['setColor(I)V'](rgb) { this._color = 0xff000000 | (rgb & 0xffffff); }
  ['setColor(III)V'](r, g, b) { this['setColor(I)V'](((r & 255) << 16) | ((g & 255) << 8) | (b & 255)); }
  ['getColor()I']() { return this._color & 0xffffff; }
  ['setFont(Ljavax/microedition/lcdui/Font;)V'](f) { this._font = f ?? DEFAULT_FONT; }
  ['getFont()Ljavax/microedition/lcdui/Font;']() { return this._font; }
  ['setStrokeStyle(I)V'](s) { this._stroke = s; }
  ['setClip(IIII)V'](x, y, w, h) {
    x += this._tx;
    y += this._ty;
    this._cx0 = Math.max(0, x);
    this._cy0 = Math.max(0, y);
    this._cx1 = Math.min(this._bw, x + w);
    this._cy1 = Math.min(this._bh, y + h);
  }
  ['clipRect(IIII)V'](x, y, w, h) {
    x += this._tx;
    y += this._ty;
    this._cx0 = Math.max(this._cx0, x);
    this._cy0 = Math.max(this._cy0, y);
    this._cx1 = Math.min(this._cx1, x + w);
    this._cy1 = Math.min(this._cy1, y + h);
  }
  ['getClipX()I']() { return this._cx0 - this._tx; }
  ['getClipY()I']() { return this._cy0 - this._ty; }
  ['getClipWidth()I']() { return Math.max(0, this._cx1 - this._cx0); }
  ['getClipHeight()I']() { return Math.max(0, this._cy1 - this._cy0); }

  _plot(x, y) {
    if (x >= this._cx0 && x < this._cx1 && y >= this._cy0 && y < this._cy1) this._buf[y * this._bw + x] = this._color;
  }
  _hspan(x0, x1, y) {
    if (y < this._cy0 || y >= this._cy1) return;
    if (x0 < this._cx0) x0 = this._cx0;
    if (x1 > this._cx1) x1 = this._cx1;
    if (x0 < x1) this._buf.fill(this._color, y * this._bw + x0, y * this._bw + x1);
  }
  ['fillRect(IIII)V'](x, y, w, h) {
    if (this._rec) return this._record('fillRect(IIII)V', arguments);
    if (w <= 0 || h <= 0) return;
    x += this._tx;
    y += this._ty;
    const y1 = Math.min(this._cy1, y + h);
    for (let yy = Math.max(this._cy0, y); yy < y1; yy++) this._hspan(x, x + w, yy);
  }
  ['drawRect(IIII)V'](x, y, w, h) {
    if (w < 0 || h < 0) return;
    const L = 'drawLine(IIII)V';
    this[L](x, y, x + w, y);
    this[L](x, y + h, x + w, y + h);
    this[L](x, y, x, y + h);
    this[L](x + w, y, x + w, y + h);
  }
  ['fillRoundRect(IIIIII)V'](x, y, w, h) { this['fillRect(IIII)V'](x, y, w, h); }
  ['drawRoundRect(IIIIII)V'](x, y, w, h) { this['drawRect(IIII)V'](x, y, w, h); }
  ['drawLine(IIII)V'](x0, y0, x1, y1) {
    if (this._rec) return this._record('drawLine(IIII)V', arguments);
    x0 += this._tx; y0 += this._ty; x1 += this._tx; y1 += this._ty;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; ; n++) {
      if (this._stroke === 0 || (n & 2) === 0) this._plot(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  ['fillTriangle(IIIIII)V'](x1, y1, x2, y2, x3, y3) {
    if (this._rec) return this._record('fillTriangle(IIIIII)V', arguments);
    const t = this._tx;
    const u = this._ty;
    const [[ax, ay], [bx, by], [cx, cy]] = [[x1 + t, y1 + u], [x2 + t, y2 + u], [x3 + t, y3 + u]]
      .sort((a, b) => a[1] - b[1]);
    const edge = (xa, ya, xb, yb, y) => (yb === ya ? xa : xa + Math.trunc(((xb - xa) * (y - ya)) / (yb - ya)));
    for (let y = ay; y <= cy; y++) {
      let xa = edge(ax, ay, cx, cy, y);
      let xb = y < by ? edge(ax, ay, bx, by, y) : edge(bx, by, cx, cy, y);
      if (xa > xb) [xa, xb] = [xb, xa];
      this._hspan(xa, xb + 1, y);
    }
  }
  ['fillArc(IIIIII)V'](x, y, w, h, s, a) {
    if (this._rec) return this._record('fillArc(IIIIII)V', arguments); this._arc(x, y, w, h, s, a, true); }
  ['drawArc(IIIIII)V'](x, y, w, h, s, a) {
    if (this._rec) return this._record('drawArc(IIIIII)V', arguments); this._arc(x, y, w, h, s, a, false); }
  _arc(x, y, w, h, start, sweep, fill) {
    if (w <= 0 || h <= 0) return;
    x += this._tx;
    y += this._ty;
    if (sweep < 0) { start += sweep; sweep = -sweep; }
    const full = sweep >= 360;
    start = ((start % 360) + 360) % 360;
    const rx = w / 2;
    const ry = h / 2;
    const ccx = x + rx;
    const ccy = y + ry;
    for (let py = y; py <= y + h; py++) {
      for (let px = x; px <= x + w; px++) {
        const nx = (px + 0.5 - ccx) / (rx + 0.5);
        const ny = (py + 0.5 - ccy) / (ry + 0.5);
        if (nx * nx + ny * ny > 1) continue;
        if (!fill && rx > 1 && ry > 1) {
          const ix = (px + 0.5 - ccx) / (rx - 0.5);
          const iy = (py + 0.5 - ccy) / (ry - 0.5);
          if (ix * ix + iy * iy < 1) continue;
        }
        if (!full) {
          let a = Math.round((Math.atan2(-ny, nx) * 180) / Math.PI);
          a = (((a - start) % 360) + 360) % 360;
          if (a > sweep) continue;
        }
        this._plot(px, py);
      }
    }
  }

  ['drawImage(Ljavax/microedition/lcdui/Image;III)V'](img, x, y, anchor) {
    $.nn(img);
    if (this._rec) return this._record('drawImage(Ljavax/microedition/lcdui/Image;III)V', arguments);
    this._region(img, 0, 0, img._w, img._h, 0, x, y, anchor);
  }
  ['drawRegion(Ljavax/microedition/lcdui/Image;IIIIIIII)V'](img, sx, sy, sw, sh, tr, x, y, anchor) {
    $.nn(img);
    if (sx < 0 || sy < 0 || sx + sw > img._w || sy + sh > img._h) $.throwNew('java/lang/IllegalArgumentException', 'region');
    if (this._rec) return this._record('drawRegion(Ljavax/microedition/lcdui/Image;IIIIIIII)V', arguments);
    this._region(img, sx, sy, sw, sh, tr, x, y, anchor);
  }
  _region(img, sx, sy, sw, sh, tr, x, y, anchor) {
    if (sw <= 0 || sh <= 0) return;
    const swap = tr >= 4;
    const dw = swap ? sh : sw;
    const dh = swap ? sw : sh;
    x += this._tx;
    y += this._ty;
    if (anchor & 1) x -= dw >> 1;
    else if (anchor & 8) x -= dw;
    if (anchor & 2) y -= dh >> 1;
    else if (anchor & (32 | 64)) y -= dh;
    const iw = img._w;
    const last = sh - 1;
    const right = sw - 1;
    let start;
    let stepX;
    let stepY;
    switch (tr) {
      case 0: start = sy * iw + sx; stepX = 1; stepY = iw; break;
      case 5: start = (sy + last) * iw + sx; stepX = -iw; stepY = 1; break;
      case 3: start = (sy + last) * iw + sx + right; stepX = -1; stepY = -iw; break;
      case 6: start = sy * iw + sx + right; stepX = iw; stepY = -1; break;
      case 2: start = sy * iw + sx + right; stepX = -1; stepY = iw; break;
      case 7: start = (sy + last) * iw + sx + right; stepX = -iw; stepY = -1; break;
      case 1: start = (sy + last) * iw + sx; stepX = 1; stepY = -iw; break;
      case 4: start = sy * iw + sx; stepX = iw; stepY = 1; break;
      default: $.throwNew('java/lang/IllegalArgumentException', `transform ${tr}`);
    }
    const x0 = Math.max(this._cx0, x);
    const y0 = Math.max(this._cy0, y);
    const x1 = Math.min(this._cx1, x + dw);
    const y1 = Math.min(this._cy1, y + dh);
    if (x0 >= x1 || y0 >= y1) return;
    const s = img._px;
    const buf = this._buf;
    const bw = this._bw;
    for (let yy = y0; yy < y1; yy++) {
      let si = start + (yy - y) * stepY + (x0 - x) * stepX;
      let di = yy * bw + x0;
      for (let xx = x0; xx < x1; xx++, si += stepX, di++) {
        const c = s[si];
        const a = c >>> 24;
        if (a === 255) buf[di] = c;
        else if (a !== 0) buf[di] = blend(buf[di], c, a);
      }
    }
  }
  ['drawRGB([IIIIIIIZ)V'](rgb, offset, scan, x, y, w, h, alpha) {
    if (this._rec) return this._record('drawRGB([IIIIIIIZ)V', arguments);
    x += this._tx;
    y += this._ty;
    const x0 = Math.max(this._cx0, x);
    const y0 = Math.max(this._cy0, y);
    const x1 = Math.min(this._cx1, x + w);
    const y1 = Math.min(this._cy1, y + h);
    const buf = this._buf;
    for (let yy = y0; yy < y1; yy++) {
      let si = offset + (yy - y) * scan + (x0 - x);
      let di = yy * this._bw + x0;
      for (let xx = x0; xx < x1; xx++, si++, di++) {
        const c = rgb[si];
        if (!alpha) buf[di] = c | 0xff000000;
        else {
          const a = c >>> 24;
          if (a === 255) buf[di] = c;
          else if (a !== 0) buf[di] = blend(buf[di], c, a);
        }
      }
    }
  }
  [`drawString(${S}III)V`](str, x, y, anchor) {
    if (str == null || str.length === 0) return;
    if (this._rec) return this._record(`drawString(${S}III)V`, arguments);
    const t = textRaster(str, this._font._css);
    const w = t.width;
    const h = t.height;
    x += this._tx;
    y += this._ty;
    if (anchor & 1) x -= w >> 1;
    else if (anchor & 8) x -= w;
    if (anchor & 64) y -= t.ascent;
    else if (anchor & 32) y -= h;
    const c = this._color;
    for (let r = 0; r < h; r++) {
      const yy = y + r;
      if (yy < this._cy0 || yy >= this._cy1) continue;
      for (let k = 0; k < w; k++) {
        const xx = x + k;
        if (xx < this._cx0 || xx >= this._cx1) continue;
        // Hard threshold keeps the crisp look of a 2008 handset font.
        if (t.alpha[r * w + k] >= 112) this._buf[yy * this._bw + xx] = c;
      }
    }
  }
}
define('javax/microedition/lcdui/Graphics', Graphics);
const DRAW_REGION = 'drawRegion(Ljavax/microedition/lcdui/Image;IIIIIIII)V';
const DRAW_IMAGE = 'drawImage(Ljavax/microedition/lcdui/Image;III)V';
const DRAW_RGB = 'drawRGB([IIIIIIIZ)V';

// Rasterising text in the browser is slow; smooth motion redraws each frame up to 3 times.
const textCache = new Map();
function textRaster(str, css) {
  const k = `${css}|${str}`;
  let t = textCache.get(k);
  if (!t) {
    if (textCache.size > 512) textCache.clear();
    t = host.rasterText(str, css);
    textCache.set(k, t);
  }
  return t;
}

function blend(d, c, a) {
  const ia = 255 - a;
  const r = ((((c >> 16) & 255) * a + ((d >> 16) & 255) * ia) / 255) | 0;
  const g = ((((c >> 8) & 255) * a + ((d >> 8) & 255) * ia) / 255) | 0;
  const b = (((c & 255) * a + (d & 255) * ia) / 255) | 0;
  return 0xff000000 | (r << 16) | (g << 8) | b;
}

// ------------------------------------------------------------------ Display & co.

iface('javax/microedition/lcdui/CommandListener');

class Command extends JObject {
  constructor() {
    super();
    this._label = null;
    this._type = 0;
    this._prio = 0;
  }
  [`<init>(${S}II)V`](label, type, prio) {
    this._label = label;
    this._type = type;
    this._prio = prio;
  }
  [`getLabel()${S}`]() { return this._label; }
  ['getCommandType()I']() { return this._type; }
  ['getPriority()I']() { return this._prio; }
}
define('javax/microedition/lcdui/Command', Command);

let current = null;

class Displayable extends JObject {
  constructor() {
    super();
    this._commands = [];
    this._listener = null;
  }
  ['addCommand(Ljavax/microedition/lcdui/Command;)V'](c) {
    if (!this._commands.includes(c)) this._commands.push(c);
  }
  ['removeCommand(Ljavax/microedition/lcdui/Command;)V'](c) {
    const i = this._commands.indexOf(c);
    if (i >= 0) this._commands.splice(i, 1);
  }
  ['setCommandListener(Ljavax/microedition/lcdui/CommandListener;)V'](l) { this._listener = l; }
  ['getWidth()I']() { return W; }
  ['getHeight()I']() { return H; }
  ['isShown()Z']() { return current === this ? 1 : 0; }
  _shown() {}
  _hidden() {}
}
define('javax/microedition/lcdui/Displayable', Displayable);

class Display extends JObject {
  static ['getDisplay(Ljavax/microedition/midlet/MIDlet;)Ljavax/microedition/lcdui/Display;']() {
    startSystemEvents();
    return DISPLAY;
  }
  ['getCurrent()Ljavax/microedition/lcdui/Displayable;']() { return current; }
  ['setCurrent(Ljavax/microedition/lcdui/Displayable;)V'](next) {
    if (next === current) return;
    const prev = current;
    current = next;
    if (prev) guard(() => prev._hidden());
    if (next) guard(() => next._shown());
  }
  ['vibrate(I)Z']() { return 0; }
  ['flashBacklight(I)Z']() { return 0; }
  ['isColor()Z']() { return 1; }
  ['numColors()I']() { return 65536; }
}
define('javax/microedition/lcdui/Display', Display);
const DISPLAY = new Display();

function guard(fn, what = 'handler') {
  try {
    const r = fn();
    if (r && typeof r.next === 'function') $.runSync(r);
  } catch (e) {
    const j = $.wrap(e);
    console.warn(`[jvm] ${what} threw:`, j['toString()Ljava/lang/String;'](), j._js ?? '');
  }
}

// Show/hide arrive on their own timer, as on a handset's system event thread: the game
// stops repainting while hidden, so they can't go through the frame loop.
let sysTimer = 0;
function startSystemEvents() {
  if (sysTimer) return;
  sysTimer = setInterval(() => {
    let ev;
    while ((ev = host.pollLifecycle()) !== EV.NONE) {
      const d = current;
      if (!d) continue;
      if (ev === EV.HIDE) guard(() => d._hidden(), 'hideNotify');
      else if (ev === EV.SHOW) guard(() => d._shown(), 'showNotify');
    }
  }, 100);
}

// ------------------------------------------------------------------ Canvas

const screen = new Int32Array(W * H);
const screenGraphics = new Graphics(screen, W, H);
let okHeldAs = -6;

const P = 'paint(Ljavax/microedition/lcdui/Graphics;)V';
class Canvas extends Displayable {
  ['<init>()V']() {}
  ['setFullScreenMode(Z)V']() {}
  ['isDoubleBuffered()Z']() { return 1; }
  ['hasPointerEvents()Z']() { return 1; }
  ['hasPointerMotionEvents()Z']() { return 1; }
  ['hasRepeatEvents()Z']() { return 0; }
  ['getGameAction(I)I'](k) {
    switch (k) {
      case -1: case 50: return 1;
      case -2: case 56: return 6;
      case -3: case 52: return 2;
      case -4: case 54: return 5;
      case -5: case 53: return 8;
      case 55: return 9;
      case 57: return 10;
      case 42: return 11;
      case 35: return 12;
      default: return 0;
    }
  }
  ['getKeyCode(I)I'](a) { return { 1: -1, 6: -2, 2: -3, 5: -4, 8: -5 }[a] ?? 0; }
  [`getKeyName(I)${S}`](k) { return String(k); }

  // Synchronous repaint: drain queued input, paint, present. Real handsets serialise input
  // and paint on one event thread too, so input never lands mid-frame.
  ['repaint()V']() {
    if (current !== this) return;
    this._dispatch();
    screenGraphics._reset();
    if (!motion.enabled) {
      guard(() => this[P](screenGraphics), 'paint');
      host.present(screen, W, H);
      return;
    }
    screenGraphics._rec = [];
    try {
      guard(() => this[P](screenGraphics), 'paint');
    } finally {
      screenGraphics._group = null;
    }
    const cmds = screenGraphics._rec;
    screenGraphics._rec = null;
    motion.commit(cmds);
  }
  ['repaint(IIII)V']() { this['repaint()V'](); }
  ['serviceRepaints()V']() {}

  _dispatch() {
    let type;
    while ((type = host.pollEvent()) !== EV.NONE) {
      let a = host.eventA;
      const b = host.eventB;
      switch (type) {
        case EV.KEY_DOWN:
          if (a === VK_OK) a = okHeldAs = config.resolveOk();
          guard(() => this['keyPressed(I)V'](a), 'keyPressed');
          break;
        case EV.KEY_UP:
          // Release what was pressed, even if the screen changed meanwhile.
          guard(() => this['keyReleased(I)V'](a === VK_OK ? okHeldAs : a), 'keyReleased');
          break;
        case EV.POINTER_DOWN: guard(() => this['pointerPressed(II)V'](a, b), 'pointerPressed'); break;
        case EV.POINTER_UP: guard(() => this['pointerReleased(II)V'](a, b), 'pointerReleased'); break;
        case EV.POINTER_DRAG: guard(() => this['pointerDragged(II)V'](a, b), 'pointerDragged'); break;
        default: break;
      }
      // The game polls input once per frame, so a press must survive one paint() before
      // its release is delivered.
      if (type === EV.KEY_DOWN || type === EV.POINTER_DOWN) break;
    }
  }
  _shown() { return this['showNotify()V'](); }
  _hidden() { return this['hideNotify()V'](); }
  [P]() {}
  ['keyPressed(I)V']() {}
  ['keyReleased(I)V']() {}
  ['keyRepeated(I)V']() {}
  ['pointerPressed(II)V']() {}
  ['pointerReleased(II)V']() {}
  ['pointerDragged(II)V']() {}
  ['showNotify()V']() {}
  ['hideNotify()V']() {}
  ['sizeChanged(II)V']() {}
}
define('javax/microedition/lcdui/Canvas', Canvas);

// ------------------------------------------------------------------ smooth motion

// The game updates 20 times a second. With smooth motion on, each frame is recorded as
// draw calls; on every display refresh the latest frame is redrawn with each sprite, tile
// and the camera moved part-way from where they were in the frame before. Game speed and
// logic are untouched; the picture trails the game by one frame (50 ms).
export const motion = {
  enabled: false,
  prev: null,
  curr: null,
  plan: null,
  tickAt: 0,
  interval: 50,
  tick: 0,
  shown: -1,
  looping: false,

  commit(cmds) {
    const now = performance.now();
    const d = now - this.tickAt;
    if (this.curr && d > 20 && d < 120) this.interval = this.interval * 0.8 + d * 0.2;
    this.prev = this.curr;
    this.curr = cmds;
    this.plan = null;
    this.tickAt = now;
    this.tick++;
    if (!this.looping) this.render(now);
  },

  render(now) {
    const cmds = this.curr;
    if (!cmds) return;
    if (!this.plan) this.plan = planMotion(this.prev, cmds);
    const p = this.plan;
    if (!p.moving) {
      if (this.shown === this.tick) return; // nothing moves between frames: draw once
      for (const c of cmds) screenGraphics._replay(c, 0, 0);
    } else {
      const t = Math.min(1, (now - this.tickAt) / this.interval);
      const k = 1 - t;
      let li = 0;
      const left = p.leftovers; // sorted by draw position
      for (let i = 0; i < cmds.length; i++) {
        // Tiles that scrolled off in the newest frame, so the screen edge isn't left bare.
        for (; li < left.length && left[li].at === i; li++) {
          const o = left[li];
          screenGraphics._replay(this.prev[o.j], Math.round(t * o.mx), Math.round(t * o.my));
        }
        screenGraphics._replay(cmds[i], Math.round(-k * p.dx[i]), Math.round(-k * p.dy[i]));
      }
    }
    this.shown = this.tick;
    host.present(screen, W, H);
  },
};

/** Turns smooth (interpolated) motion on or off. */
export function setSmoothMotion(on) {
  motion.enabled = on;
  motion.prev = null;
  motion.curr = null;
}

/**
 * Drives the game from the display refresh: every game frame then lasts the same number
 * of refreshes (3 at 60 Hz) instead of drifting with timer jitter.
 */
export function startFrameLoop() {
  useExternalClock();
  motion.looping = true;
  let last = performance.now();
  let vsync = 1000 / 60;
  const loop = () => {
    const now = performance.now();
    const d = now - last;
    last = now;
    if (d > 4 && d < 40) vsync = vsync * 0.9 + d * 0.1;
    runDue(now + vsync / 2);
    if (motion.enabled) motion.render(performance.now());
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/**
 * Marks calls of a game's own sprite-drawing methods, so every draw call they make is
 * known to belong to one on-screen object. `specs` = [[signature, args => [x, y]], ...]
 * where the function returns the object's anchor from the call's arguments (after the
 * Graphics argument).
 */
export function trackSprites(K, specs) {
  for (const [sig, anchor] of specs) {
    const orig = K.prototype[sig];
    if (typeof orig !== 'function') continue;
    K.prototype[sig] = function (g, ...rest) {
      if (!g || !g._rec || g._group) return orig.call(this, g, ...rest);
      const [ax, ay] = anchor(rest);
      g._group = { s: this, x: ax + g._tx, y: ay + g._ty };
      try {
        return orig.call(this, g, ...rest);
      } finally {
        g._group = null;
      }
    };
  }
}

// ------------------------------------------------------------------ media

iface('javax/microedition/media/Player');
class MediaException extends C['java/lang/Exception'] {}

class WebPlayer extends JObject {
  constructor(data, type) {
    super();
    this._h = host.audioCreate(data, type);
    this._state = 100;
    this._loops = 1;
  }
  ['realize()V']() { if (this._state === 100) this._state = 200; }
  ['prefetch()V']() { this['realize()V'](); if (this._state === 200) this._state = 300; }
  ['start()V']() {
    this['prefetch()V']();
    host.audioStart(this._h, this._loops);
    this._state = 400;
  }
  ['stop()V']() {
    if (this._state === 400) {
      host.audioStop(this._h);
      this._state = 300;
    }
  }
  ['deallocate()V']() {
    if (this._state === 400) host.audioStop(this._h);
    if (this._state !== 0) this._state = 200;
  }
  ['close()V']() { host.audioClose(this._h); this._state = 0; }
  ['setLoopCount(I)V'](n) { this._loops = n; }
  ['getState()I']() {
    if (this._state === 400 && !host.audioPlaying(this._h)) this._state = 300;
    return this._state;
  }
  ['getDuration()J']() { return -1n; }
  ['getMediaTime()J']() { return -1n; }
}
define('sodweb/WebPlayer', WebPlayer, ['javax/microedition/media/Player']);

class Manager extends JObject {
  static [`createPlayer(Ljava/io/InputStream;${S})Ljavax/microedition/media/Player;`](input, type) {
    const parts = [];
    const buf = new Int8Array(8192);
    let n;
    while ((n = input['read([BII)I'](buf, 0, buf.length)) > 0) parts.push(buf.slice(0, n));
    const len = parts.reduce((s, p) => s + p.length, 0);
    const data = new Int8Array(len);
    let o = 0;
    for (const p of parts) { data.set(p, o); o += p.length; }
    return new WebPlayer(data, type ?? '');
  }
  static ['playTone(III)V']() {}
}
define('javax/microedition/media/Manager', Manager);

// ------------------------------------------------------------------ rms

const rmsExc = (name, parent) => {
  const K = class extends parent {};
  define(name, K);
  return K;
};
const RSE = rmsExc('javax/microedition/rms/RecordStoreException', C['java/lang/Exception']);
rmsExc('javax/microedition/rms/RecordStoreNotFoundException', RSE);
rmsExc('javax/microedition/rms/RecordStoreNotOpenException', RSE);
rmsExc('javax/microedition/rms/RecordStoreFullException', RSE);
rmsExc('javax/microedition/rms/InvalidRecordIDException', RSE);
define('javax/microedition/media/MediaException', MediaException);

// Saves live in localStorage as "sod.rms.<name>" = comma-separated hex records ("-" for a
// deleted id); the same format as the Java build, so they move between the two.
const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked: session only */ } },
};
const openStores = new Map();
class RecordStore extends JObject {
  constructor() {
    super();
    this._name = '';
    this._recs = [];
    this._open = 0;
  }
  static [`openRecordStore(${S}Z)Ljavax/microedition/rms/RecordStore;`](name, create) {
    let rs = openStores.get(name);
    if (!rs) {
      const raw = storage.get(`sod.rms.${name}`);
      if (raw == null && !create) $.throwNew('javax/microedition/rms/RecordStoreNotFoundException', name);
      rs = new RecordStore();
      rs._name = name;
      rs._recs = raw ? raw.split(',').map((p) => (p === '-' ? null : hexToBytes(p))) : [];
      if (raw == null) rs._persist();
      openStores.set(name, rs);
    }
    rs._open++;
    return rs;
  }
  ['closeRecordStore()V']() {
    if (this._open <= 0) $.throwNew('javax/microedition/rms/RecordStoreNotOpenException', this._name);
    if (--this._open === 0) openStores.delete(this._name);
  }
  _check() { if (this._open <= 0) $.throwNew('javax/microedition/rms/RecordStoreNotOpenException', this._name); }
  _get(id) {
    this._check();
    const r = this._recs[id - 1];
    if (id < 1 || !r) $.throwNew('javax/microedition/rms/InvalidRecordIDException', String(id));
    return r;
  }
  ['getNumRecords()I']() { this._check(); return this._recs.filter(Boolean).length; }
  ['getNextRecordID()I']() { this._check(); return this._recs.length + 1; }
  ['addRecord([BII)I'](data, off, len) {
    this._check();
    this._recs.push(data ? data.slice(off, off + len) : new Int8Array(0));
    this._persist();
    return this._recs.length;
  }
  ['setRecord(I[BII)V'](id, data, off, len) {
    this._get(id);
    this._recs[id - 1] = data.slice(off, off + len);
    this._persist();
  }
  ['deleteRecord(I)V'](id) { this._get(id); this._recs[id - 1] = null; this._persist(); }
  ['getRecord(I)[B'](id) { return this._get(id).slice(); }
  ['getRecord(I[BI)I'](id, buf, off) {
    const r = this._get(id);
    if (off + r.length > buf.length) $.throwNew('java/lang/ArrayIndexOutOfBoundsException');
    buf.set(r, off);
    return r.length;
  }
  ['getRecordSize(I)I'](id) { return this._get(id).length; }
  _persist() {
    const s = this._recs.map((r) => (r ? Array.from(r, (b) => (b & 255).toString(16).padStart(2, '0')).join('') : '-'));
    storage.set(`sod.rms.${this._name}`, s.join(','));
  }
}
define('javax/microedition/rms/RecordStore', RecordStore);

function hexToBytes(h) {
  const b = new Int8Array(h.length >> 1);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(h.substr(i * 2, 2), 16);
  return b;
}

// ------------------------------------------------------------------ MIDlet

class MIDlet extends JObject {
  ['<init>()V']() {}
  [`getAppProperty(${S})${S}`](k) { return config.props.get(k) ?? null; }
  ['notifyDestroyed()V']() { host.exit(); }
  ['notifyPaused()V']() {}
  ['resumeRequest()V']() {}
  [`platformRequest(${S})Z`](url) {
    console.info('[jvm] platformRequest ignored:', url);
    return 0;
  }
  ['startApp()V']() {}
  ['pauseApp()V']() {}
  ['destroyApp(Z)V']() {}
}
define('javax/microedition/midlet/MIDlet', MIDlet);
rmsExc('javax/microedition/midlet/MIDletStateChangeException', C['java/lang/Exception']);

/** Instantiates the MIDlet class and calls startApp(), as a handset's app manager does. */
export function launch(K) {
  if (!K.$ci) K.$init();
  const m = new K();
  guard(() => m['<init>()V'](), 'MIDlet constructor');
  guard(() => m['startApp()V'](), 'startApp');
  return m;
}

// CLDC 1.1 library subset (java.lang, java.util, java.io) in JavaScript. Method names are
// Java signatures so compiled code can call them directly. Booleans are returned as 0/1.
import { $, C, JObject, JStringClass, define, iface, spawn } from './runtime.js';

const S = 'Ljava/lang/String;';
const str = (x) => (x == null ? 'null' : typeof x === 'string' ? x : x['toString()Ljava/lang/String;']());

// ------------------------------------------------------------------ Throwable

class Throwable extends JObject {
  constructor() {
    super();
    this._msg = null;
    if ($.verbose) this._stack = new Error().stack;
  }
  ['<init>()V']() {}
  [`<init>(${S})V`](m) { this._msg = m; }
  [`getMessage()${S}`]() { return this._msg; }
  [`toString()${S}`]() {
    const n = this.constructor.$name.replaceAll('/', '.');
    return this._msg == null ? n : `${n}: ${this._msg}`;
  }
  ['printStackTrace()V']() {
    printed++;
    if (printed <= 20) console.warn('[game]', this[`toString()${S}`](), this._js ?? this._stack ?? '');
    if (printed === 20) console.warn('[game] further stack traces suppressed');
  }
}
let printed = 0;
define('java/lang/Throwable', Throwable);

const exc = (name, parent) => {
  const K = class extends parent {};
  define(name, K);
  return K;
};
const Exception = exc('java/lang/Exception', Throwable);
const Err = exc('java/lang/Error', Throwable);
exc('java/lang/OutOfMemoryError', Err);
exc('java/lang/StackOverflowError', Err);
const RuntimeException = exc('java/lang/RuntimeException', Exception);
exc('java/lang/NullPointerException', RuntimeException);
exc('java/lang/ArithmeticException', RuntimeException);
exc('java/lang/ClassCastException', RuntimeException);
exc('java/lang/NegativeArraySizeException', RuntimeException);
exc('java/lang/IllegalStateException', RuntimeException);
exc('java/lang/SecurityException', RuntimeException);
const IAE = exc('java/lang/IllegalArgumentException', RuntimeException);
exc('java/lang/NumberFormatException', IAE);
const IOOBE = exc('java/lang/IndexOutOfBoundsException', RuntimeException);
exc('java/lang/ArrayIndexOutOfBoundsException', IOOBE);
exc('java/lang/StringIndexOutOfBoundsException', IOOBE);
exc('java/lang/InterruptedException', Exception);
const IOException = exc('java/io/IOException', Exception);
exc('java/io/EOFException', IOException);
exc('java/io/UTFDataFormatException', IOException);

// ------------------------------------------------------------------ String

const sioobe = (i) => $.throwNew('java/lang/StringIndexOutOfBoundsException', String(i));
const isWs = (c) => c <= 32;
Object.assign($.Str, {
  'length()I': (s) => s.length,
  'charAt(I)C': (s, i) => {
    if (i < 0 || i >= s.length) sioobe(i);
    return s.charCodeAt(i);
  },
  [`compareTo(${S})I`]: (a, b) => {
    $.nn(b);
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const d = a.charCodeAt(i) - b.charCodeAt(i);
      if (d) return d;
    }
    return a.length - b.length;
  },
  'equals(Ljava/lang/Object;)Z': (s, o) => (s === o ? 1 : 0),
  'hashCode()I': (s) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    return h;
  },
  'indexOf(I)I': (s, c) => s.indexOf(String.fromCharCode(c)),
  'indexOf(II)I': (s, c, from) => s.indexOf(String.fromCharCode(c), Math.max(0, from)),
  [`indexOf(${S})I`]: (s, t) => s.indexOf($.nn(t)),
  [`indexOf(${S}I)I`]: (s, t, from) => s.indexOf($.nn(t), Math.max(0, from)),
  'lastIndexOf(I)I': (s, c) => s.lastIndexOf(String.fromCharCode(c)),
  [`replace(CC)${S}`]: (s, a, b) => s.replaceAll(String.fromCharCode(a), String.fromCharCode(b)),
  [`startsWith(${S})Z`]: (s, p) => (s.startsWith($.nn(p)) ? 1 : 0),
  [`endsWith(${S})Z`]: (s, p) => (s.endsWith($.nn(p)) ? 1 : 0),
  [`substring(I)${S}`]: (s, b) => {
    if (b < 0 || b > s.length) sioobe(b);
    return s.substring(b);
  },
  [`substring(II)${S}`]: (s, b, e) => {
    if (b < 0 || e > s.length || b > e) sioobe(b);
    return s.substring(b, e);
  },
  [`toLowerCase()${S}`]: (s) => s.toLowerCase(),
  [`toUpperCase()${S}`]: (s) => s.toUpperCase(),
  [`trim()${S}`]: (s) => {
    let a = 0;
    let b = s.length;
    while (a < b && isWs(s.charCodeAt(a))) a++;
    while (b > a && isWs(s.charCodeAt(b - 1))) b--;
    return s.substring(a, b);
  },
  [`toString()${S}`]: (s) => s,
});

// Object methods called with an Object-typed receiver (which may be a string or array).
Object.assign($.Obj, {
  'getClass()Ljava/lang/Class;': (o) => $.classObject($.className($.nn(o))),
  'hashCode()I': (o) => (typeof o === 'string' ? $.Str['hashCode()I'](o) : o['hashCode()I'] ? o['hashCode()I']() : $.identityHash(o)),
  'equals(Ljava/lang/Object;)Z': (o, x) => (typeof o === 'string' || !o['equals(Ljava/lang/Object;)Z'] ? (o === x ? 1 : 0) : o['equals(Ljava/lang/Object;)Z'](x)),
  [`toString()${S}`]: (o) => str($.nn(o)),
});

// ------------------------------------------------------------------ StringBuffer

class StringBuffer extends JObject {
  constructor() {
    super();
    this._s = '';
  }
  ['<init>()V']() {}
  ['<init>(I)V']() {}
  [`<init>(${S})V`](s) { this._s = $.nn(s); }
  [`append(${S})Ljava/lang/StringBuffer;`](s) { this._s += s == null ? 'null' : s; return this; }
  ['append(Ljava/lang/Object;)Ljava/lang/StringBuffer;'](o) { this._s += str(o); return this; }
  ['append(I)Ljava/lang/StringBuffer;'](i) { this._s += i; return this; }
  ['append(J)Ljava/lang/StringBuffer;'](i) { this._s += i; return this; }
  ['append(C)Ljava/lang/StringBuffer;'](c) { this._s += String.fromCharCode(c); return this; }
  ['append(Z)Ljava/lang/StringBuffer;'](b) { this._s += b ? 'true' : 'false'; return this; }
  ['deleteCharAt(I)Ljava/lang/StringBuffer;'](i) {
    if (i < 0 || i >= this._s.length) sioobe(i);
    this._s = this._s.slice(0, i) + this._s.slice(i + 1);
    return this;
  }
  [`insert(I${S})Ljava/lang/StringBuffer;`](i, s) {
    if (i < 0 || i > this._s.length) sioobe(i);
    this._s = this._s.slice(0, i) + (s == null ? 'null' : s) + this._s.slice(i);
    return this;
  }
  ['length()I']() { return this._s.length; }
  ['charAt(I)C'](i) { return $.Str['charAt(I)C'](this._s, i); }
  ['setLength(I)V'](n) { this._s = this._s.slice(0, n).padEnd(n, '\0'); }
  [`toString()${S}`]() { return this._s; }
}
define('java/lang/StringBuffer', StringBuffer);

// ------------------------------------------------------------------ boxing, math, system

class JInteger extends JObject {
  constructor() {
    super();
    this._v = 0;
  }
  ['<init>(I)V'](v) { this._v = v; }
  ['intValue()I']() { return this._v; }
  ['hashCode()I']() { return this._v; }
  ['equals(Ljava/lang/Object;)Z'](o) { return o instanceof JInteger && o._v === this._v ? 1 : 0; }
  [`toString()${S}`]() { return String(this._v); }
  static [`toString(I)${S}`](i) { return String(i); }
  static [`toString(II)${S}`](i, radix) { return i.toString(radix); }
  static [`parseInt(${S})I`](s) { return JInteger[`parseInt(${S}I)I`](s, 10); }
  static [`parseInt(${S}I)I`](s, radix) {
    const ok = s != null && (radix === 10 ? /^[-+]?[0-9]+$/ : /^[-+]?[0-9a-zA-Z]+$/).test(s);
    const v = ok ? parseInt(s, radix) : NaN;
    if (Number.isNaN(v) || v < -2147483648 || v > 2147483647) $.throwNew('java/lang/NumberFormatException', s);
    return v;
  }
  static [`valueOf(${S})Ljava/lang/Integer;`](s) {
    const r = new JInteger();
    r._v = JInteger[`parseInt(${S})I`](s);
    return r;
  }
}
define('java/lang/Integer', JInteger);

class JMath extends JObject {
  static ['abs(I)I'](a) { return a < 0 ? (-a) | 0 : a; }
  static ['abs(J)J'](a) { return a < 0n ? BigInt.asIntN(64, -a) : a; }
  static ['max(II)I'](a, b) { return a > b ? a : b; }
  static ['min(II)I'](a, b) { return a < b ? a : b; }
  static ['max(JJ)J'](a, b) { return a > b ? a : b; }
  static ['min(JJ)J'](a, b) { return a < b ? a : b; }
}
define('java/lang/Math', JMath);

class PrintStream extends JObject {
  [`println(${S})V`](s) { console.log('[game]', s); }
  [`print(${S})V`](s) { console.log('[game]', s); }
  ['println(Ljava/lang/Object;)V'](o) { console.log('[game]', str(o)); }
  ['println(I)V'](i) { console.log('[game]', i); }
  ['println()V']() {}
}
define('java/io/PrintStream', PrintStream);

const t0 = Date.now() - performance.now();
class JSystem extends JObject {
  static ['arraycopy(Ljava/lang/Object;ILjava/lang/Object;II)V'](src, sp, dst, dp, n) {
    $.nn(src);
    $.nn(dst);
    if (n < 0 || sp < 0 || dp < 0 || sp + n > src.length || dp + n > dst.length) {
      $.throwNew('java/lang/ArrayIndexOutOfBoundsException', 'arraycopy');
    }
    if (ArrayBuffer.isView(dst)) {
      if (ArrayBuffer.isView(src) && src.constructor !== dst.constructor) {
        $.throwNew('java/lang/ArrayStoreException', 'arraycopy');
      }
      dst.set(src.subarray(sp, sp + n), dp);
    } else if (src === dst) {
      dst.copyWithin(dp, sp, sp + n);
    } else {
      for (let i = 0; i < n; i++) dst[dp + i] = src[sp + i];
    }
  }
  static ['currentTimeMillis()J']() { return BigInt(Math.floor(t0 + performance.now())); }
  static ['gc()V']() {}
  static [`getProperty(${S})${S}`]() { return null; }
}
JSystem.S_out = new PrintStream();
JSystem.S_err = JSystem.S_out;
define('java/lang/System', JSystem);
exc('java/lang/ArrayStoreException', RuntimeException);

class JRuntime extends JObject {
  static ['getRuntime()Ljava/lang/Runtime;']() { return RT; }
  ['freeMemory()J']() { return 1500000n; }
  ['totalMemory()J']() { return 2000000n; }
  ['gc()V']() {}
}
define('java/lang/Runtime', JRuntime);
const RT = new JRuntime();

iface('java/lang/Runnable');

class JThread extends JObject {
  constructor() {
    super();
    this._target = null;
  }
  ['<init>()V']() {}
  ['<init>(Ljava/lang/Runnable;)V'](r) { this._target = r; }
  ['run()V']() { return this._target ? this._target['run()V']() : undefined; }
  ['start()V']() { spawn(this._target ?? this); }
  static ['sleep(J)V']() {}
  static ['yield()V']() {}
  static ['currentThread()Ljava/lang/Thread;']() { return MAIN_THREAD; }
}
define('java/lang/Thread', JThread, ['java/lang/Runnable']);
const MAIN_THREAD = new JThread();

// ------------------------------------------------------------------ java.util

class Vector extends JObject {
  constructor() {
    super();
    this._a = [];
  }
  ['<init>()V']() {}
  ['<init>(I)V']() {}
  ['size()I']() { return this._a.length; }
  _check(i, max) {
    if (i < 0 || i >= max) $.throwNew('java/lang/ArrayIndexOutOfBoundsException', String(i));
  }
  ['elementAt(I)Ljava/lang/Object;'](i) { this._check(i, this._a.length); return this._a[i]; }
  ['insertElementAt(Ljava/lang/Object;I)V'](o, i) { this._check(i, this._a.length + 1); this._a.splice(i, 0, o); }
  ['removeElementAt(I)V'](i) { this._check(i, this._a.length); this._a.splice(i, 1); }
  ['setElementAt(Ljava/lang/Object;I)V'](o, i) { this._check(i, this._a.length); this._a[i] = o; }
  ['addElement(Ljava/lang/Object;)V'](o) { this._a.push(o); }
  ['removeElement(Ljava/lang/Object;)Z'](o) {
    const i = this._a.indexOf(o);
    if (i < 0) return 0;
    this._a.splice(i, 1);
    return 1;
  }
  ['removeAllElements()V']() { this._a.length = 0; }
  ['contains(Ljava/lang/Object;)Z'](o) { return this._a.includes(o) ? 1 : 0; }
  ['isEmpty()Z']() { return this._a.length ? 0 : 1; }
}
define('java/util/Vector', Vector);

// Hashtable keyed by Java equality: strings by value, Integers by value, others by identity.
const hkey = (k) => (k instanceof JInteger ? `\0int:${k._v}` : $.nn(k));
class Hashtable extends JObject {
  constructor() {
    super();
    this._m = new Map();
  }
  ['<init>()V']() {}
  ['<init>(I)V']() {}
  ['get(Ljava/lang/Object;)Ljava/lang/Object;'](k) { return this._m.get(hkey(k))?.[1] ?? null; }
  ['put(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;'](k, v) {
    $.nn(v);
    const key = hkey(k);
    const prev = this._m.get(key)?.[1] ?? null;
    this._m.set(key, [k, v]);
    return prev;
  }
  ['remove(Ljava/lang/Object;)Ljava/lang/Object;'](k) {
    const key = hkey(k);
    const prev = this._m.get(key)?.[1] ?? null;
    this._m.delete(key);
    return prev;
  }
  ['containsKey(Ljava/lang/Object;)Z'](k) { return this._m.has(hkey(k)) ? 1 : 0; }
  ['size()I']() { return this._m.size; }
  ['clear()V']() { this._m.clear(); }
}
define('java/util/Hashtable', Hashtable);

// java.util.Random: the exact 48-bit LCG, so seeded sequences match a real VM.
const MULT = 0x5deece66dn;
const MASK = (1n << 48n) - 1n;
let seedUniquifier = 8682522807148012n;
class Random extends JObject {
  constructor() {
    super();
    this._seed = 0n;
  }
  ['<init>()V']() {
    seedUniquifier = BigInt.asIntN(64, seedUniquifier * 181783497276652981n);
    this['<init>(J)V'](seedUniquifier ^ BigInt(Date.now()));
  }
  ['<init>(J)V'](seed) { this._seed = (seed ^ MULT) & MASK; }
  ['setSeed(J)V'](seed) { this._seed = (seed ^ MULT) & MASK; }
  _next(bits) {
    this._seed = (this._seed * MULT + 0xbn) & MASK;
    return Number(BigInt.asIntN(32, this._seed >> BigInt(48 - bits)));
  }
  ['nextInt()I']() { return this._next(32); }
  ['nextInt(I)I'](n) {
    if (n <= 0) $.throwNew('java/lang/IllegalArgumentException', 'n must be positive');
    if ((n & -n) === n) return Number((BigInt(n) * BigInt(this._next(31))) >> 31n);
    let bits;
    let val;
    do {
      bits = this._next(31);
      val = bits % n;
    } while (bits - val + (n - 1) < 0 || bits - val + (n - 1) > 2147483647);
    return val;
  }
  ['nextLong()J']() {
    return BigInt.asIntN(64, (BigInt(this._next(32)) << 32n) + BigInt(this._next(32)));
  }
}
define('java/util/Random', Random);

// ------------------------------------------------------------------ java.io

class InputStream extends JObject {
  ['read()I']() { return -1; }
  ['read([B)I'](b) { return this['read([BII)I'](b, 0, b.length); }
  ['read([BII)I'](b, off, len) {
    if (len === 0) return 0;
    let n = 0;
    for (; n < len; n++) {
      const c = this['read()I']();
      if (c < 0) break;
      b[off + n] = c;
    }
    return n === 0 ? -1 : n;
  }
  ['skip(J)J'](n) {
    let k = 0n;
    while (k < n && this['read()I']() >= 0) k++;
    return k;
  }
  ['available()I']() { return 0; }
  ['close()V']() {}
  ['reset()V']() { $.throwNew('java/io/IOException', 'mark/reset not supported'); }
  ['mark(I)V']() {}
  ['markSupported()Z']() { return 0; }
}
define('java/io/InputStream', InputStream);

class ByteArrayInputStream extends InputStream {
  constructor() {
    super();
    this._buf = null;
    this._pos = 0;
    this._count = 0;
    this._mark = 0;
  }
  ['<init>([B)V'](b) {
    this._buf = $.nn(b);
    this._count = b.length;
  }
  ['<init>([BII)V'](b, off, len) {
    this._buf = $.nn(b);
    this._pos = off;
    this._mark = off;
    this._count = Math.min(off + len, b.length);
  }
  ['read()I']() { return this._pos < this._count ? this._buf[this._pos++] & 0xff : -1; }
  ['read([BII)I'](b, off, len) {
    if (off < 0 || len < 0 || off + len > b.length) $.throwNew('java/lang/IndexOutOfBoundsException');
    if (this._pos >= this._count) return -1;
    const n = Math.min(len, this._count - this._pos);
    if (n <= 0) return 0;
    b.set(this._buf.subarray(this._pos, this._pos + n), off);
    this._pos += n;
    return n;
  }
  ['skip(J)J'](n) {
    const k = Math.max(0, Math.min(Number(n), this._count - this._pos));
    this._pos += k;
    return BigInt(k);
  }
  ['available()I']() { return this._count - this._pos; }
  ['reset()V']() { this._pos = this._mark; }
  ['mark(I)V']() { this._mark = this._pos; }
  ['markSupported()Z']() { return 1; }
}
define('java/io/ByteArrayInputStream', ByteArrayInputStream);

class DataInputStream extends InputStream {
  constructor() {
    super();
    this._in = null;
  }
  ['<init>(Ljava/io/InputStream;)V'](i) { this._in = i; }
  ['read()I']() { return this._in['read()I'](); }
  ['read([B)I'](b) { return this._in['read([BII)I'](b, 0, b.length); }
  ['read([BII)I'](b, off, len) { return this._in['read([BII)I'](b, off, len); }
  ['skip(J)J'](n) { return this._in['skip(J)J'](n); }
  ['available()I']() { return this._in['available()I'](); }
  ['close()V']() { this._in['close()V'](); }
  ['reset()V']() { this._in['reset()V'](); }
  ['mark(I)V'](n) { this._in['mark(I)V'](n); }
  _u8() {
    const c = this._in['read()I']();
    if (c < 0) $.throwNew('java/io/EOFException');
    return c;
  }
  ['readFully([B)V'](b) { this['readFully([BII)V'](b, 0, b.length); }
  ['readFully([BII)V'](b, off, len) {
    let n = 0;
    while (n < len) {
      const r = this._in['read([BII)I'](b, off + n, len - n);
      if (r < 0) $.throwNew('java/io/EOFException');
      n += r;
    }
  }
  ['readByte()B']() { return (this._u8() << 24) >> 24; }
  ['readUnsignedByte()I']() { return this._u8(); }
  ['readBoolean()Z']() { return this._u8() ? 1 : 0; }
  ['readShort()S']() { return (((this._u8() << 8) | this._u8()) << 16) >> 16; }
  ['readUnsignedShort()I']() { return (this._u8() << 8) | this._u8(); }
  ['readChar()C']() { return (this._u8() << 8) | this._u8(); }
  ['readInt()I']() { return (this._u8() << 24) | (this._u8() << 16) | (this._u8() << 8) | this._u8(); }
  ['readLong()J']() {
    const hi = this['readInt()I']();
    const lo = this['readInt()I']();
    return BigInt.asIntN(64, (BigInt(hi) << 32n) | BigInt(lo >>> 0));
  }
  [`readUTF()${S}`]() {
    const len = this['readUnsignedShort()I']();
    const b = new Int8Array(len);
    this['readFully([B)V'](b);
    let s = '';
    for (let p = 0; p < len;) {
      const a = b[p++] & 0xff;
      if (a < 0x80) s += String.fromCharCode(a);
      else if ((a & 0xe0) === 0xc0) s += String.fromCharCode(((a & 0x1f) << 6) | (b[p++] & 0x3f));
      else {
        const x = b[p++] & 0x3f;
        const y = b[p++] & 0x3f;
        s += String.fromCharCode(((a & 0x0f) << 12) | (x << 6) | y);
      }
    }
    return s;
  }
}
define('java/io/DataInputStream', DataInputStream);

export { JStringClass, Throwable };

// Core of the in-browser JVM: the helper object `$` used by compiled code, the class
// registry, the class loader/linker and a cooperative thread scheduler.
import { parseClass, parseDesc } from './classfile.js';
import { compileMethod, callsSleep, defaultValue, fieldKey, staticKey } from './compiler.js';

/** Registry of library classes by internal name, filled by cldc.js and midp.js. */
export const C = Object.create(null);

export class JObject {
  ['<init>()V']() {}
  ['hashCode()I']() { return $.identityHash(this); }
  ['equals(Ljava/lang/Object;)Z'](o) { return this === o ? 1 : 0; }
  ['toString()Ljava/lang/String;']() {
    return `${this.constructor.$name}@${$.identityHash(this).toString(16)}`;
  }
}
JObject.$name = 'java/lang/Object';
C['java/lang/Object'] = JObject;

/** Marker for java/lang/String: Java strings are plain JS strings. */
export class JStringClass extends JObject {}
JStringClass.$name = 'java/lang/String';
C['java/lang/String'] = JStringClass;

/** Declares a library class: sets its Java name and implemented interfaces. */
export function define(name, cls, ifaces = []) {
  cls.$name = name;
  cls.$ifaces = ifaces;
  C[name] = cls;
  return cls;
}

/** Declares a library interface. */
export function iface(name) {
  const k = { $name: name, $iface: true };
  C[name] = k;
  return k;
}

let hashSeq = 0x1234567;
const hashes = new WeakMap();
const log = { warnings: 0 };

class JClassObject extends JObject {
  constructor(name) {
    super();
    this._name = name;
  }
  ['getName()Ljava/lang/String;']() { return this._name.replaceAll('/', '.'); }
  ['getResourceAsStream(Ljava/lang/String;)Ljava/io/InputStream;'](name) {
    return $.resourceStream(name);
  }
}
define('java/lang/Class', JClassObject);
const classObjects = new Map();

export const $ = {
  resources: new Map(),
  verbose: false,

  identityHash(o) {
    let h = hashes.get(o);
    if (h === undefined) {
      hashSeq = (Math.imul(hashSeq, 1103515245) + 12345) | 0;
      h = (hashSeq >>> 1) & 0x7fffffff;
      hashes.set(o, h);
    }
    return h;
  },

  throwNew(name, msg = null) {
    const e = new C[name]();
    e['<init>(Ljava/lang/String;)V'](msg);
    throw e;
  },

  idiv(a, b) {
    if (b === 0) $.throwNew('java/lang/ArithmeticException', '/ by zero');
    return (a / b) | 0;
  },
  irem(a, b) {
    if (b === 0) $.throwNew('java/lang/ArithmeticException', '/ by zero');
    return (a % b) | 0;
  },
  ldiv(a, b) {
    if (b === 0n) $.throwNew('java/lang/ArithmeticException', '/ by zero');
    return BigInt.asIntN(64, a / b);
  },
  lrem(a, b) {
    if (b === 0n) $.throwNew('java/lang/ArithmeticException', '/ by zero');
    return a % b;
  },
  aioobe(i) {
    $.throwNew('java/lang/ArrayIndexOutOfBoundsException', String(i));
  },
  nn(x) {
    if (x == null) $.throwNew('java/lang/NullPointerException');
    return x;
  },
  cce(x, name) {
    $.throwNew('java/lang/ClassCastException', `${$.className(x)} cannot be cast to ${name}`);
  },
  internal(where, pc) {
    return new Error(`internal: bad jump in ${where} to ${pc}`);
  },

  className(x) {
    if (typeof x === 'string') return 'java/lang/String';
    if (Array.isArray(x) || ArrayBuffer.isView(x)) return 'array';
    return x?.constructor?.$name ?? typeof x;
  },

  /** Converts anything thrown into a Java Throwable. */
  wrap(e) {
    if (e instanceof C['java/lang/Throwable']) return e;
    let name = 'java/lang/Error';
    if (e instanceof TypeError) name = 'java/lang/NullPointerException';
    else if (e instanceof RangeError && /call stack/i.test(e.message)) name = 'java/lang/StackOverflowError';
    const j = new C[name]();
    j['<init>(Ljava/lang/String;)V'](String(e?.message ?? e));
    j._js = e;
    if ($.verbose || name === 'java/lang/Error') console.warn('[jvm] JS error became', name, e);
    return j;
  },

  isInst(x, K) {
    if (K === JObject) return true;
    if (typeof x === 'string') return K === JStringClass;
    if (K.$iface) {
      for (let c = x.constructor; c && c.$name; c = Object.getPrototypeOf(c)) {
        if (c.$ifaces && c.$ifaces.includes(K.$name)) return true;
      }
      return false;
    }
    return x instanceof K;
  },

  classObject(name) {
    let c = classObjects.get(name);
    if (!c) classObjects.set(name, (c = new JClassObject(name)));
    return c;
  },

  // ---- arrays ----
  newArray(type, n) {
    if (n < 0) $.throwNew('java/lang/NegativeArraySizeException', String(n));
    switch (type) {
      case 4: case 8: return new Int8Array(n);
      case 5: return new Uint16Array(n);
      case 6: return new Float32Array(n);
      case 7: return new Float64Array(n);
      case 9: return new Int16Array(n);
      case 10: return new Int32Array(n);
      case 11: return new BigInt64Array(n);
      default: throw new Error(`newarray type ${type}`);
    }
  },
  newObjArray(n) {
    if (n < 0) $.throwNew('java/lang/NegativeArraySizeException', String(n));
    return new Array(n).fill(null);
  },
  multiArray(desc, dims) {
    const make = (d, k) => {
      const n = dims[k];
      const elem = d.slice(1);
      if (k === dims.length - 1) {
        const prim = { Z: 4, C: 5, F: 6, D: 7, B: 8, S: 9, I: 10, J: 11 }[elem];
        return prim ? $.newArray(prim, n) : $.newObjArray(n);
      }
      if (n < 0) $.throwNew('java/lang/NegativeArraySizeException', String(n));
      const a = new Array(n);
      for (let i = 0; i < n; i++) a[i] = make(elem, k + 1);
      return a;
    };
    return make(desc, 0);
  },

  // ---- strings ----
  newString0() { return ''; },
  newString1(x) {
    if (typeof x === 'string') return x;
    return $.bytesToString(x, 0, x.length, null);
  },
  newString3(b, off, len) { return $.bytesToString(b, off, len, null); },
  newString4(b, off, len, enc) { return $.bytesToString(b, off, len, enc); },
  bytesToString(b, off, len, enc) {
    if (b instanceof Uint16Array) return String.fromCharCode(...b.subarray(off, off + len));
    if (off < 0 || len < 0 || off + len > b.length) $.throwNew('java/lang/StringIndexOutOfBoundsException');
    const u = new Uint8Array(b.buffer, b.byteOffset + off, len);
    const e = (enc || 'UTF-8').toLowerCase();
    if (e === 'iso-8859-1' || e === 'iso8859_1' || e === 'us-ascii') {
      let s = '';
      for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
      return s;
    }
    return new TextDecoder(e === 'utf8' ? 'utf-8' : e).decode(u);
  },

  // ---- resources (the uploaded JAR's files) ----
  resourceStream(name) {
    const key = name.startsWith('/') ? name.slice(1) : name;
    const data = $.resources.get(key);
    if (!data) return null;
    const s = new C['java/io/ByteArrayInputStream']();
    s['<init>([B)V'](new Int8Array(data.buffer, data.byteOffset, data.byteLength));
    return s;
  },

  /** Runs a generator method to completion synchronously (sleeps become no-ops). */
  runSync(it) {
    let r;
    do r = it.next(); while (!r.done);
    return r.value;
  },

  warnOnce(key, ...args) {
    if (log[key]) return;
    log[key] = true;
    console.warn(...args);
  },
};

// String and Object methods are static helpers taking the receiver first, since Java
// strings are JS primitives (filled in by cldc.js).
$.Str = Object.create(null);
$.Obj = Object.create(null);

// ---------------------------------------------------------------- threads

const threads = [];
let pumpTimer = 0;

function pump() {
  pumpTimer = 0;
  const now = performance.now();
  for (const t of threads.slice()) {
    if (t.wake > now) continue;
    try {
      const r = t.it.next();
      if (r.done) threads.splice(threads.indexOf(t), 1);
      else t.wake = performance.now() + Math.max(0, r.value);
    } catch (e) {
      threads.splice(threads.indexOf(t), 1);
      const j = $.wrap(e);
      console.error('[jvm] uncaught exception in thread:', j['toString()Ljava/lang/String;'](), j._js ?? j._stack ?? '');
    }
  }
  schedule();
}

function schedule() {
  if (pumpTimer || !threads.length) return;
  const next = Math.min(...threads.map((t) => t.wake));
  pumpTimer = setTimeout(pump, Math.max(0, next - performance.now()));
}

/** Starts a Java thread running `runnable.run()`. */
export function spawn(runnable) {
  const r = runnable['run()V']();
  if (r && typeof r.next === 'function') {
    threads.push({ it: r, wake: 0 });
    schedule();
  }
}

// ---------------------------------------------------------------- loader

/**
 * Parses and compiles every class in the JAR, links them against the library classes in
 * C and returns the game classes by name.
 */
export function loadClasses(classFiles) {
  const classes = new Map();
  for (const [file, bytes] of classFiles) {
    const c = parseClass(bytes);
    classes.set(c.name, c);
  }

  // Superclasses first.
  const order = [];
  const seen = new Set();
  const visit = (c) => {
    if (seen.has(c.name)) return;
    seen.add(c.name);
    const sup = classes.get(c.superName);
    if (sup) visit(sup);
    order.push(c);
  };
  for (const c of classes.values()) visit(c);

  const ids = new Map(order.map((c, i) => [c.name, `G${i}`]));
  const libRefs = new Map();
  const missing = new Set();
  const ref = (name) => {
    if (ids.has(name)) return ids.get(name);
    if (!C[name]) missing.add(`class ${name}`);
    if (!libRefs.has(name)) libRefs.set(name, `L${libRefs.size}`);
    return libRefs.get(name);
  };

  // Generator methods: thread bodies that sleep. Other sleeps become no-ops, which only
  // affects short pauses outside the main loop (e.g. before exiting).
  const genSet = new Set();
  for (const c of order) {
    for (const m of c.methods) {
      if (m.name === 'run' && m.desc === '()V' && callsSleep(c, m)) genSet.add(`${c.name}.run()V`);
    }
  }
  const findGame = (owner, test) => {
    for (let c = classes.get(owner); c; c = classes.get(c.superName)) if (test(c)) return c;
    return null;
  };

  const chunks = [];
  for (const c of order) {
    const id = ids.get(c.name);
    const sup = c.superName ? ref(c.superName) : ref('java/lang/Object');
    const inst = c.fields.filter((f) => !(f.access & 0x0008));
    chunks.push(`class ${id} extends ${sup} {\nconstructor() {\nsuper();\n${inst.map((f) => `this${pk(fieldKey(f.name))} = ${defaultValue(f.desc)};`).join('\n')}\n}\n}`);
    chunks.push(`${id}.$name = ${JSON.stringify(c.name)};`);
    chunks.push(`${id}.$ifaces = ${JSON.stringify(c.interfaces)};`);
    for (const f of c.fields.filter((x) => x.access & 0x0008)) {
      const v = f.constant !== undefined ? constLit(f.constant, f.desc) : defaultValue(f.desc);
      chunks.push(`${id}${pk(staticKey(f.name))} = ${v};`);
    }
    const supGame = classes.has(c.superName) ? ids.get(c.superName) : null;
    const hasClinit = c.methods.some((m) => m.name === '<clinit>');
    chunks.push(`${id}.$ci = false;\n${id}.$init = function () {\n${id}.$ci = true;\n${supGame ? `if (!${supGame}.$ci) ${supGame}.$init();\n` : ''}${hasClinit ? `${id}["<clinit>()V"]();\n` : ''}return true;\n};`);

    const ctx = {
      ref,
      isGen: (m) => genSet.has(`${c.name}.${m.name}${m.desc}`),
      isGenCall: (owner, sig) => {
        const g = findGame(owner, (k) => genSet.has(`${k.name}.${sig}`));
        return g !== null;
      },
      initCheck: (owner) => (ids.has(owner) && owner !== c.name ? `${ids.get(owner)}.$ci || ${ids.get(owner)}.$init();` : ''),
      resolveStatic: (owner, name) => {
        const g = findGame(owner, (k) => k.fields.some((f) => f.name === name && f.access & 0x0008));
        return g ? g.name : owner;
      },
      instanceTest: (expr, cname) => `$.isInst(${expr}, ${ref(cname)})`,
      noteCall: (owner, sig, op) => {
        if (ids.has(owner)) return;
        const K = C[owner];
        if (!K || K.$iface) return;
        let ok;
        if (owner === 'java/lang/String') ok = sig in $.Str;
        else if (owner === 'java/lang/Object' && op !== 0xb7) ok = sig in $.Obj;
        else ok = typeof K.prototype?.[sig] === 'function';
        if (!ok) missing.add(`${owner}.${sig}`);
      },
    };

    for (const m of c.methods) {
      if (!m.code) continue;
      const sig = `${m.name}${m.desc}`;
      if (m.access & 0x0008) {
        // invokestatic of a library static goes through ctx.ref, checked below
      }
      const { params, src, gen } = compileMethod(c, m, ctx);
      const target = m.access & 0x0008 ? id : `${id}.prototype`;
      chunks.push(`${target}[${JSON.stringify(sig)}] = function${gen ? '*' : ''} (${params.join(', ')}) {\n${src}\n};`);
    }
  }

  // Static calls/fields on library classes must exist too.
  for (const c of order) {
    for (const e of c.cp) {
      if (!e || !(e.tag === 10 || e.tag === 9) || ids.has(e.owner) || !C[e.owner]) continue;
      if (e.tag === 10 && e.owner !== 'java/lang/String' && e.owner !== 'java/lang/Object') {
        const K = C[e.owner];
        const sig = `${e.name}${e.desc}`;
        if (typeof K[sig] !== 'function' && typeof K.prototype?.[sig] !== 'function') missing.add(`${e.owner}.${sig}`);
      }
    }
  }
  if (missing.size) {
    throw new Error(`This JAR needs APIs the runtime doesn't implement:\n${[...missing].sort().join('\n')}`);
  }

  const prelude = [...libRefs].map(([name, id]) => `const ${id} = C[${JSON.stringify(name)}];`).join('\n');
  const exports = order.map((c) => `${JSON.stringify(c.name)}: ${ids.get(c.name)}`).join(', ');
  const source = `"use strict";\n${prelude}\n${chunks.join('\n')}\nreturn { ${exports} };\n//# sourceURL=game-classes.js`;
  const factory = new Function('$', 'C', source);
  const game = factory($, C);
  return { classes: game, source };
}

function pk(key) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

function constLit(v, desc) {
  if (desc === 'J') return `${v}n`;
  if (desc === 'Ljava/lang/String;') return JSON.stringify(v);
  return String(v);
}

export { parseDesc };

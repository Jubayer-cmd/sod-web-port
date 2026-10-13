// Translates JVM bytecode to JavaScript source, one JS function per Java method.
//
// Each method becomes `for (;;) switch (pc) { ... }` over its basic blocks, with the
// operand stack held in plain locals (s0, s1, ...) whose depth is fixed at every pc, so
// V8 can optimise the result like hand-written code. Java semantics kept exactly:
// 32-bit int wrap-around, BigInt longs, array bounds, divide-by-zero, exception handlers.
import { parseDesc, isWide } from './classfile.js';

const ident = (s) => /^[A-Za-z_$][\w$]*$/.test(s);
export const fieldKey = (name) => `F_${name}`;
export const staticKey = (name) => `S_${name}`;
const prop = (key) => (ident(key) ? `.${key}` : `[${JSON.stringify(key)}]`);
const sigOf = (name, desc) => `${name}${desc}`;
const lit = (s) => JSON.stringify(s);

export function defaultValue(desc) {
  if (desc === 'J') return '0n';
  if (desc[0] === 'L' || desc[0] === '[') return 'null';
  return '0';
}

// Bytes of operands following each opcode (variable-length ones handled separately).
const OPLEN = new Uint8Array(256).fill(1);
for (const op of [0x10, 0x12, 0x15, 0x16, 0x17, 0x18, 0x19, 0x36, 0x37, 0x38, 0x39, 0x3a, 0xa9, 0xbc]) OPLEN[op] = 2;
for (const op of [0x11, 0x13, 0x14, 0x84, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xbb, 0xbd, 0xc0, 0xc1, 0xc6, 0xc7, 0xa7, 0xa8]) OPLEN[op] = 3;
for (let op = 0x99; op <= 0xa6; op++) OPLEN[op] = 3;
OPLEN[0xc5] = 4;
for (const op of [0xb9, 0xc8, 0xc9]) OPLEN[op] = 5;

function decode(code) {
  const v = new DataView(code.buffer, code.byteOffset, code.byteLength);
  const list = [];
  let pc = 0;
  while (pc < code.length) {
    const op = code[pc];
    const ins = { pc, op };
    if (op === 0xaa) { // tableswitch
      let p = (pc + 4) & ~3;
      ins.def = pc + v.getInt32(p);
      const lo = v.getInt32(p + 4);
      const hi = v.getInt32(p + 8);
      p += 12;
      ins.cases = [];
      for (let k = lo; k <= hi; k++, p += 4) ins.cases.push([k, pc + v.getInt32(p)]);
      ins.len = p - pc;
    } else if (op === 0xab) { // lookupswitch
      let p = (pc + 4) & ~3;
      ins.def = pc + v.getInt32(p);
      const n = v.getInt32(p + 4);
      p += 8;
      ins.cases = [];
      for (let k = 0; k < n; k++, p += 8) ins.cases.push([v.getInt32(p), pc + v.getInt32(p + 4)]);
      ins.len = p - pc;
    } else if (op === 0xc4) { // wide
      ins.op = code[pc + 1];
      ins.wide = true;
      ins.idx = v.getUint16(pc + 2);
      if (ins.op === 0x84) { ins.inc = v.getInt16(pc + 4); ins.len = 6; } else ins.len = 4;
    } else {
      ins.len = OPLEN[op];
      if (ins.len === 2) ins.u1 = code[pc + 1];
      if (ins.len >= 3) { ins.u2 = v.getUint16(pc + 1); ins.s2 = v.getInt16(pc + 1); }
      if (op === 0x10) ins.u1 = v.getInt8(pc + 1); // bipush is signed
      if (op === 0x84) { ins.idx = code[pc + 1]; ins.inc = v.getInt8(pc + 2); }
      if (op === 0xc5) ins.dims = code[pc + 3];
    }
    list.push(ins);
    pc += ins.len;
  }
  return list;
}

/** True when the method calls Thread.sleep directly. */
export function callsSleep(cls, m) {
  if (!m.code) return false;
  return decode(m.code.code).some((ins) => {
    if (ins.op !== 0xb8) return false;
    const r = cls.cp[ins.u2];
    return r.owner === 'java/lang/Thread' && r.name === 'sleep';
  });
}

const BRANCH = (op) => (op >= 0x99 && op <= 0xa7) || op === 0xc6 || op === 0xc7;
const ENDS = (op) => (op >= 0xac && op <= 0xb1) || op === 0xbf || op === 0xa7 || op === 0xaa || op === 0xab;

/**
 * @param cls      parsed class
 * @param m        parsed method (with code)
 * @param ctx      { ref(className) -> JS identifier, isGen(m) -> bool, here: identifier of
 *                   this class, checkInit(className) -> bool, resolveStatic(owner,name) }
 */
export function compileMethod(cls, m, ctx) {
  const { code, handlers, maxLocals } = m.code;
  const cp = cls.cp;
  const list = decode(code);
  const byPc = new Map(list.map((ins, i) => [ins.pc, i]));
  const isStatic = (m.access & 0x0008) !== 0;
  const gen = ctx.isGen(m);

  // ---- leaders ----
  const leaders = new Set([0]);
  for (const ins of list) {
    if (BRANCH(ins.op)) leaders.add(ins.pc + ins.s2);
    if (ins.cases) {
      leaders.add(ins.def);
      for (const [, t] of ins.cases) leaders.add(t);
    }
    if (BRANCH(ins.op) || ENDS(ins.op)) leaders.add(ins.pc + ins.len);
  }
  for (const h of handlers) {
    leaders.add(h.start);
    leaders.add(h.end);
    leaders.add(h.pc);
  }
  const inTry = (pc) => handlers.some((h) => pc >= h.start && pc < h.end);

  // ---- stack shape at every instruction (list of categories, 1 or 2) ----
  const shapes = new Array(list.length);
  const work = [];
  const enter = (pc, shape) => {
    const i = byPc.get(pc);
    if (i === undefined) return;
    if (shapes[i]) return;
    shapes[i] = shape;
    work.push(i);
  };
  enter(0, []);
  for (const h of handlers) enter(h.pc, [1]);
  while (work.length) {
    const i = work.pop();
    const r = step(list[i], shapes[i], null);
    for (const t of r.targets) enter(t, r.shape);
    if (!r.end && i + 1 < list.length) enter(list[i + 1].pc, r.shape);
  }

  // ---- code generation ----
  let maxDepth = 0;
  const body = [];
  const straight = leaders.size === 1 && handlers.length === 0;
  for (let i = 0; i < list.length; i++) {
    const ins = list[i];
    const shape = shapes[i];
    if (!shape) continue; // unreachable
    maxDepth = Math.max(maxDepth, shape.length + 2);
    if (!straight && leaders.has(ins.pc)) {
      body.push(`case ${ins.pc}:`);
      if (handlers.length && inTry(ins.pc)) body.push(`pc = ${ins.pc};`);
    }
    const out = [];
    const r = step(ins, shape, out);
    body.push(...out);
    // Fall through into the next block if the next instruction is a leader; switch
    // cases fall through naturally, so nothing else is needed.
    void r;
  }

  // ---- assemble ----
  const desc = parseDesc(m.desc);
  const params = [];
  const locals = [];
  let slot = 0;
  if (!isStatic) locals.push('l0 = this'), slot = 1;
  for (const t of desc.params) {
    params.push(`l${slot}`);
    slot += isWide(t) ? 2 : 1;
  }
  for (let k = slot; k < maxLocals; k++) locals.push(`l${k}`);
  const svars = [];
  for (let k = 0; k < maxDepth; k++) svars.push(`s${k}`);
  const decls = [...locals, ...svars];
  let src = decls.length ? `let ${decls.join(', ')};\n` : '';
  if (straight) {
    src += body.join('\n');
  } else if (handlers.length === 0) {
    src += `let pc = 0;\nfor (;;) switch (pc) {\n${body.join('\n')}\ndefault: throw $.internal(${lit(cls.name + '.' + m.name)}, pc);\n}`;
  } else {
    const catches = handlers.map((h) => {
      const test = h.type ? ` && ${ctx.instanceTest('e$', h.type)}` : '';
      return `if (pc >= ${h.start} && pc < ${h.end}${test}) { s0 = e$; pc = ${h.pc}; continue; }`;
    });
    src += `let pc = 0;\nfor (;;) {\ntry {\nswitch (pc) {\n${body.join('\n')}\ndefault: throw $.internal(${lit(cls.name + '.' + m.name)}, pc);\n}\n} catch (e0$) {\nconst e$ = $.wrap(e0$);\n${catches.join('\n')}\nthrow e$;\n}\n}`;
  }
  return { params, src, gen };

  // -------------------------------------------------------------------------
  // step(): stack effect of one instruction; also emits JS into `out` when given.
  function step(ins, shape, out) {
    const op = ins.op;
    const st = shape.slice();
    const top = () => st.length - 1;
    const s = (k) => `s${k}`;
    const emit = (line) => { if (out) out.push(line); };
    const push = (cat, expr) => { const k = st.length; st.push(cat); emit(`${s(k)} = ${expr};`); return k; };
    const pop = () => { st.pop(); return s(st.length); };
    const res = (extra = {}) => ({ shape: st, targets: [], end: false, ...extra });
    const jump = (target) => `{ pc = ${target}; continue; }`;

    // loads / stores
    if (op >= 0x1a && op <= 0x2d) { // xload_n
      const t = (op - 0x1a) >> 2;
      push(t === 1 || t === 3 ? 2 : 1, `l${(op - 0x1a) & 3}`);
      return res();
    }
    if (op >= 0x15 && op <= 0x19) { // xload idx
      const idx = ins.wide ? ins.idx : ins.u1;
      push(op === 0x16 || op === 0x18 ? 2 : 1, `l${idx}`);
      return res();
    }
    if (op >= 0x3b && op <= 0x4e) { // xstore_n
      emit(`l${(op - 0x3b) & 3} = ${pop()};`);
      return res();
    }
    if (op >= 0x36 && op <= 0x3a) {
      const idx = ins.wide ? ins.idx : ins.u1;
      emit(`l${idx} = ${pop()};`);
      return res();
    }

    switch (op) {
      case 0x00: return res(); // nop
      case 0x01: push(1, 'null'); return res();
      case 0x02: case 0x03: case 0x04: case 0x05: case 0x06: case 0x07: case 0x08:
        push(1, String(op - 3)); return res();
      case 0x09: case 0x0a: push(2, `${op - 9}n`); return res();
      case 0x0b: case 0x0c: case 0x0d: push(1, `${op - 0x0b}`); return res(); // fconst
      case 0x0e: case 0x0f: push(2, `${op - 0x0e}`); return res(); // dconst
      case 0x10: push(1, String(ins.u1)); return res();
      case 0x11: push(1, String(ins.s2)); return res();
      case 0x12: case 0x13: case 0x14: {
        const c = cp[op === 0x12 ? ins.u1 : ins.u2];
        if (c.tag === 3) push(1, String(c.value));
        else if (c.tag === 4) push(1, String(c.value));
        else if (c.tag === 5) push(2, `${c.value}n`);
        else if (c.tag === 6) push(2, String(c.value));
        else if (c.tag === 8) push(1, lit(c.value));
        else if (c.tag === 7) push(1, `$.classObject(${lit(c.className)})`);
        else throw new Error(`ldc of tag ${c.tag}`);
        return res();
      }

      // array loads
      case 0x2e: case 0x2f: case 0x30: case 0x31: case 0x32: case 0x33: case 0x34: case 0x35: {
        const i = pop();
        const a = pop();
        push(op === 0x2f || op === 0x31 ? 2 : 1, `(${i} >>> 0) < ${a}.length ? ${a}[${i}] : $.aioobe(${i})`);
        return res();
      }
      // array stores
      case 0x4f: case 0x50: case 0x51: case 0x52: case 0x53: case 0x54: case 0x55: case 0x56: {
        const v = pop();
        const i = pop();
        const a = pop();
        emit(`if ((${i} >>> 0) >= ${a}.length) $.aioobe(${i}); ${a}[${i}] = ${v};`);
        return res();
      }

      // stack manipulation
      case 0x57: st.pop(); return res();
      case 0x58: if (st[top()] === 2) st.pop(); else { st.pop(); st.pop(); } return res();
      case 0x59: dup(1, 0); return res();
      case 0x5a: dup(1, 1); return res();
      case 0x5b: dup(1, st[top() - 1] === 2 ? 1 : 2); return res();
      case 0x5c: dup(st[top()] === 2 ? 1 : 2, 0); return res();
      case 0x5d: dup(st[top()] === 2 ? 1 : 2, 1); return res();
      case 0x5e: {
        const a = st[top()] === 2 ? 1 : 2;
        dup(a, st[top() - a] === 2 ? 1 : 2);
        return res();
      }
      case 0x5f: { // swap
        const k = top();
        emit(`{ const t$ = ${s(k)}; ${s(k)} = ${s(k - 1)}; ${s(k - 1)} = t$; }`);
        return res();
      }

      // int arithmetic
      case 0x60: bin('($a + $b) | 0'); return res();
      case 0x64: bin('($a - $b) | 0'); return res();
      case 0x68: bin('Math.imul($a, $b)'); return res();
      case 0x6c: bin('$.idiv($a, $b)'); return res();
      case 0x70: bin('$.irem($a, $b)'); return res();
      case 0x74: un('(-$a) | 0'); return res();
      case 0x78: bin('$a << $b'); return res();
      case 0x7a: bin('$a >> $b'); return res();
      case 0x7c: bin('($a >>> $b) | 0'); return res();
      case 0x7e: bin('$a & $b'); return res();
      case 0x80: bin('$a | $b'); return res();
      case 0x82: bin('$a ^ $b'); return res();
      // long arithmetic
      case 0x61: bin('BigInt.asIntN(64, $a + $b)', 2); return res();
      case 0x65: bin('BigInt.asIntN(64, $a - $b)', 2); return res();
      case 0x69: bin('BigInt.asIntN(64, $a * $b)', 2); return res();
      case 0x6d: bin('$.ldiv($a, $b)', 2); return res();
      case 0x71: bin('$.lrem($a, $b)', 2); return res();
      case 0x75: un('BigInt.asIntN(64, -$a)', 2); return res();
      case 0x79: bin('BigInt.asIntN(64, $a << BigInt($b & 63))', 2); return res();
      case 0x7b: bin('$a >> BigInt($b & 63)', 2); return res();
      case 0x7d: bin('BigInt.asIntN(64, BigInt.asUintN(64, $a) >> BigInt($b & 63))', 2); return res();
      case 0x7f: bin('$a & $b', 2); return res();
      case 0x81: bin('$a | $b', 2); return res();
      case 0x83: bin('$a ^ $b', 2); return res();
      case 0x84: { // iinc
        const idx = ins.idx;
        emit(`l${idx} = (l${idx} + ${ins.inc}) | 0;`);
        return res();
      }
      // conversions
      case 0x85: un('BigInt($a)', 2); return res();
      case 0x88: un('Number(BigInt.asIntN(32, $a))', 1); return res();
      case 0x91: un('($a << 24) >> 24'); return res();
      case 0x92: un('$a & 65535'); return res();
      case 0x93: un('($a << 16) >> 16'); return res();
      case 0x94: { // lcmp
        const b = pop();
        const a = pop();
        push(1, `${a} < ${b} ? -1 : ${a} > ${b} ? 1 : 0`);
        return res();
      }

      // branches
      case 0x99: case 0x9a: case 0x9b: case 0x9c: case 0x9d: case 0x9e: {
        const a = pop();
        const rel = ['===', '!==', '<', '>=', '>', '<='][op - 0x99];
        emit(`if (${a} ${rel} 0) ${jump(ins.pc + ins.s2)}`);
        return res({ targets: [ins.pc + ins.s2] });
      }
      case 0x9f: case 0xa0: case 0xa1: case 0xa2: case 0xa3: case 0xa4: case 0xa5: case 0xa6: {
        const b = pop();
        const a = pop();
        const rel = ['===', '!==', '<', '>=', '>', '<=', '===', '!=='][op - 0x9f];
        emit(`if (${a} ${rel} ${b}) ${jump(ins.pc + ins.s2)}`);
        return res({ targets: [ins.pc + ins.s2] });
      }
      case 0xc6: case 0xc7: {
        const a = pop();
        emit(`if (${a} ${op === 0xc6 ? '==' : '!='} null) ${jump(ins.pc + ins.s2)}`);
        return res({ targets: [ins.pc + ins.s2] });
      }
      case 0xa7: emit(`${jump(ins.pc + ins.s2)}`); return res({ targets: [ins.pc + ins.s2], end: true });
      case 0xaa: case 0xab: {
        const k = pop();
        const lines = ins.cases.map(([v, t]) => `case ${v}: pc = ${t}; continue;`);
        emit(`switch (${k}) { ${lines.join(' ')} default: pc = ${ins.def}; continue; }`);
        return res({ targets: [ins.def, ...ins.cases.map((c) => c[1])], end: true });
      }

      // returns
      case 0xac: case 0xad: case 0xae: case 0xaf: case 0xb0: emit(`return ${pop()};`); return res({ end: true });
      case 0xb1: emit('return;'); return res({ end: true });

      // fields
      case 0xb2: { // getstatic
        const f = cp[ins.u2];
        const owner = ctx.resolveStatic(f.owner, f.name);
        emit(ctx.initCheck(owner));
        push(isWide(f.desc) ? 2 : 1, `${ctx.ref(owner)}${prop(staticKey(f.name))}`);
        return res();
      }
      case 0xb3: {
        const f = cp[ins.u2];
        const owner = ctx.resolveStatic(f.owner, f.name);
        const v = pop();
        emit(ctx.initCheck(owner));
        emit(`${ctx.ref(owner)}${prop(staticKey(f.name))} = ${v};`);
        return res();
      }
      case 0xb4: {
        const f = cp[ins.u2];
        const o = pop();
        push(isWide(f.desc) ? 2 : 1, `${o}${prop(fieldKey(f.name))}`);
        return res();
      }
      case 0xb5: {
        const f = cp[ins.u2];
        const v = pop();
        const o = pop();
        emit(`${o}${prop(fieldKey(f.name))} = ${v};`);
        return res();
      }

      // invocation
      case 0xb6: case 0xb7: case 0xb8: case 0xb9: {
        const mr = cp[ins.u2];
        const d = parseDesc(mr.desc);
        const args = [];
        for (let k = d.params.length - 1; k >= 0; k--) args.unshift(pop());
        const sig = sigOf(mr.name, mr.desc);
        let call;
        if (op === 0xb8) { // static
          if (mr.owner === 'java/lang/Thread' && sig === 'sleep(J)V') {
            emit(gen ? `yield Number(${args[0]});` : `void ${args[0]};`);
            return res();
          }
          emit(ctx.initCheck(mr.owner));
          call = `${ctx.ref(mr.owner)}${prop(sig)}(${args.join(', ')})`;
        } else {
          const recvIndex = st.length - 1;
          const recv = pop();
          if (op === 0xb7) { // special: constructors, private methods, super calls
            if (mr.owner === 'java/lang/String' && mr.name === '<init>') {
              // Strings are immutable JS strings: replace the placeholder pushed by `new`.
              emit(`${s(recvIndex - 1)} = $.newString${d.params.length}(${args.join(', ')});`);
              return res();
            }
            if (mr.owner === 'java/lang/Object' && mr.name === '<init>') return res();
            call = `${ctx.ref(mr.owner)}.prototype${prop(sig)}.call(${[recv, ...args].join(', ')})`;
          } else if (mr.owner === 'java/lang/String' || mr.owner === 'java/lang/Object') {
            call = `$.${mr.owner === 'java/lang/String' ? 'Str' : 'Obj'}${prop(sig)}(${[recv, ...args].join(', ')})`;
          } else {
            call = `${recv}${prop(sig)}(${args.join(', ')})`;
          }
          ctx.noteCall(mr.owner, sig, op);
        }
        if (ctx.isGenCall(mr.owner, sig)) call = gen ? `(yield* ${call})` : `$.runSync(${call})`;
        if (d.ret === 'V') emit(`${call};`);
        else push(isWide(d.ret) ? 2 : 1, call);
        return res();
      }

      // objects and arrays
      case 0xbb: {
        const c = cp[ins.u2].className;
        if (c === 'java/lang/String') { push(1, 'null'); return res(); }
        emit(ctx.initCheck(c));
        push(1, `new ${ctx.ref(c)}()`);
        return res();
      }
      case 0xbc: push(1, `$.newArray(${ins.u1}, ${pop()})`); return res();
      case 0xbd: push(1, `$.newObjArray(${pop()})`); return res();
      case 0xbe: push(1, `${pop()}.length`); return res();
      case 0xbf: emit(`throw $.nn(${pop()});`); return res({ end: true });
      case 0xc0: {
        const c = cp[ins.u2].className;
        const k = top();
        if (c[0] !== '[') emit(`if (${s(k)} != null && !(${ctx.instanceTest(s(k), c)})) $.cce(${s(k)}, ${lit(c)});`);
        return res();
      }
      case 0xc1: {
        const c = cp[ins.u2].className;
        const o = pop();
        push(1, c[0] === '[' ? `(${o} != null ? 1 : 0)` : `(${o} != null && ${ctx.instanceTest(o, c)} ? 1 : 0)`);
        return res();
      }
      case 0xc2: case 0xc3: pop(); return res(); // monitorenter/exit: single-threaded
      case 0xc5: {
        const dims = [];
        for (let k = 0; k < ins.dims; k++) dims.unshift(pop());
        push(1, `$.multiArray(${lit(cp[ins.u2].className)}, [${dims.join(', ')}])`);
        return res();
      }
      default:
        throw new Error(`${cls.name}.${m.name}${m.desc}: unsupported opcode 0x${op.toString(16)} at ${ins.pc}`);
    }

    function bin(tpl, cat = 1) {
      const b = pop();
      const a = pop();
      push(cat, tpl.replaceAll('$a', a).replaceAll('$b', b));
    }
    function un(tpl, cat = 1) {
      const a = pop();
      push(cat, tpl.replaceAll('$a', a));
    }
    // Duplicate the top `a` entries and insert them below the next `b` entries.
    function dup(a, b) {
      const n = st.length;
      const group = st.slice(n - a);
      const skip = st.slice(n - a - b, n - a);
      const base = n - a - b;
      const oldNames = [];
      for (let k = base; k < n; k++) oldNames.push(s(k));
      const newOrder = [...group.map((_, k) => n - a + k), ...skip.map((_, k) => base + k), ...group.map((_, k) => n - a + k)];
      st.length = base;
      st.push(...group, ...skip, ...group);
      if (out) {
        const tmp = oldNames.map((nm, k) => `t${k}$ = ${nm}`).join(', ');
        const assigns = newOrder.map((src, k) => `${s(base + k)} = t${src - base}$;`).join(' ');
        emit(`{ const ${tmp}; ${assigns} }`);
      }
    }
  }
}

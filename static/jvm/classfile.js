// Java class file parser (JVMS chapter 4), enough for CLDC-era (version 45) classes.

// Modified UTF-8 -> JS string (handles the 2-byte NUL and 3-byte surrogate halves).
function mutf8(d, p, len) {
  let s = '';
  const end = p + len;
  while (p < end) {
    const a = d[p++];
    if (a < 0x80) s += String.fromCharCode(a);
    else if ((a & 0xe0) === 0xc0) s += String.fromCharCode(((a & 0x1f) << 6) | (d[p++] & 0x3f));
    else {
      const b = d[p++];
      const c = d[p++];
      s += String.fromCharCode(((a & 0x0f) << 12) | ((b & 0x3f) << 6) | (c & 0x3f));
    }
  }
  return s;
}

export function parseClass(bytes) {
  const d = bytes;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  let p = 0;
  const u1 = () => d[p++];
  const u2 = () => { const x = v.getUint16(p); p += 2; return x; };
  const u4 = () => { const x = v.getUint32(p); p += 4; return x; };

  if (u4() !== 0xcafebabe) throw new Error('not a class file');
  const minor = u2();
  const major = u2();
  const n = u2();
  const cp = new Array(n);
  for (let i = 1; i < n; i++) {
    const tag = u1();
    switch (tag) {
      case 1: { const len = u2(); cp[i] = { tag, str: mutf8(d, p, len) }; p += len; break; }
      case 3: cp[i] = { tag, value: v.getInt32(p) }; p += 4; break;
      case 4: cp[i] = { tag, value: v.getFloat32(p) }; p += 4; break;
      case 5: cp[i] = { tag, value: v.getBigInt64(p) }; p += 8; i++; break;
      case 6: cp[i] = { tag, value: v.getFloat64(p) }; p += 8; i++; break;
      case 7: cp[i] = { tag, name: u2() }; break;
      case 8: cp[i] = { tag, str: u2() }; break;
      case 9: case 10: case 11: cp[i] = { tag, cls: u2(), nat: u2() }; break;
      case 12: cp[i] = { tag, name: u2(), desc: u2() }; break;
      default: throw new Error(`bad constant pool tag ${tag}`);
    }
  }
  const utf = (i) => cp[i].str;
  const className = (i) => utf(cp[i].name);
  // Resolve symbolic references once so the compiler can use them directly.
  for (let i = 1; i < n; i++) {
    const e = cp[i];
    if (!e) continue;
    if (e.tag === 8) e.value = utf(e.str);
    else if (e.tag === 7) e.className = utf(e.name);
    else if (e.tag >= 9 && e.tag <= 11) {
      const nat = cp[e.nat];
      e.owner = className(e.cls);
      e.name = utf(nat.name);
      e.desc = utf(nat.desc);
    }
  }

  const access = u2();
  const name = className(u2());
  const superIdx = u2();
  const superName = superIdx ? className(superIdx) : null;
  const interfaces = [];
  for (let i = u2(); i > 0; i--) interfaces.push(className(u2()));

  const readAttrs = () => {
    const attrs = [];
    for (let i = u2(); i > 0; i--) {
      const aname = utf(u2());
      const len = u4();
      attrs.push({ name: aname, start: p, len });
      p += len;
    }
    return attrs;
  };

  const fields = [];
  for (let i = u2(); i > 0; i--) {
    const f = { access: u2(), name: utf(u2()), desc: utf(u2()), constant: undefined };
    for (const a of readAttrs()) {
      if (a.name === 'ConstantValue') f.constant = cp[v.getUint16(a.start)].value;
    }
    fields.push(f);
  }

  const methods = [];
  for (let i = u2(); i > 0; i--) {
    const m = { access: u2(), name: utf(u2()), desc: utf(u2()), code: null };
    for (const a of readAttrs()) {
      if (a.name !== 'Code') continue;
      let q = a.start;
      const maxStack = v.getUint16(q);
      const maxLocals = v.getUint16(q + 2);
      const codeLen = v.getUint32(q + 4);
      q += 8;
      const code = d.subarray(q, q + codeLen);
      q += codeLen;
      const handlers = [];
      for (let k = v.getUint16(q); k > 0; k--) {
        q += 2;
        const type = v.getUint16(q + 6);
        handlers.push({
          start: v.getUint16(q), end: v.getUint16(q + 2), pc: v.getUint16(q + 4),
          type: type ? className(type) : null,
        });
        q += 6;
      }
      m.code = { maxStack, maxLocals, code, handlers };
    }
    methods.push(m);
  }
  return { major, minor, access, name, superName, interfaces, fields, methods, cp };
}

/** Splits a method descriptor into parameter types and return type. */
export function parseDesc(desc) {
  const params = [];
  let i = 1;
  while (desc[i] !== ')') {
    const s = i;
    while (desc[i] === '[') i++;
    if (desc[i] === 'L') i = desc.indexOf(';', i);
    i++;
    params.push(desc.slice(s, i));
  }
  return { params, ret: desc.slice(i + 1) };
}

export const isWide = (t) => t === 'J' || t === 'D';

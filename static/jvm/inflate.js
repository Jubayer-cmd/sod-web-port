// Synchronous DEFLATE decoder (RFC 1951). MIDP's Image.createImage(byte[]) has to return a
// decoded PNG immediately, and the browser's DecompressionStream is async only.

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59,
  67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769,
  1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11,
  12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

// Canonical Huffman table: counts per length + symbols sorted by code.
function build(lengths, n) {
  const counts = new Uint16Array(16);
  const symbols = new Uint16Array(n);
  for (let i = 0; i < n; i++) counts[lengths[i]]++;
  counts[0] = 0;
  const offs = new Uint16Array(16);
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1];
  for (let i = 0; i < n; i++) if (lengths[i]) symbols[offs[lengths[i]]++] = i;
  return { counts, symbols };
}

let FIXED_LIT = null;
let FIXED_DIST = null;
function fixedTables() {
  if (!FIXED_LIT) {
    const l = new Uint8Array(288);
    l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
    FIXED_LIT = build(l, 288);
    FIXED_DIST = build(new Uint8Array(30).fill(5), 30);
  }
}

/**
 * Inflates raw DEFLATE data. `sizeHint` pre-sizes the output; it grows as needed.
 * @returns {Uint8Array}
 */
export function inflateRaw(src, start = 0, end = src.length, sizeHint = 0) {
  let pos = start;
  let bitBuf = 0;
  let bitCnt = 0;
  let out = new Uint8Array(Math.max(sizeHint, 1024));
  let op = 0;

  const need = (n) => {
    while (bitCnt < n) {
      if (pos >= end) throw new Error('inflate: unexpected end of data');
      bitBuf |= src[pos++] << bitCnt;
      bitCnt += 8;
    }
  };
  const bits = (n) => {
    if (n === 0) return 0;
    need(n);
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return v;
  };
  const ensure = (n) => {
    if (op + n <= out.length) return;
    let size = out.length * 2;
    while (size < op + n) size *= 2;
    const grown = new Uint8Array(size);
    grown.set(out.subarray(0, op));
    out = grown;
  };
  const decode = (t) => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const count = t.counts[len];
      if (code - first < count) return t.symbols[index + code - first];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error('inflate: bad Huffman code');
  };

  let final = 0;
  while (!final) {
    final = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0;
      bitCnt = 0;
      if (pos + 4 > end) throw new Error('inflate: truncated stored block');
      const len = src[pos] | (src[pos + 1] << 8);
      pos += 4;
      ensure(len);
      out.set(src.subarray(pos, pos + len), op);
      op += len;
      pos += len;
      continue;
    }
    let lit;
    let dist;
    if (type === 1) {
      fixedTables();
      lit = FIXED_LIT;
      dist = FIXED_DIST;
    } else if (type === 2) {
      const hlit = bits(5) + 257;
      const hdist = bits(5) + 1;
      const hclen = bits(4) + 4;
      const cl = new Uint8Array(19);
      for (let i = 0; i < hclen; i++) cl[CL_ORDER[i]] = bits(3);
      const clTable = build(cl, 19);
      const lens = new Uint8Array(hlit + hdist);
      for (let i = 0; i < hlit + hdist;) {
        const sym = decode(clTable);
        if (sym < 16) lens[i++] = sym;
        else {
          let rep;
          let val = 0;
          if (sym === 16) {
            val = lens[i - 1];
            rep = 3 + bits(2);
          } else if (sym === 17) rep = 3 + bits(3);
          else rep = 11 + bits(7);
          while (rep--) lens[i++] = val;
        }
      }
      lit = build(lens.subarray(0, hlit), hlit);
      dist = build(lens.subarray(hlit), hdist);
    } else {
      throw new Error('inflate: bad block type');
    }
    for (;;) {
      const sym = decode(lit);
      if (sym < 256) {
        ensure(1);
        out[op++] = sym;
      } else if (sym === 256) {
        break;
      } else {
        const li = sym - 257;
        const len = LEN_BASE[li] + bits(LEN_EXTRA[li]);
        const di = decode(dist);
        const d = DIST_BASE[di] + bits(DIST_EXTRA[di]);
        if (d > op) throw new Error('inflate: distance too far');
        ensure(len);
        for (let i = 0; i < len; i++, op++) out[op] = out[op - d];
      }
    }
  }
  return out.subarray(0, op);
}

/** zlib wrapper (PNG IDAT): 2-byte header, deflate data, Adler-32 (not verified). */
export function inflateZlib(src, start, end, sizeHint) {
  return inflateRaw(src, start + 2, end, sizeHint);
}

// Synchronous PNG decoder producing Java ARGB ints. Gameloft titles rewrite PLTE/tRNS chunks
// in memory to recolour sprites, so images can't be pre-decoded by the browser.
import { inflateZlib } from './inflate.js';

const be32 = (d, p) => ((d[p] << 24) | (d[p + 1] << 16) | (d[p + 2] << 8) | d[p + 3]) | 0;
const be16 = (d, p) => (d[p] << 8) | d[p + 1];

/** @param {Uint8Array} d unsigned view of the bytes */
export function decodePng(d, off, len) {
  const end = off + len;
  let p = off + 8;
  let width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
  let pal = null, palA = null;
  let trnsG = -1, trnsR = -1, trnsGr = -1, trnsB = -1;
  const idat = [];
  let idatLen = 0;
  while (p + 8 <= end) {
    const clen = be32(d, p);
    const type = be32(d, p + 4);
    const c = p + 8;
    if (type === 0x49484452) {
      width = be32(d, c); height = be32(d, c + 4);
      depth = d[c + 8]; ctype = d[c + 9]; interlace = d[c + 12];
    } else if (type === 0x504c5445) {
      pal = new Int32Array(256);
      for (let i = 0; i < ((clen / 3) | 0); i++) {
        pal[i] = (d[c + i * 3] << 16) | (d[c + i * 3 + 1] << 8) | d[c + i * 3 + 2];
      }
    } else if (type === 0x74524e53) {
      if (ctype === 3) {
        palA = new Uint8Array(256).fill(255);
        for (let i = 0; i < clen && i < 256; i++) palA[i] = d[c + i];
      } else if (ctype === 0) trnsG = be16(d, c);
      else if (ctype === 2) { trnsR = be16(d, c); trnsGr = be16(d, c + 2); trnsB = be16(d, c + 4); }
    } else if (type === 0x49444154) {
      idat.push(d.subarray(c, c + clen));
      idatLen += clen;
    } else if (type === 0x49454e44) {
      break;
    }
    p = c + clen + 4;
  }
  if (width <= 0 || height <= 0) throw new Error('PNG: missing IHDR');
  if (interlace) throw new Error('PNG: interlaced images unsupported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!channels) throw new Error(`PNG: bad colour type ${ctype}`);

  let z;
  if (idat.length === 1) z = idat[0];
  else {
    z = new Uint8Array(idatLen);
    let o = 0;
    for (const part of idat) { z.set(part, o); o += part.length; }
  }
  const bitsPP = channels * depth;
  const stride = (width * bitsPP + 7) >> 3;
  const bpp = Math.max(1, bitsPP >> 3);
  const raw = inflateZlib(z, 0, z.length, (stride + 1) * height);

  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  const out = new Int32Array(width * height);
  const scale = depth === 1 ? 255 : depth === 2 ? 85 : depth === 4 ? 17 : 1;
  for (let y = 0; y < height; y++) {
    const rp = y * (stride + 1);
    const filter = raw[rp];
    cur.set(raw.subarray(rp + 1, rp + 1 + stride));
    if (filter) {
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0;
        const b = prev[i];
        const cc = i >= bpp ? prev[i - bpp] : 0;
        let x = cur[i];
        if (filter === 1) x += a;
        else if (filter === 2) x += b;
        else if (filter === 3) x += (a + b) >> 1;
        else if (filter === 4) {
          const pa = Math.abs(b - cc);
          const pb = Math.abs(a - cc);
          const pc = Math.abs(a + b - 2 * cc);
          x += pa <= pb && pa <= pc ? a : pb <= pc ? b : cc;
        }
        cur[i] = x;
      }
    }
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let px;
      if (ctype === 3 || ctype === 0) {
        let s;
        if (depth === 8) s = cur[x];
        else {
          const bit = x * depth;
          s = (cur[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
        }
        if (ctype === 3) px = ((palA ? palA[s] : 255) << 24) | (pal ? pal[s] : 0);
        else {
          const g = s * scale;
          px = ((s === trnsG ? 0 : 255) << 24) | (g << 16) | (g << 8) | g;
        }
      } else if (ctype === 2) {
        const r = cur[x * 3], g = cur[x * 3 + 1], b = cur[x * 3 + 2];
        const a = r === trnsR && g === trnsGr && b === trnsB ? 0 : 255;
        px = (a << 24) | (r << 16) | (g << 8) | b;
      } else if (ctype === 4) {
        const g = cur[x * 2];
        px = (cur[x * 2 + 1] << 24) | (g << 16) | (g << 8) | g;
      } else {
        px = (cur[x * 4 + 3] << 24) | (cur[x * 4] << 16) | (cur[x * 4 + 1] << 8) | cur[x * 4 + 2];
      }
      out[row + x] = px;
    }
    const t = prev; prev = cur; cur = t;
  }
  return { width, height, argb: out };
}

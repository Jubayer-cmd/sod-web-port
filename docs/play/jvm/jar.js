// JAR (zip) reader. Runs entirely in the page: the file never leaves the visitor's browser.
import { inflateRaw } from './inflate.js';

async function inflateAsync(bytes, size) {
  if (typeof DecompressionStream === 'function') {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch { /* fall back to the JS inflater */ }
  }
  return inflateRaw(bytes, 0, bytes.length, size);
}

/** @returns {Promise<Map<string, Uint8Array>>} entry name -> contents (directories skipped) */
export async function readJar(buf) {
  const d = new Uint8Array(buf);
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  let eocd = -1;
  for (let i = d.length - 22; i >= Math.max(0, d.length - 22 - 65535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a JAR/zip file.');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const files = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt JAR central directory.');
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const usize = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(d.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = d.subarray(start, start + csize);
    if (method === 0) files.set(name, raw.slice());
    else if (method === 8) files.set(name, await inflateAsync(raw, usize));
    else throw new Error(`Unsupported compression in ${name}`);
  }
  return files;
}

/** Parses META-INF/MANIFEST.MF ("Key: value", continuation lines start with a space). */
export function parseManifest(bytes) {
  const props = new Map();
  if (!bytes) return props;
  const lines = new TextDecoder().decode(bytes).split(/\r?\n/);
  let last = null;
  for (const line of lines) {
    if (line.startsWith(' ') && last) {
      props.set(last, props.get(last) + line.slice(1));
      continue;
    }
    const i = line.indexOf(':');
    if (i <= 0) continue;
    last = line.slice(0, i).trim();
    props.set(last, line.slice(i + 1).trim());
  }
  return props;
}

export async function sha256Hex(buf) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
}

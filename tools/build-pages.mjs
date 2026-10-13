// Copies the browser runtime into docs/play/ for GitHub Pages. Only this project's own
// code is copied: the page loads the game from a file the visitor picks on their device.
import { cpSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = join(root, 'static');
const out = join(root, 'docs', 'play');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'jvm'), { recursive: true });
cpSync(join(src, 'play.html'), join(out, 'index.html'));
for (const f of ['host.js', 'display.js', 'controls.js', 'keymap.js', 'midi.js']) {
  cpSync(join(src, f), join(out, f));
}
for (const f of readdirSync(join(src, 'jvm'))) cpSync(join(src, 'jvm', f), join(out, 'jvm', f));
console.log(`docs/play/ updated (${readdirSync(out).length} entries)`);

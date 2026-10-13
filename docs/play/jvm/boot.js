// Boots a MIDlet from JAR bytes entirely in the browser: unzip, compile the bytecode to
// JavaScript, wire up the MIDP layer and call startApp().
import { readJar, parseManifest, sha256Hex } from './jar.js';
import { $, loadClasses } from './runtime.js';
import { configure, launch, setSmoothMotion, startFrameLoop, trackSprites } from './midp.js';

export { setSmoothMotion };

/** The one build the port is tested with (Soul of Darkness 1.0.1, 240x320 touch). */
export const KNOWN_SHA256 = '3da9ea7fe8dfaa2c090e8b3714eaed15127f51dc8b67ed9ef9fed51172e4bea4';

// Values from the original .jad, which players don't usually have. The URL-* entries
// pointed at a third-party store, so they are blanked; platformRequest never leaves the page.
const JAD_DEFAULTS = {
  'MIDlet-Data-Size': '2046',
  'URL-GLIVE': '0',
  'URL-PT': '0',
  'IGP-PROMOS': 'RF08=RF08;ASCR=ASCR;NYN2=NYN2;',
  'IGP-WN': 'BLB2=BLB2_WN;MIDP=MIDP_WN;LNUR=LNUR_WN;DITW=DITW_WN;',
  'IGP-BS': 'MBRC=MBRC_BS;MPL2=MPL2_BS;CSIM=CSIM_BS;BUBA=BUBA_BS;',
  'IGP-CATEGORIES': 'WN=WN;BS=BS;PROMO=PROMO;OP=OP;',
  'IGP-VERSION': '1.8',
};

/** Reads and checks a JAR without running anything. */
export async function inspectJar(buf) {
  const [hash, files] = await Promise.all([sha256Hex(buf), readJar(buf)]);
  const props = parseManifest(files.get('META-INF/MANIFEST.MF'));
  const midlet = (props.get('MIDlet-1') || '').split(',').map((s) => s.trim())[2];
  return { hash, files, props, midlet, known: hash === KNOWN_SHA256 };
}

/**
 * @param jar   result of inspectJar()
 * @param host  SODHost (host.js), already initialised
 * @param opts  { smooth: interpolate motion to the display rate, frameLoop: pace the game
 *              from requestAnimationFrame (browser only) }
 */
export function startGame(jar, host, opts = {}) {
  if (!jar.midlet) throw new Error('This JAR has no MIDlet-1 entry in its manifest.');
  const classFiles = [];
  for (const [name, bytes] of jar.files) {
    if (name.startsWith('META-INF/')) continue;
    if (name.endsWith('.class')) classFiles.push([name, bytes]);
    else $.resources.set(name, bytes);
  }
  const { classes } = loadClasses(classFiles);
  const main = classes[jar.midlet.replaceAll('.', '/')];
  if (!main) throw new Error(`MIDlet class ${jar.midlet} not found in the JAR.`);

  const props = new Map(Object.entries(JAD_DEFAULTS));
  for (const [k, v] of jar.props) props.set(k, v);

  // Context-aware OK key: on the weapon-upgrade screen (state 31) the bar fills while Fire
  // is held, everywhere else OK is the left soft key. Only known for the tested build.
  const state = jar.known ? classes.e : null;
  const resolveOk = state ? () => (state.S_F === 31 ? -5 : -6) : () => -6;

  // Sprite tracking for smooth motion. Class d is the game's sprite: a(Graphics, anim,
  // frame, x, y, flags, camX, camY) draws an animation frame and a(Graphics, frame, x, y,
  // flags, ox, oy) a single frame. Untested builds still get tile and camera motion.
  if (jar.known && classes.d) {
    trackSprites(classes.d, [
      ['a(Ljavax/microedition/lcdui/Graphics;IIIIIII)V', (a) => [a[2] - a[5], a[3] - a[6]]],
      ['a(Ljavax/microedition/lcdui/Graphics;IIIIII)V', (a) => [a[1], a[2]]],
    ]);
  }

  configure(host, { props, resolveOk });
  setSmoothMotion(!!opts.smooth);
  if (opts.frameLoop) startFrameLoop();
  return { midlet: launch(main), classes };
}

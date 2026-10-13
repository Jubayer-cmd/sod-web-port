// On-screen controls for touch (and mouse): a floating drag joystick plus action buttons.
// Every control tracks its own pointer, so moving and attacking can be held at once.

// Joystick sectors -> MIDP key codes. The game only performs a *diagonal* jump on phone
// keys 1/3 (up/2 jumps straight up), so up-left / up-right send those.
const SECTORS = [
  { from: -22.5, to: 22.5, code: -4 },     // right
  { from: 22.5, to: 67.5, code: 51 },      // jump right (3)
  { from: 67.5, to: 112.5, code: -1 },     // jump (up)
  { from: 112.5, to: 157.5, code: 49 },    // jump left (1)
  { from: 157.5, to: 202.5, code: -3 },    // left
  { from: 202.5, to: 247.5, code: -3 },    // down-left: keep walking left
  { from: 247.5, to: 292.5, code: -2 },    // crouch
  { from: 292.5, to: 337.5, code: -4 },    // down-right: keep walking right
];
const DEAD_ZONE = 14;     // px before the stick does anything
const HYSTERESIS = 10;    // degrees a drag must pass a sector edge before switching
const MAX_TRAVEL = 46;    // px the knob can move from its origin

const buzz = () => {
  try { navigator.vibrate?.(8); } catch {}
};

function inSector(s, a) {
  // a in [0, 360); sectors may straddle 0
  const lo = s.from;
  const hi = s.to;
  return (a >= lo && a < hi) || (a + 360 >= lo && a + 360 < hi) || (a - 360 >= lo && a - 360 < hi);
}

/**
 * @param {HTMLElement} zone  area that accepts the drag (the whole left panel)
 * @param {() => object|null} getHost  returns SODHost once the game has started
 */
export function attachJoystick(zone, getHost) {
  const base = zone.querySelector('.stick-base');
  const knob = zone.querySelector('.stick-knob');
  let pointer = null;
  let ox = 0;
  let oy = 0;
  let current = null; // active sector
  let angle = 0;

  const setCode = (next) => {
    if (next === current) return;
    const host = getHost();
    if (current && host) host.releaseKey(current.code);
    current = next;
    if (current && host) {
      host.pressKey(current.code);
      buzz();
    }
    zone.dataset.dir = current ? String(current.code) : '';
  };

  const place = (x, y) => {
    const r = zone.getBoundingClientRect();
    base.style.left = `${x - r.left}px`;
    base.style.top = `${y - r.top}px`;
  };

  const reset = () => {
    pointer = null;
    setCode(null);
    zone.classList.remove('active');
    knob.style.transform = 'translate(-50%, -50%)';
    base.style.left = '';
    base.style.top = '';
  };

  zone.addEventListener('pointerdown', (e) => {
    if (pointer !== null || !getHost()) return;
    e.preventDefault();
    pointer = e.pointerId;
    try { zone.setPointerCapture(e.pointerId); } catch {}
    ox = e.clientX;
    oy = e.clientY;
    place(ox, oy); // floating stick: it appears under the thumb
    zone.classList.add('active');
  });

  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointer) return;
    e.preventDefault();
    let dx = e.clientX - ox;
    let dy = e.clientY - oy;
    const len = Math.hypot(dx, dy);
    if (len > MAX_TRAVEL) {
      // Drag the origin along so reversing direction responds immediately.
      ox += (dx / len) * (len - MAX_TRAVEL);
      oy += (dy / len) * (len - MAX_TRAVEL);
      place(ox, oy);
      dx = e.clientX - ox;
      dy = e.clientY - oy;
    }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    if (Math.hypot(dx, dy) < DEAD_ZONE) {
      setCode(null);
      return;
    }
    angle = (Math.atan2(-dy, dx) * 180) / Math.PI;
    if (angle < 0) angle += 360;
    if (current) {
      const widened = { from: current.from - HYSTERESIS, to: current.to + HYSTERESIS };
      if (inSector(widened, angle)) return;
    }
    setCode(SECTORS.find((s) => inSector(s, angle)) || null);
  });

  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    zone.addEventListener(type, (e) => {
      if (e.pointerId === pointer) reset();
    });
  }
}

/** Buttons with data-key: press on touch-down, release on lift, slide-off or cancel. */
export function attachButtons(root, getHost) {
  for (const btn of root.querySelectorAll('[data-key]')) {
    const code = Number(btn.dataset.key);
    let pointer = null;
    const release = (e) => {
      if (pointer === null || (e && e.pointerId !== pointer)) return;
      pointer = null;
      btn.classList.remove('down');
      getHost()?.releaseKey(code);
    };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const host = getHost();
      if (!host || pointer !== null) return;
      pointer = e.pointerId;
      try { btn.setPointerCapture(e.pointerId); } catch {}
      btn.classList.add('down');
      host.pressKey(code);
      buzz();
    });
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('lostpointercapture', release);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}

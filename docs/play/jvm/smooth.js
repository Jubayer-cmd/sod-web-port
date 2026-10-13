// Motion estimation between two recorded frames (lists of draw calls) for smooth motion.
//
// For every draw call in the newest frame, work out how far the thing it draws moved
// since the previous frame:
//  - Sprites: draw calls made inside a tracked sprite method share one object anchor.
//    Objects are matched to the nearest object drawn with the same sprite last frame, so
//    an animation-frame change doesn't break the match.
//  - Everything else drawn from an image (tiles, backgrounds, HUD pieces) is matched by
//    identical image region. The most common displacement is the camera scroll; ties
//    between identical tiles are broken in its favour.
//  - Rectangles, lines and text don't move.
// Anything that can't be matched moves with the camera, or stays put when there is none.

const MAX_SPRITE_MOVE = 48; // px per game frame; beyond that it's a teleport/new object
const MAX_TILE_MOVE = 32;
const MIN_CAMERA_VOTES = 4;

const pos = (x, y) => (x + 4096) * 16384 + (y + 4096);

export function planMotion(prev, curr) {
  const n = curr.length;
  const dx = new Int16Array(n);
  const dy = new Int16Array(n);
  const plan = { moving: false, dx, dy, cdx: 0, cdy: 0, leftovers: [], leftoverAt: -1 };
  if (!prev || !prev.length) return plan;

  // ---- index the previous frame ----
  const prevSprites = new Map(); // sprite object -> [{x, y, used}]
  const seenGroups = new Set();
  const prevTiles = new Map(); // key -> { at: Map(pos -> index), list: [index] }
  for (let i = 0; i < prev.length; i++) {
    const c = prev[i];
    if (c.g) {
      if (!seenGroups.has(c.g)) {
        seenGroups.add(c.g);
        let l = prevSprites.get(c.g.s);
        if (!l) prevSprites.set(c.g.s, (l = []));
        l.push({ x: c.g.x, y: c.g.y, used: false });
      }
    } else if (c.key) {
      let b = prevTiles.get(c.key);
      if (!b) prevTiles.set(c.key, (b = { at: new Map(), list: [] }));
      b.at.set(pos(c.x, c.y), i);
      b.list.push(i);
    }
  }

  // ---- camera: the most common tile displacement ----
  const votes = new Map();
  for (const c of curr) {
    if (c.g || !c.key) continue;
    const b = prevTiles.get(c.key);
    if (!b || b.list.length > 64) continue;
    for (const j of b.list) {
      const ddx = c.x - prev[j].x;
      const ddy = c.y - prev[j].y;
      if (Math.abs(ddx) > MAX_TILE_MOVE || Math.abs(ddy) > MAX_TILE_MOVE) continue;
      const k = pos(ddx, ddy);
      votes.set(k, (votes.get(k) || 0) + 1);
    }
  }
  let best = pos(0, 0);
  let bestVotes = 0;
  for (const [k, v] of votes) {
    if (v > bestVotes || (v === bestVotes && k === pos(0, 0))) {
      best = k;
      bestVotes = v;
    }
  }
  let cdx = 0;
  let cdy = 0;
  if (bestVotes >= MIN_CAMERA_VOTES) {
    cdx = Math.floor(best / 16384) - 4096;
    cdy = (best % 16384) - 4096;
  }

  // ---- per draw call ----
  const usedPrev = new Uint8Array(prev.length);
  const groupMove = new Map();
  let keyed = 0;
  let matched = 0;
  for (let i = 0; i < n; i++) {
    const c = curr[i];
    let mx = 0;
    let my = 0;
    if (c.g) {
      let m = groupMove.get(c.g);
      if (!m) {
        m = [cdx, cdy];
        const l = prevSprites.get(c.g.s);
        if (l) {
          let bestD = Infinity;
          let pick = null;
          for (const o of l) {
            if (o.used) continue;
            const d = Math.abs(o.x - c.g.x) + Math.abs(o.y - c.g.y);
            if (d < bestD) { bestD = d; pick = o; }
          }
          if (pick && Math.abs(pick.x - c.g.x) <= MAX_SPRITE_MOVE && Math.abs(pick.y - c.g.y) <= MAX_SPRITE_MOVE) {
            pick.used = true;
            m = [c.g.x - pick.x, c.g.y - pick.y];
          }
        }
        groupMove.set(c.g, m);
      }
      [mx, my] = m;
    } else if (c.key) {
      keyed++;
      const b = prevTiles.get(c.key);
      let j;
      if (b && (j = b.at.get(pos(c.x - cdx, c.y - cdy))) !== undefined) {
        mx = cdx; my = cdy;
      } else if (b && (j = b.at.get(pos(c.x, c.y))) !== undefined) {
        mx = 0; my = 0;
      } else if (b) {
        let bestD = Infinity;
        for (const k of b.list) {
          const ddx = c.x - prev[k].x;
          const ddy = c.y - prev[k].y;
          const d = Math.abs(ddx) + Math.abs(ddy);
          if (d < bestD && Math.abs(ddx) <= MAX_TILE_MOVE && Math.abs(ddy) <= MAX_TILE_MOVE) {
            bestD = d; j = k; mx = ddx; my = ddy;
          }
        }
        if (j === undefined) { mx = cdx; my = cdy; }
      } else {
        mx = cdx; my = cdy; // new on screen this frame: assume it's part of the world
      }
      if (j !== undefined) {
        usedPrev[j] = 1;
        matched++;
      }
    }
    dx[i] = mx;
    dy[i] = my;
    if (mx || my) plan.moving = true;
  }

  // A different screen (menu, cutscene cut, level change): just show the new frame.
  if (keyed > 8 && matched < keyed * 0.3) {
    plan.moving = false;
    dx.fill(0);
    dy.fill(0);
    return plan;
  }

  // Tiles that scrolled off since the previous frame keep filling the screen edge until
  // the camera has moved past them.
  if (cdx || cdy) {
    plan.cdx = cdx;
    plan.cdy = cdy;
    for (let j = 0; j < prev.length; j++) {
      const c = prev[j];
      if (!usedPrev[j] && !c.g && c.key) plan.leftovers.push(j);
    }
    for (let i = 0; i < n; i++) {
      if (!curr[i].g && curr[i].key && dx[i] === cdx && dy[i] === cdy) { plan.leftoverAt = i; break; }
    }
  }
  return plan;
}

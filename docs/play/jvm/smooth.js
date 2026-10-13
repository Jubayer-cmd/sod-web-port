// Motion estimation between two recorded frames (lists of draw calls) for smooth motion.
//
// For every draw call in the newest frame, work out how far the thing it draws moved
// since the previous frame:
//  - Sprites: draw calls made inside a tracked sprite method share one object anchor.
//    Objects are matched to the nearest object drawn with the same sprite last frame, so
//    an animation-frame change doesn't break the match.
//  - Tiles and other image pieces: the screen is made of scrolling layers (foreground,
//    parallax backgrounds, the fixed HUD), each moving by its own amount. Each layer's
//    motion is found by testing candidate offsets against the whole frame; every tile is
//    then given the layer motion that puts it exactly on an identical tile from before.
//    Tiles new on screen move like the rest of their tileset image.
//  - Rectangles, lines and text don't move.

const MAX_SPRITE_MOVE = 48; // px per game frame; beyond that it's a teleport/new object
const MAX_TILE_MOVE = 32;
const MIN_LAYER_TILES = 4;
const MAX_LAYERS = 4;

const pos = (x, y) => (x + 4096) * 16384 + (y + 4096);
const unpack = (k) => [Math.floor(k / 16384) - 4096, (k % 16384) - 4096];
let lastLayers = [];

// Size of a recorded image draw, for "has it left the screen" tests.
function size(c) {
  if (c.op.startsWith('drawRegion')) return c.a[5] >= 4 ? [c.a[4], c.a[3]] : [c.a[3], c.a[4]];
  return [c.a[0]._w, c.a[0]._h];
}

export function planMotion(prev, curr) {
  const n = curr.length;
  const dx = new Int16Array(n);
  const dy = new Int16Array(n);
  const plan = { moving: false, dx, dy, leftovers: [] };
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
  const tiles = [];
  for (let i = 0; i < n; i++) if (!curr[i].g && curr[i].key) tiles.push(i);

  // ---- layer motions ----
  // Candidates come from tiles with few look-alikes (a brick repeated every 16 px can't
  // tell a 14 px scroll from -2 px), plus last frame's layers. Each candidate is scored by
  // how many tiles it lines up exactly; layers are taken greedily, so tiles explained by a
  // stronger layer don't count again for a weaker one.
  const candidates = new Set([pos(0, 0), ...lastLayers]);
  for (const i of tiles) {
    const c = curr[i];
    const b = prevTiles.get(c.key);
    if (!b || b.list.length > 4) continue;
    for (const j of b.list) {
      const ddx = c.x - prev[j].x;
      const ddy = c.y - prev[j].y;
      if (Math.abs(ddx) <= MAX_TILE_MOVE && Math.abs(ddy) <= MAX_TILE_MOVE) candidates.add(pos(ddx, ddy));
    }
  }
  const lines = new Map(); // candidate -> Set of tile indices it lines up
  for (const k of candidates) {
    const [kx, ky] = unpack(k);
    const hit = new Set();
    for (const i of tiles) {
      const c = curr[i];
      if (prevTiles.get(c.key)?.at.has(pos(c.x - kx, c.y - ky))) hit.add(i);
    }
    lines.set(k, hit);
  }
  const layers = [];
  const claimed = new Set();
  while (layers.length < MAX_LAYERS) {
    let best = -1;
    let bestScore = 0;
    for (const [k, hit] of lines) {
      let fresh = 0;
      for (const i of hit) if (!claimed.has(i)) fresh++;
      // Prefer motions seen last frame and standing still when counts are close.
      const score = fresh * (lastLayers.includes(k) ? 1.1 : 1) + (k === pos(0, 0) ? 0.5 : 0);
      if (fresh >= MIN_LAYER_TILES && score > bestScore) {
        bestScore = score;
        best = k;
      }
    }
    if (best < 0) break;
    layers.push(best);
    for (const i of lines.get(best)) claimed.add(i);
    lines.delete(best);
  }
  lastLayers = layers;
  // The main layer (most tiles) stands in for "the world" where nothing else is known.
  const [mainX, mainY] = layers.length ? unpack(layers[0]) : [0, 0];

  // ---- tiles ----
  const usedPrev = new Uint8Array(prev.length);
  const imageVotes = new Map(); // image id -> Map(motion -> count)
  const resolved = new Uint8Array(n);
  const vote = (c, mx, my) => {
    const img = c.a[0]._id;
    let v = imageVotes.get(img);
    if (!v) imageVotes.set(img, (v = new Map()));
    const k = pos(mx, my);
    v.set(k, (v.get(k) || 0) + 1);
  };
  let matched = 0;
  for (const i of tiles) {
    const c = curr[i];
    const b = prevTiles.get(c.key);
    if (!b) continue;
    let j;
    for (const k of layers) {
      const [kx, ky] = unpack(k);
      j = b.at.get(pos(c.x - kx, c.y - ky));
      if (j !== undefined) {
        dx[i] = kx;
        dy[i] = ky;
        break;
      }
    }
    if (j === undefined && (j = b.at.get(pos(c.x, c.y))) === undefined && b.list.length <= 4) {
      // A lone tile moving on its own (a platform, a door): nearest identical one.
      let bestD = Infinity;
      for (const k of b.list) {
        const ddx = c.x - prev[k].x;
        const ddy = c.y - prev[k].y;
        const d = Math.abs(ddx) + Math.abs(ddy);
        if (d < bestD && Math.abs(ddx) <= MAX_TILE_MOVE && Math.abs(ddy) <= MAX_TILE_MOVE) {
          bestD = d;
          j = k;
          dx[i] = ddx;
          dy[i] = ddy;
        }
      }
    }
    if (j !== undefined) {
      usedPrev[j] = 1;
      resolved[i] = 1;
      matched++;
      vote(c, dx[i], dy[i]);
    }
  }
  const imageMotion = (c) => {
    const v = imageVotes.get(c.a[0]._id);
    if (!v) return [mainX, mainY];
    let best = 0;
    let bk = pos(mainX, mainY);
    for (const [k, count] of v) if (count > best) { best = count; bk = k; }
    return unpack(bk);
  };
  for (const i of tiles) {
    if (resolved[i]) continue;
    [dx[i], dy[i]] = imageMotion(curr[i]); // new on screen: move with its tileset
  }

  // A different screen (menu, cutscene cut, level change): just show the new frame.
  if (tiles.length > 8 && matched < tiles.length * 0.3) {
    lastLayers = [];
    return plan;
  }

  // ---- sprites ----
  const groupMove = new Map();
  for (let i = 0; i < n; i++) {
    const c = curr[i];
    if (!c.g) continue;
    let m = groupMove.get(c.g);
    if (!m) {
      m = [mainX, mainY]; // a new object: assume it belongs to the world
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
    [dx[i], dy[i]] = m;
  }

  for (let i = 0; i < n; i++) {
    if (dx[i] || dy[i]) {
      plan.moving = true;
      break;
    }
  }

  // ---- edges ----
  // Tiles that scrolled fully off screen in the newest frame are still drawn while the
  // picture catches up, so the edge isn't left bare. They go in just before the first
  // tile of their layer, keeping the original layering.
  const firstOfImage = new Map();
  for (const i of tiles) if (!firstOfImage.has(curr[i].a[0]._id)) firstOfImage.set(curr[i].a[0]._id, i);
  const leftovers = [];
  for (let j = 0; j < prev.length; j++) {
    const c = prev[j];
    if (usedPrev[j] || c.g || !c.key) continue;
    const [mx, my] = imageMotion(c);
    if (!mx && !my) continue;
    const [w, h] = size(c);
    const x = c.x + mx;
    const y = c.y + my;
    const gone = x + w <= c.c0 || x >= c.c2 || y + h <= c.c1 || y >= c.c3;
    if (!gone) continue;
    leftovers.push({ j, mx, my, at: firstOfImage.get(c.a[0]._id) ?? 0 });
  }
  plan.leftovers = leftovers.sort((a, b) => a.at - b.at);
  return plan;
}

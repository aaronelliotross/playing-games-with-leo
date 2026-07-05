// An endless, forward-only world. The path always advances (its heading is
// clamped so it can never point "backward"), so you never loop or double back.
// Scenery is generated deterministically per spatial tile and culled to the
// viewport, so the world is infinite, never repeats, and stays cheap.

function hashInt(n) {
  n = (n ^ 0x9e3779b9) >>> 0;
  n = Math.imul(n ^ (n >>> 16), 0x21f0aaad) >>> 0;
  n = Math.imul(n ^ (n >>> 15), 0x735a2d97) >>> 0;
  n = (n ^ (n >>> 15)) >>> 0;
  return n / 4294967296;
}
export function hash2(i, j, seed) {
  return hashInt((Math.imul(i | 0, 73856093) ^ Math.imul(j | 0, 19349663) ^ Math.imul(seed | 0, 83492791)) >>> 0);
}
export function hash1(i, seed) {
  return hashInt((Math.imul(i | 0, 2654435761) ^ Math.imul(seed | 0, 40503)) >>> 0);
}

// Smooth value noise in [-1, 1].
function makeNoise(seed) {
  return (t) => {
    const i = Math.floor(t);
    const f = t - i;
    const a = hash1(i, seed) * 2 - 1;
    const b = hash1(i + 1, seed) * 2 - 1;
    const u = f * f * (3 - 2 * f);
    return a + (b - a) * u;
  };
}

function sampleArc(state, arc) {
  const { pts, cum, total } = state;
  const a = Math.max(0, Math.min(total, arc));
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < a) lo = mid + 1;
    else hi = mid;
  }
  const i = Math.max(1, lo);
  const seg = cum[i] - cum[i - 1] || 1;
  const f = (a - cum[i - 1]) / seg;
  return {
    x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f,
    y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f,
  };
}

function windowPoints(state, a0, a1) {
  const { cum } = state;
  const out = [sampleArc(state, a0)];
  for (let i = 0; i < cum.length; i++) {
    if (cum[i] > a0 && cum[i] < a1) out.push(state.pts[i]);
  }
  out.push(sampleArc(state, a1));
  return out;
}

// Organic forward path: heading wanders within +/- maxTurn of "north" (-y), so
// every step has a negative y-component — strictly forward, never doubling back.
export function createOrganicWorld(seed) {
  const noise = makeNoise(seed);
  const base = -Math.PI / 2;
  const maxTurn = 1.05; // < PI/2 keeps forward progress guaranteed
  const freq = 0.16;
  const pts = [{ x: 0, y: 0 }];
  const cum = [0];
  const state = { pts, cum, total: 0 };
  let i = 0;
  state.extend = (toArc) => {
    while (state.total < toArc) {
      const h = base + maxTurn * noise(i * freq);
      const last = pts[pts.length - 1];
      pts.push({ x: last.x + Math.cos(h), y: last.y + Math.sin(h) });
      state.total += 1;
      cum.push(state.total);
      i++;
    }
  };
  state.sample = (arc) => sampleArc(state, arc);
  state.window = (a0, a1) => windowPoints(state, a0, a1);
  return state;
}

// Forward-only city grid path: moves north, with the odd single east/west jog
// (never south, never an immediate reversal), so it never retraces.
export function createGridWorld(seed, block) {
  const pts = [{ x: 0, y: 0 }];
  const cum = [0];
  const state = { pts, cum, total: 0 };
  let i = 0;
  let lastHoriz = 0;
  state.extend = (toArc) => {
    while (state.total < toArc) {
      const r = hash1(i, seed);
      let dx = 0;
      let dy = 0;
      if (r < 0.16) {
        const east = lastHoriz === -1 ? true : lastHoriz === 1 ? false : hash1(i, seed * 7) < 0.5;
        dx = east ? block : -block;
        lastHoriz = east ? 1 : -1;
      } else {
        dy = -block;
        lastHoriz = 0;
      }
      const last = pts[pts.length - 1];
      pts.push({ x: last.x + dx, y: last.y + dy });
      state.total += block;
      cum.push(state.total);
      i++;
    }
  };
  state.sample = (arc) => sampleArc(state, arc);
  state.window = (a0, a1) => windowPoints(state, a0, a1);
  return state;
}

// --- Tile-based scenery (viewport-culled, deterministic per cell) ---

export function treesInRect(seed, rect, cell = 3, density = 0.5) {
  const [minX, minY, maxX, maxY] = rect;
  const out = [];
  for (let gi = Math.floor(minX / cell); gi <= Math.ceil(maxX / cell); gi++) {
    for (let gj = Math.floor(minY / cell); gj <= Math.ceil(maxY / cell); gj++) {
      if (hash2(gi, gj, seed) < density) {
        out.push({
          key: `t${gi}_${gj}`,
          x: (gi + hash2(gi, gj, seed + 1)) * cell,
          y: (gj + hash2(gi, gj, seed + 2)) * cell,
          r: 1.0 + hash2(gi, gj, seed + 3) * 1.6,
        });
      }
    }
  }
  return out;
}

export function mountainsInRect(seed, rect, cell = 17, prob = 0.42) {
  const [minX, minY, maxX, maxY] = rect;
  const out = [];
  for (let gi = Math.floor(minX / cell); gi <= Math.ceil(maxX / cell); gi++) {
    for (let gj = Math.floor(minY / cell); gj <= Math.ceil(maxY / cell); gj++) {
      if (hash2(gi, gj, seed) < prob) {
        out.push({
          key: `m${gi}_${gj}`,
          cx: (gi + 0.2 + hash2(gi, gj, seed + 1) * 0.6) * cell,
          cy: (gj + 0.2 + hash2(gi, gj, seed + 2) * 0.6) * cell,
          R: 6 + hash2(gi, gj, seed + 3) * 8,
          seed: 1 + Math.floor(hash2(gi, gj, seed + 4) * 1e9),
        });
      }
    }
  }
  return out;
}

export function cityInRect(seed, rect, block = 7) {
  const [minX, minY, maxX, maxY] = rect;
  const inset = 1.3;
  const cell = block - 2 * inset;
  const buildings = [];
  const parks = [];
  for (let gi = Math.floor(minX / block) - 1; gi <= Math.ceil(maxX / block); gi++) {
    for (let gj = Math.floor(minY / block) - 1; gj <= Math.ceil(maxY / block); gj++) {
      const r = hash2(gi, gj, seed);
      const x0 = gi * block + inset;
      const y0 = gj * block + inset;
      if (r < 0.12) {
        parks.push({ key: `pk${gi}_${gj}`, x: x0, y: y0, w: cell, h: cell });
      } else {
        const shrink = hash2(gi, gj, seed + 5) * 1.4;
        buildings.push({
          key: `b${gi}_${gj}`,
          x: x0 + shrink * 0.5,
          y: y0 + shrink * 0.5,
          w: cell - shrink,
          h: cell - shrink,
          shade: Math.floor(hash2(gi, gj, seed + 6) * 6),
        });
      }
    }
  }
  return { buildings, parks };
}

// Rivers cross the world at regular "forward" intervals. Because the path is
// monotonic in y, it crosses each river exactly once — one bridge per river.
export function riversInView(seed, world, arc, backArc, aheadArc, spacing) {
  const near = world.sample(Math.max(0, arc - backArc));
  const far = world.sample(arc + aheadArc);
  const yTop = Math.min(near.y, far.y);
  const yBot = Math.max(near.y, far.y);
  const rivers = [];
  const m0 = Math.floor(yTop / spacing) - 1;
  const m1 = Math.ceil(yBot / spacing) + 1;
  for (let m = m0; m <= m1; m++) {
    const level = m * spacing;
    // Find the arc where the path crosses this y (monotonic search).
    let a = Math.max(0, arc - backArc);
    const b = arc + aheadArc;
    let cross = null;
    const steps = 48;
    let prev = world.sample(a);
    for (let s = 1; s <= steps; s++) {
      const t = a + ((b - a) * s) / steps;
      const p = world.sample(t);
      if ((prev.y - level) * (p.y - level) <= 0) {
        cross = p;
        break;
      }
      prev = p;
    }
    rivers.push({ key: `r${m}`, level, cross });
  }
  return rivers;
}

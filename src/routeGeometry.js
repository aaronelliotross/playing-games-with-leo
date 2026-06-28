// Pure helpers for the procedural walking route. A route is just a meandering
// polyline in abstract "units"; the pin advances along it by arc length as a
// fraction (progress 0..1). Seeded per hike so each route is distinct but stable.

export function hashId(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}

export function makeRoute(seed, n = 160) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  let x = 0;
  let y = 0;
  let ang = -Math.PI / 2; // generally heading "north" (up)
  const pts = [{ x, y }];
  for (let i = 0; i < n; i++) {
    // Wander, with a gentle pull back toward north so the route keeps progressing.
    ang += (rand() - 0.5) * 0.8 + (-Math.PI / 2 - ang) * 0.04;
    x += Math.cos(ang);
    y += Math.sin(ang);
    pts.push({ x, y });
  }
  return pts;
}

export function buildPath(points) {
  const cum = [0];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    total += Math.hypot(dx, dy);
    cum.push(total);
  }
  return { points, cum, total };
}

export function pointAt(built, t) {
  const { points, cum, total } = built;
  if (t <= 0) return { ...points[0] };
  if (t >= 1) return { ...points[points.length - 1] };
  const target = t * total;
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  const i = Math.max(1, lo);
  const segLen = cum[i] - cum[i - 1] || 1;
  const f = (target - cum[i - 1]) / segLen;
  return {
    x: points[i - 1].x + (points[i].x - points[i - 1].x) * f,
    y: points[i - 1].y + (points[i].y - points[i - 1].y) * f,
  };
}

// Points from the start up to fraction t (for drawing the traveled portion).
export function sliceTo(built, t) {
  const { points, cum, total } = built;
  if (t <= 0) return [points[0]];
  if (t >= 1) return points.slice();
  const target = t * total;
  const out = [];
  for (let i = 0; i < points.length; i++) {
    if (cum[i] <= target) out.push(points[i]);
    else break;
  }
  out.push(pointAt(built, t));
  return out;
}

export function bounds(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function makeStars(seed, n = 60) {
  let s = (seed ^ 0x9e3779b9) % 2147483647;
  if (s <= 0) s += 2147483646;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const stars = [];
  for (let i = 0; i < n; i++) {
    stars.push({ x: rand(), y: rand(), r: 0.5 + rand() * 1.4 });
  }
  return stars;
}

function seededRand(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

export const CITY_BLOCK = 7;

// A route that follows a street grid: straight legs along blocks with the odd
// right-angle turn, biased to keep heading "north" so the walk progresses.
export function makeCityRoute(seed, n = 46) {
  const rand = seededRand(seed);
  const dirs = [
    { x: 0, y: -1 }, // N
    { x: 1, y: 0 }, // E
    { x: 0, y: 1 }, // S
    { x: -1, y: 0 }, // W
  ];
  let d = 0; // start north
  let gx = 0;
  let gy = 0;
  const pts = [{ x: 0, y: 0 }];
  for (let i = 0; i < n; i++) {
    if (rand() < 0.3) {
      const turn = rand() < 0.5 ? 1 : 3; // right or left
      let nd = (d + turn) % 4;
      // avoid heading south most of the time so the route keeps advancing
      if (dirs[nd].y > 0 && rand() < 0.75) nd = d;
      d = nd;
    }
    gx += dirs[d].x;
    gy += dirs[d].y;
    pts.push({ x: gx * CITY_BLOCK, y: gy * CITY_BLOCK });
  }
  return pts;
}

// Building footprints (and occasional parks) filling the blocks around the
// route. Returned in route units; capped so big routes stay cheap.
export function makeCityScenery(seed, built, maxCells = 700) {
  const rand = seededRand(seed ^ 0x5bd1e995);
  const b = bounds(built.points);
  const gi0 = Math.floor(b.minX / CITY_BLOCK) - 2;
  const gi1 = Math.ceil(b.maxX / CITY_BLOCK) + 2;
  const gj0 = Math.floor(b.minY / CITY_BLOCK) - 2;
  const gj1 = Math.ceil(b.maxY / CITY_BLOCK) + 2;
  const inset = 1.3;
  const cell = CITY_BLOCK - 2 * inset;
  const buildings = [];
  const parks = [];
  let count = 0;
  for (let gi = gi0; gi < gi1; gi++) {
    for (let gj = gj0; gj < gj1; gj++) {
      if (count++ > maxCells) break;
      const r = rand();
      const x0 = gi * CITY_BLOCK + inset;
      const y0 = gj * CITY_BLOCK + inset;
      if (r < 0.12) {
        parks.push({ x: x0, y: y0, w: cell, h: cell });
        continue;
      }
      const shrink = rand() * 1.4;
      buildings.push({
        x: x0 + shrink * 0.5,
        y: y0 + shrink * 0.5,
        w: cell - shrink,
        h: cell - shrink,
        shade: Math.floor(rand() * 6),
      });
    }
  }
  return { buildings, parks };
}

// A closed loop the player walks around in the zoomed nav view. Closed (last
// point == first) so looping the arc never jumps. City = a grid block circuit;
// otherwise an organic blob.
export function makeLoopRoute(kind, seed) {
  const rand = seededRand(seed ^ 0x1234567);
  if (kind === 'city') {
    const W = 5 + Math.floor(rand() * 4); // 5..8 blocks
    const H = 5 + Math.floor(rand() * 4);
    const grid = [];
    for (let i = 0; i <= W; i++) grid.push({ x: i, y: 0 });
    for (let j = 1; j <= H; j++) grid.push({ x: W, y: j });
    for (let i = W - 1; i >= 0; i--) grid.push({ x: i, y: H });
    for (let j = H - 1; j >= 1; j--) grid.push({ x: 0, y: j });
    grid.push({ x: 0, y: 0 });
    return grid.map((p) => ({ x: p.x * CITY_BLOCK, y: p.y * CITY_BLOCK }));
  }
  const M = 48;
  const R = 9 + rand() * 5;
  const p1 = rand() * Math.PI * 2;
  const p2 = rand() * Math.PI * 2;
  const p3 = rand() * Math.PI * 2;
  const pts = [];
  for (let k = 0; k < M; k++) {
    const a = (2 * Math.PI * k) / M;
    const rr = R * (1 + 0.16 * Math.sin(2 * a + p1) + 0.1 * Math.sin(3 * a + p2) + 0.06 * Math.sin(5 * a + p3));
    pts.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr });
  }
  pts.push({ ...pts[0] });
  return pts;
}

// Trees scattered through the route's bounding area.
export function makeTrailScenery(seed, built, n = 110) {
  const rand = seededRand(seed ^ 0x27d4eb2f);
  const b = bounds(built.points);
  const pad = 5;
  const trees = [];
  for (let i = 0; i < n; i++) {
    trees.push({
      x: b.minX - pad + rand() * (b.maxX - b.minX + 2 * pad),
      y: b.minY - pad + rand() * (b.maxY - b.minY + 2 * pad),
      r: 1.1 + rand() * 1.7,
    });
  }
  return { trees };
}

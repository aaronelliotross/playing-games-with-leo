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

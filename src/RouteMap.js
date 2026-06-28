import React, { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Polyline, Polygon, Circle, G, Rect } from 'react-native-svg';
import {
  hashId,
  makeRoute,
  makeCityRoute,
  makeLoopRoute,
  buildPath,
  pointAt,
  sliceTo,
  bounds,
  makeStars,
  makeCityScenery,
  makeTrailScenery,
  makeMountains,
  makeRiver,
  wobblyRing,
} from './routeGeometry';
import { AT_SHAPE } from './atShape';

const seededRand = (seed) => {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
};

// Topographic contour bands for a mountain, forested base -> rocky summit.
const MTN_BANDS = [
  { f: 1.0, fill: '#46663a' },
  { f: 0.74, fill: '#5d8047' },
  { f: 0.5, fill: '#869a5d' },
  { f: 0.28, fill: '#bcb085' },
];
const MTN_STROKE = 'rgba(40,55,30,0.35)';

function ptsToStr(points, scale) {
  return points.map((p) => `${(p.x * scale).toFixed(1)},${(p.y * scale).toFixed(1)}`).join(' ');
}

// dawn -> day -> dusk -> night, cycling every DAY_STEPS steps.
const DAY_STEPS = 220;
function skyState(steps) {
  const p = (((steps / DAY_STEPS) % 1) + 1) % 1;
  const keys = [
    { p: 0, o: [255, 150, 70, 0.16] },
    { p: 0.22, o: [255, 255, 255, 0.0] },
    { p: 0.5, o: [255, 110, 50, 0.2] },
    { p: 0.72, o: [8, 14, 40, 0.52] },
    { p: 1, o: [255, 150, 70, 0.16] },
  ];
  let o = keys[0].o;
  for (let i = 1; i < keys.length; i++) {
    if (p <= keys[i].p) {
      const k0 = keys[i - 1];
      const k1 = keys[i];
      const f = (p - k0.p) / (k1.p - k0.p || 1);
      o = k0.o.map((v, j) => v + (k1.o[j] - v) * f);
      break;
    }
  }
  const night = Math.max(0, 1 - Math.min(1, Math.abs(p - 0.72) / 0.28));
  const isMoon = p >= 0.5;
  const sp = isMoon ? (p - 0.5) / 0.5 : p / 0.5;
  return {
    overlay: `rgba(${Math.round(o[0])},${Math.round(o[1])},${Math.round(o[2])},${o[3].toFixed(3)})`,
    night,
    isMoon,
    sp,
  };
}

// Whole-route overview inset size (portrait for the tall AT shape).
const OVERVIEW_PAD = 10;
function overviewSize(kind) {
  return kind === 'appalachian' ? { w: 88, h: 128 } : { w: 116, h: 84 };
}

const BUILDING_SHADES = ['#9aa6b2', '#8e99a6', '#a8a594', '#b3a892', '#9fa894', '#8f9bb0'];

const THEMES = {
  trail: {
    kind: 'trail',
    zoom: 13,
    stepWorld: 0.7, // route units advanced per step in the nav view
    bg: '#dfe6cf',
    route: '#b79a63',
    traveled: '#8a6a39',
    pin: '#5b4a25',
    tree: '#5f8d4e',
    treeRing: '#456b38',
  },
  city: {
    kind: 'city',
    zoom: 8,
    stepWorld: 1.4,
    bg: '#c0c5cc',
    route: '#2f6df0',
    traveled: '#1d4ed8',
    pin: '#1d4ed8',
    park: '#9cc08a',
    buildingStroke: 'rgba(0,0,0,0.14)',
  },
  space: {
    kind: 'space',
    zoom: 13,
    stepWorld: 0.7,
    bg: '#0b0d1a',
    route: '#343a54',
    traveled: '#9fb3ff',
    pin: '#eaf0ff',
    stars: true,
  },
  appalachian: {
    kind: 'appalachian',
    zoom: 13,
    stepWorld: 0.5,
    bg: '#cdd9b8',
    route: '#9c7b46',
    traveled: '#6f5128',
    pin: '#4a3a1d',
    tree: '#4f7d3e',
    treeRing: '#3a5e2c',
    river: '#74a7c4',
    riverEdge: '#5b8aa6',
    bridge: '#7a5a3a',
    dayNight: true,
  },
};
const THEME_BY_HIKE = {
  corner_store: 'city',
  around_the_block: 'city',
  walk_to_the_moon: 'space',
  appalachian_trail: 'appalachian',
};
function themeFor(hike) {
  return THEMES[THEME_BY_HIKE[hike.id]] || THEMES.trail;
}

function toPolyline(points, scale, ox = 0, oy = 0) {
  return points
    .map((p) => `${(ox + p.x * scale).toFixed(1)},${(oy + p.y * scale).toFixed(1)}`)
    .join(' ');
}

// Static, world-space scenery, memoized by the caller so elements keep
// referential identity across frames (only the parent <G> transform changes).
function buildScenery(theme, loop, seed) {
  const Z = theme.zoom;
  if (theme.kind === 'city') {
    const { buildings, parks } = makeCityScenery(seed, loop);
    const els = [];
    parks.forEach((p, i) =>
      els.push(
        <Rect key={`pk${i}`} x={p.x * Z} y={p.y * Z} width={p.w * Z} height={p.h * Z} rx={2} fill={theme.park} />
      )
    );
    buildings.forEach((b, i) =>
      els.push(
        <Rect
          key={`b${i}`}
          x={b.x * Z}
          y={b.y * Z}
          width={b.w * Z}
          height={b.h * Z}
          fill={BUILDING_SHADES[b.shade]}
          stroke={theme.buildingStroke}
          strokeWidth={1}
        />
      )
    );
    return els;
  }
  if (theme.kind === 'trail') {
    const { trees } = makeTrailScenery(seed, loop);
    return trees.map((t, i) => (
      <Circle key={`t${i}`} cx={t.x * Z} cy={t.y * Z} r={t.r * Z} fill={theme.tree} stroke={theme.treeRing} strokeWidth={1} />
    ));
  }
  if (theme.kind === 'appalachian') {
    const els = [];
    const b = bounds(loop.points);

    // Mountains (topographic contour bands), behind everything.
    makeMountains(seed, b, 11).forEach((pk, pi) => {
      const r = seededRand(pk.seed);
      MTN_BANDS.forEach((band, bi) => {
        els.push(
          <Polygon
            key={`m${pi}-${bi}`}
            points={ptsToStr(wobblyRing(pk.cx, pk.cy, pk.R * band.f, r), Z)}
            fill={band.fill}
            stroke={bi === 0 ? MTN_STROKE : undefined}
            strokeWidth={bi === 0 ? 1.5 : undefined}
          />
        );
      });
    });

    // River band crossing the area, with a bridge at each trail crossing.
    const river = makeRiver(seed, loop);
    const diag = Math.hypot(b.maxX - b.minX, b.maxY - b.minY) * 1.3 + 10;
    const { cx, cy, dir, N, width } = river;
    const corner = (s1, s2) => ({
      x: cx + dir.x * s1 * (diag / 2) + N.x * s2 * (width / 2),
      y: cy + dir.y * s1 * (diag / 2) + N.y * s2 * (width / 2),
    });
    els.push(
      <Polygon
        key="river"
        points={ptsToStr([corner(1, 1), corner(1, -1), corner(-1, -1), corner(-1, 1)], Z)}
        fill={theme.river}
        stroke={theme.riverEdge}
        strokeWidth={1.5}
      />
    );
    river.crossings.forEach((cr, ci) => {
      const u = { x: Math.cos(cr.ang), y: Math.sin(cr.ang) }; // along trail
      const n = { x: -u.y, y: u.x };
      const len = width + 1.8;
      const th = 1.9;
      const bc = (s1, s2) => ({
        x: cr.x + u.x * s1 * (len / 2) + n.x * s2 * (th / 2),
        y: cr.y + u.y * s1 * (len / 2) + n.y * s2 * (th / 2),
      });
      els.push(
        <Polygon
          key={`br${ci}`}
          points={ptsToStr([bc(1, 1), bc(1, -1), bc(-1, -1), bc(-1, 1)], Z)}
          fill={theme.bridge}
          stroke="#5e4329"
          strokeWidth={1}
        />
      );
    });

    // Forest on top — patchy enough to let the mountains show through.
    const { trees } = makeTrailScenery(seed, loop, 150);
    trees.forEach((t, i) =>
      els.push(
        <Circle key={`t${i}`} cx={t.x * Z} cy={t.y * Z} r={t.r * Z * 0.82} fill={theme.tree} stroke={theme.treeRing} strokeWidth={1} />
      )
    );
    return els;
  }
  return null;
}

// Whole-journey minimap with the pin at the true overall fraction.
function Overview({ built, progress, theme }) {
  const { w: OW, h: OH } = overviewSize(theme.kind);
  const b = useMemo(() => bounds(built.points), [built]);
  const spanX = b.maxX - b.minX || 1;
  const spanY = b.maxY - b.minY || 1;
  const scale = Math.min((OW - 2 * OVERVIEW_PAD) / spanX, (OH - 2 * OVERVIEW_PAD) / spanY);
  const offX = (OW - spanX * scale) / 2 - b.minX * scale;
  const offY = (OH - spanY * scale) / 2 - b.minY * scale;

  const all = useMemo(() => toPolyline(built.points, scale, offX, offY), [built, scale, offX, offY]);
  const traveled = toPolyline(sliceTo(built, progress), scale, offX, offY);
  const pin = pointAt(built, progress);

  return (
    <View style={[styles.overview, { width: OW + 8, height: OH + 8 }]}>
      <Svg width={OW} height={OH}>
        <Polyline points={all} fill="none" stroke="#8d8a80" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
        <Polyline points={traveled} fill="none" stroke={theme.traveled} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
        <Circle cx={offX + pin.x * scale} cy={offY + pin.y * scale} r={3.4} fill={theme.pin} stroke="#fff" strokeWidth={1.2} />
      </Svg>
    </View>
  );
}

// A real stretch of the Appalachian Trail, recentered and scaled, used as the
// open path the nav view walks (out-and-back). Real geometry, real bends.
function atSectionPoints() {
  const slice = AT_SHAPE.slice(90, 230);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  slice.forEach((p) => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  });
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const s = 58 / (Math.max(maxX - minX, maxY - minY) || 1);
  return slice.map((p) => ({ x: (p.x - cx) * s, y: (p.y - cy) * s }));
}

export default function RouteMap({ hike, steps }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const seed = useMemo(() => hashId(hike.id), [hike.id]);
  const theme = useMemo(() => themeFor(hike), [hike.id]);
  const Z = theme.zoom;

  // The zoomed nav view follows a local path, advancing a fixed distance per
  // step. The AT traces a real trail section (out-and-back); others loop.
  const localPath = useMemo(
    () => buildPath(theme.kind === 'appalachian' ? atSectionPoints() : makeLoopRoute(theme.kind, seed)),
    [hike.id]
  );
  // Whole-journey route drives the overview inset (true overall progress).
  // The Appalachian Trail uses its real centerline shape.
  const journey = useMemo(() => {
    if (theme.kind === 'appalachian') return buildPath(AT_SHAPE.map((p) => ({ ...p })));
    return buildPath(theme.kind === 'city' ? makeCityRoute(seed) : makeRoute(seed));
  }, [hike.id]);

  const stars = useMemo(() => (theme.stars ? makeStars(seed) : []), [hike.id, theme.stars]);
  const skyStars = useMemo(() => (theme.dayNight ? makeStars(seed, 70) : []), [hike.id, theme.dayNight]);
  const scenery = useMemo(() => buildScenery(theme, localPath, seed), [hike.id]);
  const loopEl = useMemo(
    () => (
      <Polyline
        points={toPolyline(localPath.points, Z)}
        fill="none"
        stroke={theme.route}
        strokeWidth={theme.kind === 'city' ? 4 : 5}
        strokeDasharray={theme.kind === 'city' ? '7 5' : undefined}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.9}
      />
    ),
    [hike.id]
  );

  // Position along the local path from the eased step count. The AT path is
  // open, so ping-pong (out-and-back); loops just wrap.
  const localArc = steps * theme.stepWorld;
  const L = localPath.total;
  let frac = 0;
  if (L > 0) {
    if (theme.kind === 'appalachian') {
      const ph = ((localArc % (2 * L)) + 2 * L) % (2 * L);
      frac = (ph <= L ? ph : 2 * L - ph) / L;
    } else {
      frac = (localArc % L) / L;
    }
  }
  const pin = pointAt(localPath, frac);
  const cx = size.w / 2;
  const cy = size.h * 0.55;
  const tx = cx - pin.x * Z;
  const ty = cy - pin.y * Z;

  const overallProgress = Math.min(1, steps / hike.steps);

  const sky = theme.dayNight ? skyState(steps) : null;
  const horizon = size.h * 0.42;
  const celX = size.w * (0.12 + 0.76 * (sky ? sky.sp : 0));
  const celY = horizon - Math.sin((sky ? sky.sp : 0) * Math.PI) * size.h * 0.22;

  return (
    <View
      style={[styles.fill, { backgroundColor: theme.bg }]}
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {size.w > 0 && (
        <Svg width={size.w} height={size.h}>
          {stars.map((s, i) => (
            <Circle key={i} cx={s.x * size.w} cy={s.y * size.h} r={s.r} fill="rgba(255,255,255,0.7)" />
          ))}
          <G transform={`translate(${tx} ${ty})`}>
            {scenery}
            {loopEl}
          </G>

          {sky && (
            <>
              <Rect x={0} y={0} width={size.w} height={size.h} fill={sky.overlay} />
              {sky.night > 0.03 &&
                skyStars.map((s, i) => (
                  <Circle
                    key={`ns${i}`}
                    cx={s.x * size.w}
                    cy={s.y * size.h * 0.5}
                    r={s.r}
                    fill={`rgba(255,255,255,${(sky.night * 0.9).toFixed(2)})`}
                  />
                ))}
              <Circle cx={celX} cy={celY} r={sky.isMoon ? 16 : 20} fill={sky.isMoon ? 'rgba(220,230,255,0.18)' : 'rgba(255,221,107,0.28)'} />
              <Circle cx={celX} cy={celY} r={sky.isMoon ? 10 : 13} fill={sky.isMoon ? '#eef2ff' : '#ffdf6b'} />
            </>
          )}

          {/* Pin stays centered; the world scrolls beneath it. */}
          <Circle cx={cx} cy={cy} r={12} fill={theme.traveled} opacity={0.22} />
          <Circle cx={cx} cy={cy} r={6.5} fill={theme.pin} stroke="#fff" strokeWidth={2} />
        </Svg>
      )}
      <Overview built={journey} progress={overallProgress} theme={theme} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
  overview: {
    position: 'absolute',
    bottom: 96,
    right: 12,
    padding: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.18)',
    backgroundColor: 'rgba(248,247,242,0.92)',
  },
});

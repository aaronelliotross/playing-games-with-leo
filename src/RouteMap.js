import React, { useMemo, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Polyline, Polygon, Circle, G, Rect, Defs, Pattern, Line, Path, Ellipse, Text } from 'react-native-svg';
import {
  hashId,
  CITY_BLOCK,
  makeStars,
  wobblyRing,
} from './routeGeometry';
import {
  createOrganicWorld,
  createGridWorld,
  treesInRect,
  mountainsInRect,
  cityInRect,
  riversInView,
} from './endlessWorld';

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

// Manga ink for bold outlines everywhere.
const INK = '#1b1a17';

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

// Viewport scenery for the given world rect, split into back (behind the trail)
// and front (in front of it) so rivers can be layered in between. Deterministic
// per tile, so it never repeats and stays stable frame to frame.
function sceneryLayers(theme, seed, rect) {
  const Z = theme.zoom;
  const back = [];
  const front = [];
  if (theme.kind === 'city') {
    const { buildings, parks } = cityInRect(seed, rect);
    parks.forEach((p) =>
      back.push(<Rect key={p.key} x={p.x * Z} y={p.y * Z} width={p.w * Z} height={p.h * Z} rx={2} fill={theme.park} stroke={INK} strokeWidth={1.2} />)
    );
    buildings.forEach((b) =>
      back.push(
        <Rect key={b.key} x={b.x * Z} y={b.y * Z} width={b.w * Z} height={b.h * Z} fill={BUILDING_SHADES[b.shade]} stroke={INK} strokeWidth={1.6} />
      )
    );
  } else if (theme.kind === 'trail') {
    treesInRect(seed, rect).forEach((t) =>
      front.push(<Circle key={t.key} cx={t.x * Z} cy={t.y * Z} r={t.r * Z} fill={theme.tree} stroke={INK} strokeWidth={1.8} />)
    );
  } else if (theme.kind === 'appalachian') {
    mountainsInRect(seed, rect).forEach((pk) => {
      const r = seededRand(pk.seed);
      MTN_BANDS.forEach((band, bi) =>
        back.push(
          <Polygon
            key={`${pk.key}-${bi}`}
            points={ptsToStr(wobblyRing(pk.cx, pk.cy, pk.R * band.f, r), Z)}
            fill={band.fill}
            stroke={bi === 0 ? INK : undefined}
            strokeWidth={bi === 0 ? 2.4 : undefined}
          />
        )
      );
    });
    treesInRect(seed, rect, 3, 0.45).forEach((t) =>
      front.push(<Circle key={t.key} cx={t.x * Z} cy={t.y * Z} r={t.r * Z * 0.82} fill={theme.tree} stroke={INK} strokeWidth={1.8} />)
    );
  }
  return { back, front };
}

// Rivers (appalachian): horizontal bands at fixed world levels with a bridge
// where the forward-only trail crosses (exactly once, since it never doubles back).
function riverEls(theme, seed, rect, world, arc, behindWorld, aheadWorld) {
  const Z = theme.zoom;
  const [minX, , maxX] = rect;
  const w = 3;
  return riversInView(seed, world, arc, behindWorld, aheadWorld, 30).map((rv) => (
    <React.Fragment key={rv.key}>
      <Rect x={minX * Z} y={(rv.level - w / 2) * Z} width={(maxX - minX) * Z} height={w * Z} fill={theme.river} stroke={INK} strokeWidth={1.6} />
      {rv.cross && (
        <Rect x={(rv.cross.x - 1.1) * Z} y={(rv.level - (w / 2 + 1.2)) * Z} width={2.2 * Z} height={(w + 2.4) * Z} rx={1} fill={theme.bridge} stroke={INK} strokeWidth={1.4} />
      )}
    </React.Fragment>
  ));
}

// A little chibi hiker at screen center. Legs alternate with the step parity
// (pose), and it reacts to the breather with a sweat drop.
function Avatar({ cx, cy, pose, blocked }) {
  const bob = blocked ? 0 : pose ? -1.6 : 0;
  const gy = cy + bob;
  const frontX = pose ? cx + 3 : cx - 3;
  const backX = pose ? cx - 3 : cx + 3;
  return (
    <G>
      <Ellipse cx={cx} cy={cy + 2} rx={9} ry={2.6} fill="rgba(0,0,0,0.2)" />
      {blocked ? (
        <>
          <Rect x={cx - 4.6} y={gy - 9} width={3.4} height={9} rx={1.5} fill="#33425c" stroke={INK} strokeWidth={1.6} />
          <Rect x={cx + 1.2} y={gy - 9} width={3.4} height={9} rx={1.5} fill="#33425c" stroke={INK} strokeWidth={1.6} />
        </>
      ) : (
        <>
          <Rect x={backX - 1.7} y={gy - 8} width={3.4} height={8} rx={1.5} fill="#2c3a52" stroke={INK} strokeWidth={1.6} />
          <Rect x={frontX - 1.7} y={gy - 10} width={3.6} height={10} rx={1.6} fill="#3b4a63" stroke={INK} strokeWidth={1.6} />
        </>
      )}
      {/* arms */}
      <Rect x={cx - 8.6} y={gy - 19} width={3} height={7} rx={1.4} fill="#e2574c" stroke={INK} strokeWidth={1.4} />
      <Rect x={cx + 5.6} y={gy - 19} width={3} height={7} rx={1.4} fill="#e2574c" stroke={INK} strokeWidth={1.4} />
      {/* body */}
      <Rect x={cx - 6.5} y={gy - 20} width={13} height={13} rx={3.5} fill="#e2574c" stroke={INK} strokeWidth={2} />
      {/* head + cap + face */}
      <Circle cx={cx} cy={gy - 27} r={7} fill="#ffe0bd" stroke={INK} strokeWidth={2} />
      <Path d={`M ${cx - 7} ${gy - 27} a 7 7 0 0 1 14 0 z`} fill="#c9433a" stroke={INK} strokeWidth={1.8} />
      <Circle cx={cx - 2.6} cy={gy - 26} r={1.2} fill={INK} />
      <Circle cx={cx + 2.6} cy={gy - 26} r={1.2} fill={INK} />
      {blocked && (
        <Path d={`M ${cx + 8.5} ${gy - 30} q 2.6 3.2 0 5.2 q -2.6 -2 0 -5.2 z`} fill="#8fd0ff" stroke={INK} strokeWidth={1} />
      )}
    </G>
  );
}

// World distance we invalidate the tile cache at (pin movement between rebuilds).
const CHUNK = 6;

export default function RouteMap({ hike, steps, moving, blocked }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const seed = useMemo(() => hashId(hike.id), [hike.id]);
  const theme = useMemo(() => themeFor(hike), [hike.id]);
  const Z = theme.zoom;

  // Endless, forward-only world for the nav view (never loops or doubles back).
  const worldRef = useRef({ id: null, world: null });
  if (worldRef.current.id !== hike.id) {
    worldRef.current = {
      id: hike.id,
      world: theme.kind === 'city' ? createGridWorld(seed, CITY_BLOCK) : createOrganicWorld(seed),
    };
  }
  const world = worldRef.current.world;

  const stars = useMemo(() => (theme.stars ? makeStars(seed) : []), [hike.id, theme.stars]);
  const skyStars = useMemo(() => (theme.dayNight ? makeStars(seed, 70) : []), [hike.id, theme.dayNight]);

  // Advance along the endless path and center the pin.
  const localArc = steps * theme.stepWorld;
  const cx = size.w / 2;
  const cy = size.h * 0.6;
  const aheadWorld = size.h > 0 ? cy / Z + 8 : 8; // world distance visible ahead
  const behindWorld = size.h > 0 ? (size.h - cy) / Z + 8 : 8;
  world.extend(localArc + aheadWorld + 4);
  const pin = world.sample(localArc);
  const tx = cx - pin.x * Z;
  const ty = cy - pin.y * Z;

  // Windowed trail line.
  const pathStr = size.w > 0
    ? toPolyline(world.window(Math.max(0, localArc - behindWorld), localArc + aheadWorld), Z)
    : '';

  // Tile scenery, rebuilt only when the pin crosses into a new chunk.
  const cellX = Math.floor(pin.x / CHUNK);
  const cellY = Math.floor(pin.y / CHUNK);
  const halfWWorld = size.w > 0 ? size.w / 2 / Z + CHUNK + 4 : 0;
  const scenery = useMemo(() => {
    if (size.w === 0) return { back: [], front: [] };
    const rect = [
      pin.x - halfWWorld,
      pin.y - aheadWorld - CHUNK,
      pin.x + halfWWorld,
      pin.y + behindWorld + CHUNK,
    ];
    return sceneryLayers(theme, seed, rect);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hike.id, cellX, cellY, size.w, size.h]);

  // Rivers are cheap and depend on exact arc, so compute per frame (AT only).
  const rivers = theme.kind === 'appalachian' && size.w > 0
    ? riverEls(theme, seed, [pin.x - halfWWorld, 0, pin.x + halfWWorld], world, localArc, behindWorld, aheadWorld)
    : null;

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
          <Defs>
            <Pattern id="tone" width={5} height={5} patternUnits="userSpaceOnUse">
              <Circle cx={1} cy={1} r={0.9} fill="rgba(0,0,0,0.55)" />
            </Pattern>
          </Defs>
          {stars.map((s, i) => (
            <Circle key={i} cx={s.x * size.w} cy={s.y * size.h} r={s.r} fill="rgba(255,255,255,0.7)" />
          ))}
          <G transform={`translate(${tx} ${ty})`}>
            {scenery.back}
            {rivers}
            {scenery.front}
            {theme.kind !== 'city' && (
              <Polyline points={pathStr} fill="none" stroke={INK} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
            )}
            <Polyline
              points={pathStr}
              fill="none"
              stroke={theme.route}
              strokeWidth={theme.kind === 'city' ? 4 : 5}
              strokeDasharray={theme.kind === 'city' ? '7 5' : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.95}
            />
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

          {/* Screentone print texture (subtle). */}
          <Rect x={0} y={0} width={size.w} height={size.h} fill="url(#tone)" opacity={0.06} />

          {/* Speed lines while walking. */}
          {moving && !blocked && (
            <>
              {[0, 1, 2, 3].map((i) => (
                <Line key={`sl${i}`} x1={0} y1={cy - 40 + i * 26} x2={30 + (i % 2) * 16} y2={cy - 40 + i * 26} stroke={INK} strokeWidth={2.4} opacity={0.5} />
              ))}
              {[0, 1, 2, 3].map((i) => (
                <Line key={`sr${i}`} x1={size.w} y1={cy - 40 + i * 26} x2={size.w - (30 + (i % 2) * 16)} y2={cy - 40 + i * 26} stroke={INK} strokeWidth={2.4} opacity={0.5} />
              ))}
            </>
          )}

          {/* The hiker. */}
          <Avatar cx={cx} cy={cy} pose={Math.round(steps) % 2 === 1} blocked={blocked} />

          {/* SFX text. */}
          {blocked ? (
            <Text x={cx + 22} y={cy - 30} fill={INK} fontSize={13} fontWeight="bold" fontStyle="italic">haah…</Text>
          ) : moving ? (
            <Text x={cx + 18} y={cy - 26} fill={INK} fontSize={12} fontWeight="bold" fontStyle="italic">
              {Math.round(steps) % 2 === 1 ? 'tmp!' : 'tmp'}
            </Text>
          ) : null}

          {/* Manga panel frame. */}
          <Rect x={3} y={3} width={size.w - 6} height={size.h - 6} rx={6} fill="none" stroke={INK} strokeWidth={4} />
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
});

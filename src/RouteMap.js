import React, { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Polyline, Circle, G, Rect } from 'react-native-svg';
import {
  hashId,
  makeRoute,
  makeCityRoute,
  buildPath,
  pointAt,
  sliceTo,
  bounds,
  makeStars,
  makeCityScenery,
  makeTrailScenery,
} from './routeGeometry';

// Whole-route overview inset size.
const OVERVIEW_W = 116;
const OVERVIEW_H = 84;
const OVERVIEW_PAD = 10;

const BUILDING_SHADES = ['#9aa6b2', '#8e99a6', '#a8a594', '#b3a892', '#9fa894', '#8f9bb0'];

const THEMES = {
  trail: {
    kind: 'trail',
    zoom: 13,
    bg: '#dfe6cf',
    route: '#cbb78f',
    traveled: '#8a6a39',
    pin: '#5b4a25',
    tree: '#5f8d4e',
    treeRing: '#456b38',
  },
  city: {
    kind: 'city',
    zoom: 8,
    bg: '#c0c5cc',
    route: '#86acf6',
    traveled: '#1d4ed8',
    pin: '#1d4ed8',
    park: '#9cc08a',
    buildingStroke: 'rgba(0,0,0,0.14)',
  },
  space: {
    kind: 'space',
    zoom: 13,
    bg: '#0b0d1a',
    route: '#343a54',
    traveled: '#9fb3ff',
    pin: '#eaf0ff',
    stars: true,
  },
};
const THEME_BY_HIKE = {
  corner_store: 'city',
  around_the_block: 'city',
  walk_to_the_moon: 'space',
};
function themeFor(hike) {
  return THEMES[THEME_BY_HIKE[hike.id]] || THEMES.trail;
}

function toPolyline(points, scale, ox = 0, oy = 0) {
  return points
    .map((p) => `${(ox + p.x * scale).toFixed(1)},${(oy + p.y * scale).toFixed(1)}`)
    .join(' ');
}

// Static, world-space scenery for a theme. Memoized by the caller so these
// elements keep referential identity across frames (only the parent <G>
// transform changes as you walk).
function buildScenery(theme, built, seed) {
  const Z = theme.zoom;
  if (theme.kind === 'city') {
    const { buildings, parks } = makeCityScenery(seed, built);
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
    const { trees } = makeTrailScenery(seed, built);
    return trees.map((t, i) => (
      <Circle key={`t${i}`} cx={t.x * Z} cy={t.y * Z} r={t.r * Z} fill={theme.tree} stroke={theme.treeRing} strokeWidth={1} />
    ));
  }
  return null;
}

function Overview({ built, progress, theme }) {
  const b = useMemo(() => bounds(built.points), [built]);
  const spanX = b.maxX - b.minX || 1;
  const spanY = b.maxY - b.minY || 1;
  const scale = Math.min(
    (OVERVIEW_W - 2 * OVERVIEW_PAD) / spanX,
    (OVERVIEW_H - 2 * OVERVIEW_PAD) / spanY
  );
  const offX = (OVERVIEW_W - spanX * scale) / 2 - b.minX * scale;
  const offY = (OVERVIEW_H - spanY * scale) / 2 - b.minY * scale;

  const all = useMemo(() => toPolyline(built.points, scale, offX, offY), [built, scale, offX, offY]);
  const traveled = toPolyline(sliceTo(built, progress), scale, offX, offY);
  const pin = pointAt(built, progress);

  return (
    <View style={[styles.overview, { backgroundColor: theme.bg }]}>
      <Svg width={OVERVIEW_W} height={OVERVIEW_H}>
        <Polyline points={all} fill="none" stroke={theme.route} strokeWidth={2} strokeLinejoin="round" />
        <Polyline points={traveled} fill="none" stroke={theme.traveled} strokeWidth={2} strokeLinejoin="round" />
        <Circle cx={offX + pin.x * scale} cy={offY + pin.y * scale} r={3.2} fill={theme.pin} stroke="#fff" strokeWidth={1} />
      </Svg>
    </View>
  );
}

export default function RouteMap({ hike, progress }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const seed = useMemo(() => hashId(hike.id), [hike.id]);
  const theme = useMemo(() => themeFor(hike), [hike.id]);
  const built = useMemo(
    () => buildPath(theme.kind === 'city' ? makeCityRoute(seed) : makeRoute(seed)),
    [hike.id]
  );
  const Z = theme.zoom;

  const stars = useMemo(() => (theme.stars ? makeStars(seed) : []), [hike.id, theme.stars]);
  const scenery = useMemo(() => buildScenery(theme, built, seed), [hike.id]);
  const remainingEl = useMemo(
    () => (
      <Polyline
        points={toPolyline(built.points, Z)}
        fill="none"
        stroke={theme.route}
        strokeWidth={theme.kind === 'city' ? 4 : 5}
        strokeDasharray={theme.kind === 'city' ? '7 5' : undefined}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
    [hike.id]
  );

  const pin = pointAt(built, progress);
  const cx = size.w / 2;
  const cy = size.h * 0.6;
  const tx = cx - pin.x * Z;
  const ty = cy - pin.y * Z;
  const traveled = toPolyline(sliceTo(built, progress), Z);

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
            {remainingEl}
            <Polyline
              points={traveled}
              fill="none"
              stroke={theme.traveled}
              strokeWidth={theme.kind === 'city' ? 4 : 5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </G>
          {/* Pin stays centered; the world scrolls beneath it. */}
          <Circle cx={cx} cy={cy} r={12} fill={theme.traveled} opacity={0.22} />
          <Circle cx={cx} cy={cy} r={6.5} fill={theme.pin} stroke="#fff" strokeWidth={2} />
        </Svg>
      )}
      <Overview built={built} progress={progress} theme={theme} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
  overview: {
    position: 'absolute',
    top: 12,
    right: 12,
    padding: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.15)',
    opacity: 0.95,
  },
});

import React, { useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Polyline, Circle, G } from 'react-native-svg';
import {
  hashId,
  makeRoute,
  buildPath,
  pointAt,
  sliceTo,
  bounds,
  makeStars,
} from './routeGeometry';

// Pixels per route unit in the zoomed nav view.
const ZOOM = 13;
// Whole-route overview inset size.
const OVERVIEW_W = 116;
const OVERVIEW_H = 84;
const OVERVIEW_PAD = 10;

const THEMES = {
  trail: { bg: '#e9e7df', remaining: '#cfcabd', traveled: '#5b7d4b', pin: '#2f4a25', stars: false },
  city: { bg: '#e6e7ea', remaining: '#c2c6cf', traveled: '#6b7280', pin: '#374151', stars: false },
  space: { bg: '#0b0d1a', remaining: '#343a54', traveled: '#9fb3ff', pin: '#eaf0ff', stars: true },
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
        <Polyline points={all} fill="none" stroke={theme.remaining} strokeWidth={2} strokeLinejoin="round" />
        <Polyline points={traveled} fill="none" stroke={theme.traveled} strokeWidth={2} strokeLinejoin="round" />
        <Circle
          cx={offX + pin.x * scale}
          cy={offY + pin.y * scale}
          r={3.2}
          fill={theme.pin}
          stroke="#fff"
          strokeWidth={1}
        />
      </Svg>
    </View>
  );
}

export default function RouteMap({ hike, progress }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const theme = useMemo(() => themeFor(hike), [hike.id]);
  const built = useMemo(() => buildPath(makeRoute(hashId(hike.id))), [hike.id]);
  const stars = useMemo(
    () => (theme.stars ? makeStars(hashId(hike.id)) : []),
    [hike.id, theme.stars]
  );

  const remaining = useMemo(() => toPolyline(built.points, ZOOM), [built]);
  const traveled = toPolyline(sliceTo(built, progress), ZOOM);

  const pin = pointAt(built, progress);
  const cx = size.w / 2;
  const cy = size.h * 0.6;
  const tx = cx - pin.x * ZOOM;
  const ty = cy - pin.y * ZOOM;

  return (
    <View
      style={[styles.fill, { backgroundColor: theme.bg }]}
      onLayout={(e) =>
        setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
      }
    >
      {size.w > 0 && (
        <Svg width={size.w} height={size.h}>
          {stars.map((s, i) => (
            <Circle key={i} cx={s.x * size.w} cy={s.y * size.h} r={s.r} fill="rgba(255,255,255,0.7)" />
          ))}
          <G transform={`translate(${tx} ${ty})`}>
            <Polyline
              points={remaining}
              fill="none"
              stroke={theme.remaining}
              strokeWidth={5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Polyline
              points={traveled}
              fill="none"
              stroke={theme.traveled}
              strokeWidth={5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </G>
          {/* Pin stays centered; the route scrolls beneath it. */}
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

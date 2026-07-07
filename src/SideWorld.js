import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Circle, G, Polygon, Line, Path } from 'react-native-svg';

// Foreground pixels advanced per step. Parallax layers move a fraction of this.
const STEP_PX = 6;

function h1(i, seed) {
  let n = (Math.imul(i | 0, 374761393) ^ Math.imul(seed | 0, 668265263)) >>> 0;
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
// Smooth value noise in [0,1].
function noise(x, seed) {
  const i = Math.floor(x);
  const f = x - i;
  const a = h1(i, seed);
  const b = h1(i + 1, seed);
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
function mix(c1, c2, t) {
  const p = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const [r1, g1, b1] = p(c1);
  const [r2, g2, b2] = p(c2);
  return `rgb(${Math.round(lerp(r1, r2, t))},${Math.round(lerp(g1, g2, t))},${Math.round(lerp(b1, b2, t))})`;
}

// --- Sky / time of day ---------------------------------------------------

const DAY_STEPS = 340; // full dawn->night cycle for the silhouette walk

function silhouetteSky(steps) {
  const p = (((steps / DAY_STEPS) % 1) + 1) % 1;
  const keys = [
    { p: 0.0, top: '#241a4d', mid: '#6b3f74', bot: '#e98a6b' },
    { p: 0.28, top: '#3f6aa8', mid: '#9fbfe0', bot: '#f0ede4' },
    { p: 0.5, top: '#241a4d', mid: '#6b3f74', bot: '#e08a6b' },
    { p: 0.74, top: '#0c0a22', mid: '#191338', bot: '#2c2150' },
    { p: 1.0, top: '#241a4d', mid: '#6b3f74', bot: '#e98a6b' },
  ];
  let k0 = keys[0];
  let k1 = keys[1];
  for (let i = 1; i < keys.length; i++) {
    if (p <= keys[i].p) {
      k0 = keys[i - 1];
      k1 = keys[i];
      break;
    }
  }
  const t = (p - k0.p) / (k1.p - k0.p || 1);
  const night = Math.max(0, 1 - Math.min(1, Math.abs(p - 0.74) / 0.26));
  const isMoon = p >= 0.5;
  const sp = isMoon ? (p - 0.5) / 0.5 : p / 0.5;
  return {
    top: mix(k0.top, k1.top, t),
    mid: mix(k0.mid, k1.mid, t),
    bot: mix(k0.bot, k1.bot, t),
    night,
    isMoon,
    sp,
  };
}

const STYLES = {
  silhouette: {
    ridges: ['#563566', '#3a2350', '#221436'],
    ground: '#160e28',
    figure: '#0f0a1e',
    prop: 'joshua',
    propColor: '#160e28',
    stars: true,
  },
  nocturne: {
    sky: { top: '#070b12', mid: '#0e1a26', bot: '#16232e' },
    ridges: ['#16232e', '#0f1a24', '#0a121a'],
    ground: '#05090e',
    figure: '#243044',
    prop: 'town',
    propColor: '#0a0f16',
    stars: true,
    moon: true,
  },
};

// --- Scenery pieces ------------------------------------------------------

function ridgePolygon(seed, baseline, amp, freq, scroll, w, h) {
  const stepPx = 12;
  let pts = '';
  for (let x = 0; x <= w + stepPx; x += stepPx) {
    const wx = (scroll + x) * freq;
    const y = baseline - amp * (noise(wx, seed) - 0.35);
    pts += `${x.toFixed(1)},${y.toFixed(1)} `;
  }
  return `${pts}${w},${h} 0,${h}`;
}

function joshuaTree(x, groundY, s, color, key) {
  const hgt = 26 * s;
  const top = groundY - hgt;
  return (
    <G key={key}>
      <Rect x={x - 2 * s} y={top} width={4 * s} height={hgt} fill={color} />
      <Line x1={x} y1={top + 6 * s} x2={x - 10 * s} y2={top - 2 * s} stroke={color} strokeWidth={3 * s} strokeLinecap="round" />
      <Line x1={x} y1={top + 10 * s} x2={x + 11 * s} y2={top + 1 * s} stroke={color} strokeWidth={3 * s} strokeLinecap="round" />
      <Circle cx={x} cy={top} r={4 * s} fill={color} />
      <Circle cx={x - 11 * s} cy={top - 3 * s} r={3.4 * s} fill={color} />
      <Circle cx={x + 12 * s} cy={top} r={3.4 * s} fill={color} />
    </G>
  );
}

function house(x, groundY, s, color, key, glow) {
  const w = 34 * s;
  const bh = 22 * s;
  const top = groundY - bh;
  return (
    <G key={key}>
      <Rect x={x - w / 2} y={top} width={w} height={bh} fill={color} />
      <Polygon points={`${x - w / 2 - 3},${top} ${x + w / 2 + 3},${top} ${x},${top - 14 * s}`} fill={color} />
      <Rect x={x - 9 * s} y={top + 5 * s} width={6 * s} height={6 * s} fill={glow} />
      <Rect x={x + 3 * s} y={top + 5 * s} width={6 * s} height={6 * s} fill={glow} opacity={0.6} />
    </G>
  );
}

// --- Side-view hiker -----------------------------------------------------

function Hiker({ fx, groundY, pose, blocked, color }) {
  const bob = blocked ? 0 : pose ? -1.8 : 0;
  const gy = groundY + bob;
  const front = pose ? 6 : -2; // front foot x offset (facing right)
  const back = pose ? -6 : 4;
  return (
    <G>
      <Path d={`M ${fx - 11} ${groundY + 1} h 22`} stroke="rgba(0,0,0,0.35)" strokeWidth={3} strokeLinecap="round" />
      {blocked ? (
        <>
          <Line x1={fx - 3} y1={gy - 14} x2={fx - 3} y2={gy} stroke={color} strokeWidth={4} strokeLinecap="round" />
          <Line x1={fx + 3} y1={gy - 14} x2={fx + 3} y2={gy} stroke={color} strokeWidth={4} strokeLinecap="round" />
        </>
      ) : (
        <>
          <Line x1={fx} y1={gy - 15} x2={fx + back} y2={gy} stroke={color} strokeWidth={4} strokeLinecap="round" />
          <Line x1={fx} y1={gy - 15} x2={fx + front} y2={gy} stroke={color} strokeWidth={4.4} strokeLinecap="round" />
        </>
      )}
      {/* pack */}
      <Rect x={fx - 9} y={gy - 30} width={7} height={13} rx={2.5} fill={color} />
      {/* torso, leaning into the walk */}
      <Path d={`M ${fx - 4} ${gy - 30} q 9 2 6 16 l -8 0 q -3 -10 2 -16 z`} fill={color} />
      {/* arm */}
      <Line x1={fx + 2} y1={gy - 26} x2={fx + (pose ? 8 : 5)} y2={gy - 15} stroke={color} strokeWidth={3.4} strokeLinecap="round" />
      {/* head + brim hat */}
      <Circle cx={fx + 3} cy={gy - 34} r={5.2} fill={color} />
      <Path d={`M ${fx - 4} ${gy - 37} h 15`} stroke={color} strokeWidth={3} strokeLinecap="round" />
    </G>
  );
}

// --- Renderer ------------------------------------------------------------

export default function SideWorld({ hike, steps, moving, blocked }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const style = STYLES[hike.style] || STYLES.silhouette;
  const isNight = hike.style === 'nocturne';

  const w = size.w;
  const h = size.h;
  const scroll = steps * STEP_PX;
  const groundY = h * 0.82;
  const horizonY = h * 0.5;

  const sky = isNight ? { ...style.sky, night: 1, isMoon: true, sp: 0.5 } : silhouetteSky(steps);

  // Celestial position (fixed high moon at night; an arc for the day cycle).
  const celX = isNight ? w * 0.74 : w * (0.14 + 0.72 * sky.sp);
  const celY = isNight ? h * 0.22 : horizonY - Math.sin(sky.sp * Math.PI) * h * 0.34;

  // Parallax ridge layers (far -> near).
  const layers = [
    { seed: 11, base: h * 0.52, amp: h * 0.12, freq: 0.006, plx: 0.18 },
    { seed: 27, base: h * 0.62, amp: h * 0.1, freq: 0.009, plx: 0.34 },
    { seed: 43, base: h * 0.72, amp: h * 0.08, freq: 0.014, plx: 0.6 },
  ];

  // Foreground props, deterministic per world cell, culled to the viewport.
  const props = [];
  if (w > 0) {
    const plx = 0.9;
    const cell = 150;
    const s0 = scroll * plx;
    const k0 = Math.floor((s0 - 80) / cell);
    const k1 = Math.floor((s0 + w + 80) / cell);
    for (let k = k0; k <= k1; k++) {
      const present = h1(k, 5) < (isNight ? 0.6 : 0.75);
      if (!present) continue;
      const jitter = h1(k, 6) * (cell * 0.6);
      const worldX = k * cell + jitter;
      const x = worldX - s0;
      const s = 0.8 + h1(k, 7) * 0.7;
      if (style.prop === 'joshua') {
        props.push(joshuaTree(x, groundY, s, style.propColor, `j${k}`));
      } else {
        if (h1(k, 8) < 0.32) {
          props.push(
            <G key={`l${k}`}>
              <Line x1={x} y1={groundY} x2={x} y2={groundY - 34} stroke="#2a2f36" strokeWidth={3} />
              <Circle cx={x} cy={groundY - 37} r={4} fill="#f4c979" />
              <Circle cx={x} cy={groundY - 37} r={16} fill="#f4c979" opacity={0.12} />
            </G>
          );
        } else {
          props.push(house(x, groundY, s, style.propColor, `h${k}`, '#f4c979'));
        }
      }
    }
  }

  const pose = Math.round(steps) % 2 === 1;
  const stars = style.stars && sky.night > 0.15;

  return (
    <View style={styles.fill} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {w > 0 && (
        <Svg width={w} height={h}>
          <Defs>
            <LinearGradient id="sw-sky" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={sky.top} />
              <Stop offset="0.62" stopColor={sky.mid} />
              <Stop offset="1" stopColor={sky.bot} />
            </LinearGradient>
            <RadialGradient id="sw-glow" cx="0.5" cy="0.5" r="0.5">
              <Stop offset="0" stopColor={sky.isMoon ? '#e8eeff' : '#fff0cf'} stopOpacity="0.9" />
              <Stop offset="0.5" stopColor={sky.isMoon ? '#cfe0ff' : '#f6c98c'} stopOpacity="0.35" />
              <Stop offset="1" stopColor={sky.isMoon ? '#cfe0ff' : '#f6c98c'} stopOpacity="0" />
            </RadialGradient>
          </Defs>

          <Rect x="0" y="0" width={w} height={h} fill="url(#sw-sky)" />

          {stars &&
            [...Array(46)].map((_, i) => (
              <Circle
                key={`st${i}`}
                cx={h1(i, 91) * w}
                cy={h1(i, 92) * h * 0.55}
                r={0.6 + h1(i, 93) * 1.2}
                fill="#fff"
                opacity={(0.5 + h1(i, 94) * 0.5) * sky.night}
              />
            ))}

          {/* sun / moon */}
          <Circle cx={celX} cy={celY} r={38} fill="url(#sw-glow)" />
          <Circle cx={celX} cy={celY} r={sky.isMoon ? 15 : 20} fill={sky.isMoon ? '#eef2ff' : '#ffe9b8'} />

          {/* ridge silhouettes */}
          {layers.map((L, i) => (
            <Polygon key={`r${i}`} points={ridgePolygon(L.seed, L.base, L.amp, L.freq, scroll * L.plx, w, h)} fill={style.ridges[i]} />
          ))}

          {/* ground */}
          <Rect x="0" y={groundY} width={w} height={h - groundY} fill={style.ground} />

          {/* props + hiker */}
          {props}
          <Hiker fx={w * 0.4} groundY={groundY} pose={pose} blocked={blocked} color={style.figure} />
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject },
});

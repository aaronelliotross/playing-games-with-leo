import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  Dimensions,
  FlatList,
  TouchableOpacity,
  SafeAreaView,
  Platform,
  BackHandler,
  Animated,
  Easing,
} from 'react-native';
import RouteMap from './RouteMap';
import SideWorld from './SideWorld';
import { HIKES } from './hikeData';

const SWIPE_THRESHOLD = 40;
// Running = a genuinely fast, sustained cadence: average step interval below
// RUN_THRESHOLD_MS across at least RUN_MIN_SAMPLES steps. Tuned high so brisk
// walking doesn't trip it.
const RUN_THRESHOLD_MS = 175;
const RUN_MIN_SAMPLES = 3;
// A gap longer than this means you stopped and restarted, so cadence resets.
const CADENCE_RESET_MS = 1600;
// When running is detected, movement is blocked for a breather.
const BREATHER_MS = 2000;
const BREATHER_MSG_SWITCH_MS = 1000;
// How quickly the pin eases toward its true position each frame (0..1).
const PIN_EASE = 0.18;
// Assumed starting pace (ms per step) before we've measured yours, so an ETA
// shows immediately. Refined from your real cadence as you walk.
const DEFAULT_PACE_MS = 520;

// Turn a number of seconds into "6 years, 3 months, 2 days" (top 3 units).
function formatDuration(sec) {
  if (!isFinite(sec) || sec <= 0) return null;
  const units = [
    ['year', 31557600],
    ['month', 2629800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
  ];
  let rem = Math.floor(sec);
  const parts = [];
  for (const [name, s] of units) {
    const v = Math.floor(rem / s);
    rem -= v * s;
    if (v > 0) parts.push(`${v} ${name}${v === 1 ? '' : 's'}`);
  }
  if (parts.length === 0) return 'less than a second';
  return parts.slice(0, 3).join(', ');
}

// Build tag, baked in at deploy time so you can tell which release is live.
// (EXPO_PUBLIC_* vars are inlined by Expo at build; undefined in local dev.)
const BUILD_NUMBER = process.env.EXPO_PUBLIC_BUILD_NUMBER;
const BUILD_SHA = (process.env.EXPO_PUBLIC_BUILD_SHA || '').slice(0, 7);
const BUILD_LABEL = BUILD_NUMBER
  ? `build ${BUILD_NUMBER}${BUILD_SHA ? ' · ' + BUILD_SHA : ''}`
  : 'dev build';

function formatSteps(n) {
  return n.toLocaleString();
}

function HikeSelector({ onSelect }) {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Choose a Hike</Text>
      <FlatList
        style={styles.hikeList}
        data={HIKES}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.hikeRow} onPress={() => onSelect(item)}>
            <Text style={styles.hikeName}>{item.name}</Text>
            <Text style={styles.hikeDetail}>{item.description}</Text>
            <Text style={styles.hikeSteps}>{formatSteps(item.steps)} steps</Text>
          </TouchableOpacity>
        )}
      />
      <Text style={styles.buildTag}>{BUILD_LABEL}</Text>
    </SafeAreaView>
  );
}

function CompletionScreen({ hike, steps, onRestart, onChooseAnother }) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.completionContent}>
        <Text style={styles.completionTitle}>You did it.</Text>
        <Text style={styles.completionHike}>{hike.name}</Text>
        <Text style={styles.completionSteps}>{formatSteps(steps)} steps</Text>
        <Text style={styles.funFact}>{hike.funFact}</Text>
        <TouchableOpacity style={styles.button} onPress={onRestart}>
          <Text style={styles.buttonText}>Hike again</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.buttonSecondary} onPress={onChooseAnother}>
          <Text style={styles.buttonSecondaryText}>Choose another hike</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// Ink used for the swipe trail — light on dark scenes, teal on the ink walks.
function swipeInk(a, dark) {
  return dark ? `rgba(255,255,255,${a})` : `rgba(43,74,82,${a})`;
}

function Chevron({ color }) {
  return (
    <View
      style={{
        width: 20,
        height: 20,
        borderRightWidth: 4,
        borderBottomWidth: 4,
        borderColor: color,
        transform: [{ rotate: '45deg' }],
        marginVertical: 3,
      }}
    />
  );
}

// A gentle expanding ring where a swipe lifts: neutral for a step, red for a
// same-foot slip, amber when it triggers the breather.
function Ripple({ x, y, kind, darkHud, onDone }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, {
      toValue: 1,
      duration: kind === 'good' ? 420 : 520,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => onDone && onDone());
  }, []);
  const color = kind === 'bad' ? '#e07a5f' : kind === 'warn' ? '#f0c14b' : darkHud ? 'rgba(255,255,255,0.9)' : 'rgba(43,74,82,0.85)';
  const scale = a.interpolate({ inputRange: [0, 1], outputRange: [0.5, kind === 'bad' ? 1.9 : 2.4] });
  const opacity = a.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] });
  return (
    <Animated.View
      pointerEvents="none"
      style={{ position: 'absolute', left: x - 26, top: y - 26, width: 52, height: 52, borderRadius: 26, borderWidth: 2.5, borderColor: color, opacity, transform: [{ scale }] }}
    />
  );
}

// Faint pulsing "swipe down" chevrons on each side, before the first step.
function IdleHint({ darkHud }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(a, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  const translateY = a.interpolate({ inputRange: [0, 1], outputRange: [-2, 16] });
  const opacity = a.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.95] });
  const color = darkHud ? 'rgba(255,255,255,0.95)' : 'rgba(43,74,82,0.95)';
  const chip = darkHud ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.4)';
  const side = { width: '50%', alignItems: 'center' };
  const pair = { alignItems: 'center', paddingVertical: 12, paddingHorizontal: 18, borderRadius: 22, backgroundColor: chip };
  return (
    <View style={{ position: 'absolute', top: '44%', left: 0, right: 0, flexDirection: 'row' }} pointerEvents="none">
      <View style={side}>
        <Animated.View style={[pair, { opacity, transform: [{ translateY }] }]}>
          <Chevron color={color} />
          <Chevron color={color} />
        </Animated.View>
      </View>
      <View style={side}>
        <Animated.View style={[pair, { opacity, transform: [{ translateY }] }]}>
          <Chevron color={color} />
          <Chevron color={color} />
        </Animated.View>
      </View>
    </View>
  );
}

function WalkingView({ hike, onBack }) {
  const [steps, setSteps] = useState(0);
  const [nextFoot, setNextFoot] = useState('left');
  const [feedback, setFeedback] = useState('start walking');
  const [done, setDone] = useState(false);
  const [invalidFlash, setInvalidFlash] = useState(false);
  const [blocked, setBlocked] = useState(false);
  // True briefly after each step, for speed lines / SFX on the avatar.
  const [moving, setMoving] = useState(false);
  const movingTimerRef = useRef(null);
  // Smoothed pace (ms per step) used to estimate time remaining.
  const [paceMs, setPaceMs] = useState(DEFAULT_PACE_MS);
  // Eased step count that the map follows smoothly (advances the nav view a
  // fixed distance per step, independent of the hike's total length).
  const [displayedSteps, setDisplayedSteps] = useState(0);

  const nextFootRef = useRef('left');
  const stepsRef = useRef(0);
  const invalidTimerRef = useRef(null);
  // Cadence tracking: timestamp of the last step + recent step intervals.
  const lastStepAtRef = useRef(0);
  const intervalsRef = useRef([]);
  // Breather: while blocked, steps are ignored and the pin holds still.
  const blockedRef = useRef(false);
  const breatherTimerRef = useRef(null);
  const breatherMsgTimerRef = useRef(null);
  // Pin easing.
  const displayedStepsRef = useRef(0);

  // Smoothly ease the displayed step count toward the true one; only re-renders
  // while moving.
  useEffect(() => {
    let raf;
    let mounted = true;
    const tick = () => {
      const target = stepsRef.current;
      const cur = displayedStepsRef.current;
      let next = cur + (target - cur) * PIN_EASE;
      if (Math.abs(target - next) < 0.01) next = target;
      if (next !== cur) {
        displayedStepsRef.current = next;
        setDisplayedSteps(next);
      }
      if (mounted) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      mounted = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  // Track step cadence; returns the recent average interval and sample count.
  const computePace = useCallback(() => {
    const now = Date.now();
    const last = lastStepAtRef.current;
    lastStepAtRef.current = now;
    if (last) {
      const interval = now - last;
      if (interval < CADENCE_RESET_MS) {
        const arr = intervalsRef.current;
        arr.push(interval);
        if (arr.length > 4) arr.shift();
      } else {
        intervalsRef.current = [];
      }
    }
    const arr = intervalsRef.current;
    const avg = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : Infinity;
    return { avg, samples: arr.length };
  }, []);

  // Block movement for a couple seconds and tell them to slow down.
  const startBreather = useCallback(() => {
    blockedRef.current = true;
    setBlocked(true);
    setMoving(false);
    setFeedback('No running!');
    if (breatherMsgTimerRef.current) clearTimeout(breatherMsgTimerRef.current);
    breatherMsgTimerRef.current = setTimeout(
      () => setFeedback('Take a breath.'),
      BREATHER_MSG_SWITCH_MS
    );
    if (breatherTimerRef.current) clearTimeout(breatherTimerRef.current);
    breatherTimerRef.current = setTimeout(() => {
      blockedRef.current = false;
      setBlocked(false);
      lastStepAtRef.current = 0;
      intervalsRef.current = [];
      setFeedback(nextFootRef.current + ' foot');
    }, BREATHER_MS);
  }, []);

  const handleStep = useCallback(
    (side) => {
      // During a breather, movement is frozen and steps are ignored.
      if (blockedRef.current) return 'blocked';

      if (side === nextFootRef.current) {
        const { avg, samples } = computePace();

        // Sustained fast cadence = running. Don't count the step; freeze instead.
        if (samples >= RUN_MIN_SAMPLES && avg < RUN_THRESHOLD_MS) {
          startBreather();
          return 'run';
        }

        // Refine the pace estimate from real cadence (EMA smoothed).
        if (samples > 0 && isFinite(avg)) {
          setPaceMs((prev) => prev * 0.6 + avg * 0.4);
        }

        const newSteps = stepsRef.current + 1;
        stepsRef.current = newSteps;
        const newFoot = nextFootRef.current === 'left' ? 'right' : 'left';
        nextFootRef.current = newFoot;

        setSteps(newSteps);
        setNextFoot(newFoot);
        setFeedback(side === 'left' ? 'left foot' : 'right foot');
        setMoving(true);
        if (movingTimerRef.current) clearTimeout(movingTimerRef.current);
        movingTimerRef.current = setTimeout(() => setMoving(false), 360);

        if (newSteps >= hike.steps) {
          setDone(true);
        }
        return 'step';
      } else {
        if (invalidTimerRef.current) clearTimeout(invalidTimerRef.current);
        setInvalidFlash(true);
        setFeedback('same foot');
        invalidTimerRef.current = setTimeout(() => {
          setInvalidFlash(false);
          setFeedback(nextFootRef.current + ' foot');
        }, 600);
        return 'same';
      }
    },
    [hike.steps, computePace, startBreather]
  );

  // Tidy up timers when leaving the walk.
  useEffect(() => {
    return () => {
      if (invalidTimerRef.current) clearTimeout(invalidTimerRef.current);
      if (breatherTimerRef.current) clearTimeout(breatherTimerRef.current);
      if (breatherMsgTimerRef.current) clearTimeout(breatherMsgTimerRef.current);
      if (movingTimerRef.current) clearTimeout(movingTimerRef.current);
    };
  }, []);

  const startX = useRef(0);
  // Live swipe trail + release pulses (visual feedback replacing the labels).
  const [streak, setStreak] = useState(null); // { x, y0, y1 }
  const [ripples, setRipples] = useState([]);
  const rippleIdRef = useRef(0);
  const addRipple = useCallback((x, y, kind) => {
    const id = ++rippleIdRef.current;
    setRipples((rs) => [...rs, { id, x, y, kind }]);
  }, []);
  const removeRipple = useCallback((id) => {
    setRipples((rs) => rs.filter((r) => r.id !== id));
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => false,

      onPanResponderGrant: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        startX.current = locationX;
        setStreak({ x: locationX, y0: locationY, y1: locationY });
      },

      onPanResponderMove: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        setStreak((s) => (s ? { ...s, x: locationX, y1: locationY } : s));
      },

      onPanResponderRelease: (evt, gestureState) => {
        const { dx, dy } = gestureState;
        const releaseX = evt.nativeEvent.locationX;
        const releaseY = evt.nativeEvent.locationY;
        const screenWidth = Dimensions.get('window').width;

        const startedLeft = startX.current < screenWidth / 2;
        const endedLeft = releaseX < screenWidth / 2;
        const stayedOnSameHalf = startedLeft === endedLeft;
        const isDownSwipe = dy > SWIPE_THRESHOLD && Math.abs(dy) > Math.abs(dx) * 1.2;

        if (isDownSwipe && stayedOnSameHalf) {
          const res = handleStep(startedLeft ? 'left' : 'right');
          const kind = res === 'step' ? 'good' : res === 'same' ? 'bad' : res === 'run' ? 'warn' : null;
          if (kind) addRipple(releaseX, releaseY, kind);
        }
        setStreak(null);
      },

      onPanResponderTerminate: () => setStreak(null),
    })
  ).current;

  const pct = Math.min((steps / hike.steps) * 100, 100);
  const remainingSteps = Math.max(0, hike.steps - steps);
  const etaText = formatDuration((remainingSteps * paceMs) / 1000);
  const darkHud = hike.style === 'silhouette' || hike.style === 'nocturne';

  if (done) {
    return (
      <CompletionScreen
        hike={hike}
        steps={steps}
        onRestart={() => {
          stepsRef.current = 0;
          nextFootRef.current = 'left';
          lastStepAtRef.current = 0;
          intervalsRef.current = [];
          blockedRef.current = false;
          displayedStepsRef.current = 0;
          if (breatherTimerRef.current) clearTimeout(breatherTimerRef.current);
          if (breatherMsgTimerRef.current) clearTimeout(breatherMsgTimerRef.current);
          setBlocked(false);
          setDisplayedSteps(0);
          setPaceMs(DEFAULT_PACE_MS);
          setSteps(0);
          setNextFoot('left');
          setFeedback('start walking');
          setDone(false);
        }}
        onChooseAnother={onBack}
      />
    );
  }

  return (
    <View style={styles.walkingRoot}>
      {hike.style === 'silhouette' || hike.style === 'nocturne' ? (
        <SideWorld hike={hike} steps={displayedSteps} moving={moving} blocked={blocked} />
      ) : (
        <RouteMap hike={hike} steps={displayedSteps} moving={moving} blocked={blocked} />
      )}

      <SafeAreaView style={styles.walkingOverlay} {...panResponder.panHandlers}>
        <View style={[styles.topPanel, darkHud && styles.topPanelDark]}>
          <TouchableOpacity onPress={onBack}>
            <Text style={[styles.backLink, darkHud && styles.textMutedDark]}>← hikes</Text>
          </TouchableOpacity>
          <Text style={[styles.walkingTitle, darkHud && styles.textInkDark]}>{hike.name}</Text>
          <Text style={[styles.stepCount, darkHud && styles.textInkDark]}>
            {formatSteps(steps)} / {formatSteps(hike.steps)} steps
          </Text>
          <Text style={[styles.etaLabel, darkHud && styles.etaLabelDark]}>
            {remainingSteps > 0 ? (etaText ? `≈ ${etaText} left` : '…') : 'complete!'}
          </Text>
          <View style={[styles.progressBarOuter, darkHud && styles.progressBarOuterDark]}>
            <View style={[styles.progressBarInner, darkHud && styles.progressBarInnerDark, { width: pct + '%' }]} />
          </View>
        </View>

        <View style={styles.spacer} pointerEvents="none" />

        {/* Visual swipe feedback (replaces the LEFT/RIGHT labels + foot text). */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {streak && streak.y1 > streak.y0 + 6 && (
            <>
              <View
                style={[
                  styles.streak,
                  { left: streak.x - 3, top: streak.y0, height: streak.y1 - streak.y0, backgroundColor: swipeInk(0.22, darkHud) },
                ]}
              />
              <View
                style={[
                  styles.streakDot,
                  { left: streak.x - 10, top: streak.y1 - 10, backgroundColor: swipeInk(0.5, darkHud) },
                ]}
              />
            </>
          )}
          {ripples.map((r) => (
            <Ripple key={r.id} x={r.x} y={r.y} kind={r.kind} darkHud={darkHud} onDone={() => removeRipple(r.id)} />
          ))}
          {steps < 1 && !blocked && <IdleHint darkHud={darkHud} />}
        </View>
      </SafeAreaView>

      {blocked && (
        <View style={styles.breatherOverlay} pointerEvents="none">
          <Text style={styles.breatherText}>{feedback}</Text>
        </View>
      )}

      <Text style={styles.buildTagOverlay}>{BUILD_LABEL}</Text>
    </View>
  );
}

const isWeb = Platform.OS === 'web' && typeof window !== 'undefined';

export default function GameScreen() {
  const [currentHike, setCurrentHike] = useState(null);
  const currentHikeRef = useRef(null);
  currentHikeRef.current = currentHike;

  // Entering a hike pushes a history entry so the browser/hardware back button
  // returns to the hike list instead of leaving the page.
  const enterHike = useCallback((hike) => {
    if (isWeb) window.history.pushState({ screen: 'walk' }, '');
    setCurrentHike(hike);
  }, []);

  const leaveHike = useCallback(() => {
    // On web, go back through history (fires popstate, which clears the hike);
    // this keeps our in-app back button and the browser back button in sync.
    if (isWeb && window.history.state && window.history.state.screen === 'walk') {
      window.history.back();
    } else {
      setCurrentHike(null);
    }
  }, []);

  useEffect(() => {
    if (!isWeb) return;
    const onPop = () => {
      if (currentHikeRef.current) setCurrentHike(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (currentHikeRef.current) {
        setCurrentHike(null);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);

  if (!currentHike) {
    return <HikeSelector onSelect={enterHike} />;
  }

  return <WalkingView hike={currentHike} onBack={leaveHike} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f0',
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    color: '#1a1a1a',
    padding: 20,
    paddingBottom: 12,
  },
  separator: {
    height: 1,
    backgroundColor: '#ddd',
    marginHorizontal: 20,
  },
  hikeRow: {
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  hikeName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1a1a1a',
    marginBottom: 3,
  },
  hikeDetail: {
    fontSize: 13,
    color: '#666',
    marginBottom: 3,
  },
  hikeSteps: {
    fontSize: 12,
    color: '#999',
  },
  hikeList: {
    flex: 1,
  },
  buildTag: {
    fontSize: 11,
    color: '#aaa',
    textAlign: 'center',
    paddingVertical: 10,
  },

  // Walking view (map background + overlay)
  walkingRoot: {
    flex: 1,
    backgroundColor: '#e9e7df',
  },
  walkingOverlay: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topPanel: {
    backgroundColor: 'rgba(245,245,240,0.9)',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.12)',
  },
  backLink: {
    fontSize: 13,
    color: '#555',
    marginBottom: 8,
  },
  walkingTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 6,
  },
  stepCount: {
    fontSize: 24,
    fontWeight: '300',
    color: '#1a1a1a',
    letterSpacing: -0.5,
  },
  pctLabel: {
    fontSize: 13,
    color: '#555',
    marginTop: 2,
  },
  etaLabel: {
    fontSize: 14,
    color: '#6f5f3d',
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 10,
  },
  progressBarOuter: {
    height: 6,
    backgroundColor: 'rgba(0,0,0,0.15)',
    borderRadius: 3,
  },
  progressBarInner: {
    height: 6,
    backgroundColor: '#333',
    borderRadius: 3,
  },

  spacer: {
    flex: 1,
  },
  streak: {
    position: 'absolute',
    width: 6,
    borderRadius: 3,
  },
  streakDot: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  bottomBar: {
    backgroundColor: 'rgba(245,245,240,0.9)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.12)',
    paddingTop: 14,
    paddingBottom: 18,
    paddingHorizontal: 36,
  },
  footRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  footZoneText: {
    fontSize: 13,
    letterSpacing: 2,
    color: 'rgba(0,0,0,0.3)',
    fontWeight: '600',
  },
  footZoneTextActive: {
    color: '#1a1a1a',
  },
  feedback: {
    textAlign: 'center',
    fontSize: 15,
    color: '#333',
    letterSpacing: 1,
    fontWeight: '600',
  },
  feedbackInvalid: {
    color: '#999',
  },
  feedbackRunning: {
    color: '#f0c14b',
    fontWeight: '700',
  },

  // Dark HUD variants for the side-on (silhouette / nocturne) styles.
  topPanelDark: {
    backgroundColor: 'rgba(10,12,20,0.5)',
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  bottomBarDark: {
    backgroundColor: 'rgba(10,12,20,0.5)',
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  textInkDark: { color: '#f2f3f7' },
  textMutedDark: { color: '#b7bdca' },
  etaLabelDark: { color: '#e6cf95' },
  progressBarOuterDark: { backgroundColor: 'rgba(255,255,255,0.18)' },
  progressBarInnerDark: { backgroundColor: '#e6cf95' },
  footZoneTextDark: { color: 'rgba(255,255,255,0.4)' },
  footZoneTextActiveDark: { color: '#ffffff' },
  breatherOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  breatherText: {
    color: '#ffd24d',
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  buildTagOverlay: {
    position: 'absolute',
    right: 8,
    bottom: 4,
    fontSize: 10,
    color: 'rgba(0,0,0,0.45)',
  },

  // Completion
  completionContent: {
    flex: 1,
    justifyContent: 'center',
    padding: 32,
  },
  completionTitle: {
    fontSize: 36,
    fontWeight: '300',
    color: '#1a1a1a',
    marginBottom: 12,
  },
  completionHike: {
    fontSize: 16,
    color: '#444',
    marginBottom: 4,
  },
  completionSteps: {
    fontSize: 13,
    color: '#888',
    marginBottom: 24,
  },
  funFact: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 40,
    fontStyle: 'italic',
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    backgroundColor: '#1a1a1a',
    marginBottom: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '500',
  },
  buttonSecondary: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonSecondaryText: {
    color: '#666',
    fontSize: 14,
  },
});

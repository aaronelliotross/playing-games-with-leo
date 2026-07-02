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
} from 'react-native';
import RouteMap from './RouteMap';
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

function WalkingView({ hike, onBack }) {
  const [steps, setSteps] = useState(0);
  const [nextFoot, setNextFoot] = useState('left');
  const [feedback, setFeedback] = useState('start walking');
  const [done, setDone] = useState(false);
  const [invalidFlash, setInvalidFlash] = useState(false);
  const [blocked, setBlocked] = useState(false);
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
      if (blockedRef.current) return;

      if (side === nextFootRef.current) {
        const { avg, samples } = computePace();

        // Sustained fast cadence = running. Don't count the step; freeze instead.
        if (samples >= RUN_MIN_SAMPLES && avg < RUN_THRESHOLD_MS) {
          startBreather();
          return;
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

        if (newSteps >= hike.steps) {
          setDone(true);
        }
      } else {
        if (invalidTimerRef.current) clearTimeout(invalidTimerRef.current);
        setInvalidFlash(true);
        setFeedback('same foot');
        invalidTimerRef.current = setTimeout(() => {
          setInvalidFlash(false);
          setFeedback(nextFootRef.current + ' foot');
        }, 600);
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
    };
  }, []);

  const startX = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => false,

      onPanResponderGrant: (evt) => {
        startX.current = evt.nativeEvent.locationX;
      },

      onPanResponderRelease: (evt, gestureState) => {
        const { dx, dy } = gestureState;
        const releaseX = evt.nativeEvent.locationX;
        const screenWidth = Dimensions.get('window').width;

        const startedLeft = startX.current < screenWidth / 2;
        const endedLeft = releaseX < screenWidth / 2;
        const stayedOnSameHalf = startedLeft === endedLeft;
        const isDownSwipe = dy > SWIPE_THRESHOLD && Math.abs(dy) > Math.abs(dx) * 1.2;

        if (isDownSwipe && stayedOnSameHalf) {
          handleStep(startedLeft ? 'left' : 'right');
        }
      },
    })
  ).current;

  const pct = Math.min((steps / hike.steps) * 100, 100);
  const remainingSteps = Math.max(0, hike.steps - steps);
  const etaText = formatDuration((remainingSteps * paceMs) / 1000);

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
      <RouteMap hike={hike} steps={displayedSteps} />

      <SafeAreaView style={styles.walkingOverlay} {...panResponder.panHandlers}>
        <View style={styles.topPanel}>
          <TouchableOpacity onPress={onBack}>
            <Text style={styles.backLink}>← hikes</Text>
          </TouchableOpacity>
          <Text style={styles.walkingTitle}>{hike.name}</Text>
          <Text style={styles.stepCount}>
            {formatSteps(steps)} / {formatSteps(hike.steps)} steps
          </Text>
          <Text style={styles.pctLabel}>{pct.toFixed(1)}% complete</Text>
          {remainingSteps > 0 && etaText && (
            <Text style={styles.etaLabel}>≈ {etaText} to go at this pace</Text>
          )}
          <View style={styles.progressBarOuter}>
            <View style={[styles.progressBarInner, { width: pct + '%' }]} />
          </View>
        </View>

        <View style={styles.spacer} pointerEvents="none" />

        <View style={styles.bottomBar} pointerEvents="none">
          <View style={styles.footRow}>
            <Text style={[styles.footZoneText, nextFoot === 'left' && styles.footZoneTextActive]}>
              LEFT
            </Text>
            <Text style={[styles.footZoneText, nextFoot === 'right' && styles.footZoneTextActive]}>
              RIGHT
            </Text>
          </View>
          <Text
            style={[
              styles.feedback,
              invalidFlash && styles.feedbackInvalid,
              blocked && styles.feedbackRunning,
            ]}
          >
            {feedback}
          </Text>
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

export default function GameScreen() {
  const [currentHike, setCurrentHike] = useState(null);

  if (!currentHike) {
    return <HikeSelector onSelect={setCurrentHike} />;
  }

  return <WalkingView hike={currentHike} onBack={() => setCurrentHike(null)} />;
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
    fontSize: 12,
    color: '#8a7a55',
    fontWeight: '600',
    marginTop: 3,
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
    color: '#b8860b',
    fontWeight: '700',
  },
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

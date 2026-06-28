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
import { useVideoPlayer, VideoView } from 'expo-video';
import { HIKES } from './hikeData';

const SWIPE_THRESHOLD = 40;
// Cadence -> playback tuning. A step interval of BASE_INTERVAL_MS plays the
// scenery at 1x; quicker steps speed it up, slower steps slow it down.
const BASE_INTERVAL_MS = 500;
const MIN_RATE = 0.5;
const MAX_RATE = 3.0;
// How long the scenery keeps moving after a step before it pauses. Scaled to
// your pace so steady-but-slow walking keeps drifting instead of stuttering.
const MIN_LINGER_MS = 350;
const MAX_LINGER_MS = 1600;
// A gap longer than this means you stopped and restarted, so cadence resets.
const CADENCE_RESET_MS = 1600;
// Stepping quicker than this (sustained) counts as running, not walking.
const RUN_THRESHOLD_MS = 230;

// Build tag, baked in at deploy time so you can tell which release is live.
// (EXPO_PUBLIC_* vars are inlined by Expo at build; undefined in local dev.)
const BUILD_NUMBER = process.env.EXPO_PUBLIC_BUILD_NUMBER;
const BUILD_SHA = (process.env.EXPO_PUBLIC_BUILD_SHA || '').slice(0, 7);
const BUILD_LABEL = BUILD_NUMBER
  ? `build ${BUILD_NUMBER}${BUILD_SHA ? ' · ' + BUILD_SHA : ''}`
  : 'dev build';

// Default scenery used until a hike supplies its own clip.
const DEFAULT_VIDEO = require('../assets/walk_trail.mp4');

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
  const [running, setRunning] = useState(false);

  const nextFootRef = useRef('left');
  const stepsRef = useRef(0);
  const invalidTimerRef = useRef(null);
  const lingerTimerRef = useRef(null);
  // Cadence tracking: timestamp of the last step + recent step intervals.
  const lastStepAtRef = useRef(0);
  const intervalsRef = useRef([]);

  // Scenery: stays paused until a step nudges it, then drifts back to a stop.
  const videoSource = hike.video || DEFAULT_VIDEO;
  const player = useVideoPlayer(videoSource, (p) => {
    p.loop = true;
    p.muted = true;
  });
  const playerRef = useRef(player);
  playerRef.current = player;

  // Drive the scenery for one step: set its speed to your pace, play, and
  // schedule a pause once you stop (with cadence reset so the next start is fresh).
  const keepWalking = useCallback((rate, linger) => {
    const p = playerRef.current;
    if (!p) return;
    try {
      p.playbackRate = rate;
      p.play();
    } catch (e) {}
    if (lingerTimerRef.current) clearTimeout(lingerTimerRef.current);
    lingerTimerRef.current = setTimeout(() => {
      try {
        playerRef.current && playerRef.current.pause();
      } catch (e) {}
      // Cadence is not reset here: the long-gap check in computePace() handles
      // a genuine stop, while keeping slow-but-steady walking from resetting.
    }, linger);
  }, []);

  // Average step interval -> a playback rate and a linger window.
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
    const avg = arr.length
      ? arr.reduce((a, b) => a + b, 0) / arr.length
      : BASE_INTERVAL_MS;
    const rate = Math.max(MIN_RATE, Math.min(MAX_RATE, BASE_INTERVAL_MS / avg));
    const linger = Math.max(MIN_LINGER_MS, Math.min(MAX_LINGER_MS, avg * 1.7));
    return { rate, linger, avg, sampled: arr.length > 0 };
  }, []);

  const handleStep = useCallback(
    (side) => {
      if (side === nextFootRef.current) {
        const newSteps = stepsRef.current + 1;
        stepsRef.current = newSteps;
        const newFoot = nextFootRef.current === 'left' ? 'right' : 'left';
        nextFootRef.current = newFoot;

        setSteps(newSteps);
        setNextFoot(newFoot);
        const { rate, linger, avg, sampled } = computePace();
        keepWalking(rate, linger);

        // Sustained fast cadence = running. This is a walking game.
        const running = sampled && avg < RUN_THRESHOLD_MS;
        setRunning(running);
        if (running) {
          setFeedback('no running!');
        } else {
          setFeedback(side === 'left' ? 'left foot' : 'right foot');
        }

        if (newSteps >= hike.steps) {
          setDone(true);
        }
      } else {
        if (invalidTimerRef.current) clearTimeout(invalidTimerRef.current);
        setInvalidFlash(true);
        setRunning(false);
        setFeedback('same foot');
        invalidTimerRef.current = setTimeout(() => {
          setInvalidFlash(false);
          setFeedback(nextFootRef.current + ' foot');
        }, 600);
      }
    },
    [hike.steps, keepWalking, computePace]
  );

  // Tidy up timers and stop the scenery when leaving the walk.
  useEffect(() => {
    return () => {
      if (invalidTimerRef.current) clearTimeout(invalidTimerRef.current);
      if (lingerTimerRef.current) clearTimeout(lingerTimerRef.current);
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
          setRunning(false);
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
      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        contentFit="cover"
        nativeControls={false}
        pointerEvents="none"
      />

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
          <View style={styles.progressBarOuter}>
            <View style={[styles.progressBarInner, { width: pct + '%' }]} />
          </View>
        </View>

        <View style={styles.footZones} pointerEvents="none">
          <View style={[styles.footZone, nextFoot === 'left' && styles.footZoneActive]}>
            <Text style={[styles.footZoneText, nextFoot === 'left' && styles.footZoneTextActive]}>
              LEFT
            </Text>
          </View>
          <View style={[styles.footZone, nextFoot === 'right' && styles.footZoneActive]}>
            <Text style={[styles.footZoneText, nextFoot === 'right' && styles.footZoneTextActive]}>
              RIGHT
            </Text>
          </View>
        </View>

        <Text
          style={[
            styles.feedback,
            invalidFlash && styles.feedbackInvalid,
            running && styles.feedbackRunning,
          ]}
        >
          {feedback}
        </Text>
      </SafeAreaView>
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

  // Walking view (video background + overlay)
  walkingRoot: {
    flex: 1,
    backgroundColor: '#2b2b2b',
  },
  walkingOverlay: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topPanel: {
    backgroundColor: 'rgba(245,245,240,0.86)',
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

  footZones: {
    flex: 1,
    flexDirection: 'row',
  },
  footZone: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footZoneActive: {
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  footZoneText: {
    fontSize: 13,
    letterSpacing: 2,
    color: 'rgba(255,255,255,0.45)',
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  footZoneTextActive: {
    color: 'rgba(255,255,255,0.95)',
  },
  feedback: {
    textAlign: 'center',
    fontSize: 15,
    color: '#fff',
    paddingBottom: 24,
    letterSpacing: 1,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  feedbackInvalid: {
    color: 'rgba(255,255,255,0.55)',
  },
  feedbackRunning: {
    color: '#ffd24d',
    fontWeight: '700',
  },
  buildTagOverlay: {
    position: 'absolute',
    right: 8,
    bottom: 4,
    fontSize: 10,
    color: 'rgba(255,255,255,0.6)',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
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

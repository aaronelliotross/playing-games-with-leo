import React, { useState, useRef, useCallback } from 'react';
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
import { HIKES } from './hikeData';

const SWIPE_THRESHOLD = 40;

function formatSteps(n) {
  return n.toLocaleString();
}

function HikeSelector({ onSelect }) {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Choose a Hike</Text>
      <FlatList
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

  const nextFootRef = useRef('left');
  const stepsRef = useRef(0);
  const invalidTimerRef = useRef(null);

  const handleStep = useCallback(
    (side) => {
      if (side === nextFootRef.current) {
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
    [hike.steps]
  );

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
    <SafeAreaView style={styles.container}>
      <View style={styles.walkingHeader}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backLink}>← hikes</Text>
        </TouchableOpacity>
        <Text style={styles.walkingTitle}>{hike.name}</Text>
        <Text style={styles.walkingDistance}>{hike.distanceLabel}</Text>
      </View>

      <View style={styles.progressSection}>
        <Text style={styles.stepCount}>
          {formatSteps(steps)} / {formatSteps(hike.steps)}
        </Text>
        <Text style={styles.stepLabel}>steps</Text>
        <Text style={styles.pctLabel}>{pct.toFixed(1)}% complete</Text>
        <View style={styles.progressBarOuter}>
          <View style={[styles.progressBarInner, { width: pct + '%' }]} />
        </View>
      </View>

      <View
        style={styles.gestureArea}
        {...panResponder.panHandlers}
      >
        <View style={styles.footZones}>
          <View style={[styles.footZone, nextFoot === 'left' && styles.footZoneActive]}>
            <Text style={[styles.footZoneText, nextFoot === 'left' && styles.footZoneTextActive]}>
              LEFT
            </Text>
          </View>
          <View style={styles.footZoneDivider} />
          <View style={[styles.footZone, nextFoot === 'right' && styles.footZoneActive]}>
            <Text style={[styles.footZoneText, nextFoot === 'right' && styles.footZoneTextActive]}>
              RIGHT
            </Text>
          </View>
        </View>
        <Text style={[styles.feedback, invalidFlash && styles.feedbackInvalid]}>
          {feedback}
        </Text>
      </View>
    </SafeAreaView>
  );
}

export default function GameScreen() {
  const [currentHike, setCurrentHike] = useState(null);

  if (!currentHike) {
    return <HikeSelector onSelect={setCurrentHike} />;
  }

  return (
    <WalkingView
      hike={currentHike}
      onBack={() => setCurrentHike(null)}
    />
  );
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

  // Walking view
  walkingHeader: {
    padding: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  backLink: {
    fontSize: 13,
    color: '#666',
    marginBottom: 8,
  },
  walkingTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  walkingDistance: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },

  progressSection: {
    padding: 20,
    paddingBottom: 16,
  },
  stepCount: {
    fontSize: 28,
    fontWeight: '300',
    color: '#1a1a1a',
    letterSpacing: -0.5,
  },
  stepLabel: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
    marginBottom: 8,
  },
  pctLabel: {
    fontSize: 13,
    color: '#555',
    marginBottom: 10,
  },
  progressBarOuter: {
    height: 6,
    backgroundColor: '#ddd',
    borderRadius: 3,
  },
  progressBarInner: {
    height: 6,
    backgroundColor: '#555',
    borderRadius: 3,
  },

  // Gesture area
  gestureArea: {
    flex: 1,
    justifyContent: 'space-between',
    paddingBottom: 20,
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
    backgroundColor: '#eee',
  },
  footZoneText: {
    fontSize: 13,
    letterSpacing: 2,
    color: '#ccc',
    fontWeight: '500',
  },
  footZoneTextActive: {
    color: '#888',
  },
  footZoneDivider: {
    width: 1,
    backgroundColor: '#e0e0e0',
    marginVertical: 20,
  },
  feedback: {
    textAlign: 'center',
    fontSize: 14,
    color: '#888',
    paddingBottom: 8,
    letterSpacing: 1,
  },
  feedbackInvalid: {
    color: '#bbb',
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

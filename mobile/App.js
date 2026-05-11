import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const tabs = ['Home', 'Log', 'Weight', 'Stats'];

function formatTimestamp(value) {
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function createSeedEntries() {
  const now = Date.now();

  return [
    {
      id: 'weight-seed-1',
      type: 'weight',
      value: '186.4',
      unit: 'lb',
      note: 'Morning weigh-in',
      createdAt: now - 1000 * 60 * 60 * 18,
    },
    {
      id: 'workout-seed-1',
      type: 'workout',
      title: 'Push Day',
      detail: 'Bench 3x5, incline DB 3x8, dips 3x10',
      createdAt: now - 1000 * 60 * 60 * 42,
    },
  ];
}

function StatCard({ label, value, tone = 'default' }) {
  return (
    <View style={[styles.card, tone === 'accent' ? styles.cardAccent : null]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function SectionTitle({ children }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

function ScreenShell({ title, subtitle, children }) {
  return (
    <ScrollView contentContainerStyle={styles.screenContent}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>{title}</Text>
        <Text style={styles.heroSubtitle}>{subtitle}</Text>
      </View>
      {children}
    </ScrollView>
  );
}

function HomeScreen({ entries }) {
  return (
    <ScreenShell
      title="Kilo"
      subtitle="This is a real React Native app shell. The old repo root is still a prototype."
    >
      <View style={styles.card}>
        <Text style={styles.callout}>
          The next migration step is porting parser, storage, and history behavior into native components.
        </Text>
      </View>

      <SectionTitle>Recent activity</SectionTitle>
      {entries.map((entry) => (
        <View key={entry.id} style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.entryTitle}>
              {entry.type === 'weight' ? `${entry.value} ${entry.unit}` : entry.title}
            </Text>
            <Text style={styles.entryMeta}>{formatTimestamp(entry.createdAt)}</Text>
          </View>
          <Text style={styles.entryChip}>{entry.type === 'weight' ? 'Weight log' : 'Workout log'}</Text>
          <Text style={styles.entryBody}>
            {entry.type === 'weight' ? entry.note : entry.detail}
          </Text>
        </View>
      ))}
    </ScreenShell>
  );
}

function LogScreen({ workoutTitle, setWorkoutTitle, workoutDetail, setWorkoutDetail, onSaveWorkout }) {
  return (
    <ScreenShell
      title="Workout log"
      subtitle="Native inputs, native layout, native state. No WebView."
    >
      <View style={styles.card}>
        <Text style={styles.inputLabel}>Workout name</Text>
        <TextInput
          value={workoutTitle}
          onChangeText={setWorkoutTitle}
          placeholder="Pull day"
          placeholderTextColor="#7f7e78"
          style={styles.input}
        />
        <Text style={styles.inputLabel}>Session details</Text>
        <TextInput
          value={workoutDetail}
          onChangeText={setWorkoutDetail}
          placeholder="Deadlift 3x5, row 4x8, curls 3x12"
          placeholderTextColor="#7f7e78"
          multiline
          style={[styles.input, styles.multilineInput]}
        />
        <Pressable onPress={onSaveWorkout} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Save workout</Text>
        </Pressable>
      </View>
    </ScreenShell>
  );
}

function WeightScreen({ weightValue, setWeightValue, weightNote, setWeightNote, onSaveWeight }) {
  return (
    <ScreenShell
      title="Weight log"
      subtitle="A real app screen for the MVP loop, even though persistence is not wired yet."
    >
      <View style={styles.card}>
        <Text style={styles.inputLabel}>Weight</Text>
        <TextInput
          value={weightValue}
          onChangeText={setWeightValue}
          placeholder="186.4"
          placeholderTextColor="#7f7e78"
          keyboardType="decimal-pad"
          style={styles.input}
        />
        <Text style={styles.inputLabel}>Note</Text>
        <TextInput
          value={weightNote}
          onChangeText={setWeightNote}
          placeholder="Morning, fasted"
          placeholderTextColor="#7f7e78"
          style={styles.input}
        />
        <Pressable onPress={onSaveWeight} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>Save weigh-in</Text>
        </Pressable>
      </View>
    </ScreenShell>
  );
}

function StatsScreen({ entries }) {
  const summary = useMemo(() => {
    const weightEntries = entries.filter((entry) => entry.type === 'weight');
    const workoutEntries = entries.filter((entry) => entry.type === 'workout');
    const latestWeight = weightEntries[0];

    return {
      latestWeight: latestWeight ? `${latestWeight.value} ${latestWeight.unit}` : 'No data',
      weightCount: String(weightEntries.length),
      workoutCount: String(workoutEntries.length),
    };
  }, [entries]);

  return (
    <ScreenShell
      title="Stats"
      subtitle="Starter metrics only. The old acceptance review passed behavior, not architecture maturity."
    >
      <View style={styles.statsGrid}>
        <StatCard label="Latest weight" value={summary.latestWeight} tone="accent" />
        <StatCard label="Weight entries" value={summary.weightCount} />
        <StatCard label="Workout entries" value={summary.workoutCount} />
      </View>
    </ScreenShell>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState('Home');
  const [entries, setEntries] = useState(createSeedEntries);
  const [weightValue, setWeightValue] = useState('');
  const [weightNote, setWeightNote] = useState('');
  const [workoutTitle, setWorkoutTitle] = useState('');
  const [workoutDetail, setWorkoutDetail] = useState('');

  const sortedEntries = useMemo(
    () => [...entries].sort((left, right) => right.createdAt - left.createdAt),
    [entries]
  );

  function saveWeight() {
    if (!weightValue.trim()) {
      return;
    }

    setEntries((current) => [
      {
        id: `weight-${Date.now()}`,
        type: 'weight',
        value: weightValue.trim(),
        unit: 'lb',
        note: weightNote.trim() || 'No note',
        createdAt: Date.now(),
      },
      ...current,
    ]);
    setWeightValue('');
    setWeightNote('');
    setActiveTab('Home');
  }

  function saveWorkout() {
    if (!workoutTitle.trim() || !workoutDetail.trim()) {
      return;
    }

    setEntries((current) => [
      {
        id: `workout-${Date.now()}`,
        type: 'workout',
        title: workoutTitle.trim(),
        detail: workoutDetail.trim(),
        createdAt: Date.now(),
      },
      ...current,
    ]);
    setWorkoutTitle('');
    setWorkoutDetail('');
    setActiveTab('Home');
  }

  let content = <HomeScreen entries={sortedEntries} />;

  if (activeTab === 'Log') {
    content = (
      <LogScreen
        workoutTitle={workoutTitle}
        setWorkoutTitle={setWorkoutTitle}
        workoutDetail={workoutDetail}
        setWorkoutDetail={setWorkoutDetail}
        onSaveWorkout={saveWorkout}
      />
    );
  } else if (activeTab === 'Weight') {
    content = (
      <WeightScreen
        weightValue={weightValue}
        setWeightValue={setWeightValue}
        weightNote={weightNote}
        setWeightNote={setWeightNote}
        onSaveWeight={saveWeight}
      />
    );
  } else if (activeTab === 'Stats') {
    content = <StatsScreen entries={sortedEntries} />;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.appFrame}>
        <View style={styles.contentArea}>{content}</View>
        <View style={styles.tabBar}>
          {tabs.map((tab) => (
            <Pressable
              key={tab}
              onPress={() => setActiveTab(tab)}
              style={[styles.tab, activeTab === tab ? styles.tabActive : null]}
            >
              <Text style={[styles.tabText, activeTab === tab ? styles.tabTextActive : null]}>
                {tab}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f4efe5',
  },
  appFrame: {
    flex: 1,
    backgroundColor: '#f4efe5',
  },
  contentArea: {
    flex: 1,
  },
  screenContent: {
    padding: 20,
    paddingBottom: 120,
    gap: 14,
  },
  hero: {
    paddingTop: 16,
    paddingBottom: 8,
    gap: 8,
  },
  heroTitle: {
    fontSize: 34,
    fontWeight: '700',
    color: '#1f1a17',
  },
  heroSubtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: '#5d564f',
  },
  card: {
    backgroundColor: '#fffaf2',
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e3d7c5',
    gap: 10,
  },
  cardAccent: {
    backgroundColor: '#d98d42',
    borderColor: '#d98d42',
  },
  callout: {
    fontSize: 16,
    lineHeight: 24,
    color: '#2d2621',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2d2621',
    marginTop: 6,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  entryTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#241f1b',
  },
  entryMeta: {
    fontSize: 12,
    color: '#726a61',
  },
  entryChip: {
    alignSelf: 'flex-start',
    fontSize: 12,
    fontWeight: '600',
    color: '#96571c',
    backgroundColor: '#f0d8bb',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  entryBody: {
    fontSize: 15,
    lineHeight: 22,
    color: '#4f483f',
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4b453f',
  },
  input: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#d9cdbf',
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1f1a17',
  },
  multilineInput: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  primaryButton: {
    marginTop: 4,
    backgroundColor: '#1f1a17',
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#f7f1e8',
    fontSize: 16,
    fontWeight: '700',
  },
  statsGrid: {
    gap: 14,
  },
  statLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#655d55',
  },
  statValue: {
    fontSize: 28,
    fontWeight: '800',
    color: '#201914',
  },
  tabBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 18,
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#201914',
    borderRadius: 24,
    padding: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 18,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: '#d98d42',
  },
  tabText: {
    color: '#cbb9a5',
    fontSize: 13,
    fontWeight: '700',
  },
  tabTextActive: {
    color: '#1f1a17',
  },
});

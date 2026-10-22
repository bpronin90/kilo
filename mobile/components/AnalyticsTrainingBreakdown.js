import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Card, SectionTitle } from './UI';
import { useTheme } from '../theme/ThemeContext';
import { createTrainingBreakdownStyles } from '../screens/analytics/trainingBreakdownStyles';

// Training breakdown (#1580): Movement / Muscles / Equipment views over eligible
// ordinary history. Presentation only; every number comes from
// deriveTrainingBreakdown and nothing is recomputed here.
const VIEWS = [
  { key: 'movement', label: 'Movement' },
  { key: 'muscles', label: 'Muscles' },
  { key: 'equipment', label: 'Equipment' },
];
const ROW_LIMIT = 8;
const NAME_LIMIT = 3;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const pct = (known, total) => (total > 0 ? Math.round((known / total) * 100) : 0);

function Row({ styles, bucket, first, muted = false, tag = null, testID }) {
  const [open, setOpen] = useState(false);
  const names = bucket.exercises.map((e) => e.name);
  const long = names.length > NAME_LIMIT;
  const shown = open || !long ? names : names.slice(0, NAME_LIMIT);
  const unit = bucket.unit === 'entry' ? ['entry', 'entries'] : ['set', 'sets'];
  return (
    <View testID={testID} style={[styles.row, !first && styles.rowBorder]}>
      <View style={styles.rowHead}>
        <Text style={[styles.rowLabel, muted && styles.rowLabelMuted]}>{bucket.label}{tag ? ` · ${tag}` : ''}</Text>
        <Text style={styles.rowCount}>{plural(bucket.sets, unit[0], unit[1])}</Text>
      </View>
      <Text style={styles.rowNames}>{shown.join(', ')}</Text>
      {long ? (
        <Pressable
          testID={`${testID}-names-toggle`}
          style={styles.showAll}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={open ? 'Show fewer exercises' : `Show all ${names.length} exercises`}
          onPress={() => setOpen((v) => !v)}
        >
          <Text style={styles.showAllText}>{open ? 'Show fewer' : `+${names.length - NAME_LIMIT} more`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function BucketList({ styles, buckets, tail = null, showAll, testPrefix }) {
  const visible = showAll ? buckets : buckets.slice(0, ROW_LIMIT);
  const rows = visible.map((b, i) => (
    <Row key={b.id} styles={styles} bucket={b} first={i === 0} testID={`${testPrefix}-${b.id}`}
      tag={b.source === 'override' ? 'your choice' : null} />
  ));
  if (tail) rows.push(<Row key="tail" styles={styles} bucket={tail} first={rows.length === 0} muted testID={`${testPrefix}-${tail.id}`} />);
  return <View>{rows}</View>;
}

function coverageText(label, c) {
  return `${label}: ${c.knownSets} of ${c.totalSets} sets (${pct(c.knownSets, c.totalSets)}%)`;
}

function MovementView({ styles, data, showAll }) {
  return (
    <>
      <BucketList styles={styles} buckets={data.groups} tail={data.unclassified} showAll={showAll} testPrefix="training-breakdown-movement" />
      <Text testID="training-breakdown-movement-coverage" style={styles.coverage}>{coverageText('Movement classified', data.coverage)}</Text>
      {data.overriddenSets > 0 ? (
        <Text style={styles.note}>Sets under “your choice” use the group you saved in that note, with its original label.</Text>
      ) : null}
      {data.unreadableOverrideNotes > 0 ? (
        <Text testID="training-breakdown-overrides-unreadable" style={styles.note}>
          Saved group choices in {plural(data.unreadableOverrideNotes, 'note', 'notes')} could not be read, so library groups are used there.
        </Text>
      ) : null}
    </>
  );
}

function MusclesView({ styles, data, showAll }) {
  return (
    <>
      <Text style={styles.note}>
        A compound set can count under several muscles, so these rows overlap and do not add up to a unique set total. Counts are sets, not measured stimulus or fatigue.
      </Text>
      <Text style={styles.listTitle}>Primary target sets</Text>
      <BucketList styles={styles} buckets={data.primary} tail={data.unknown} showAll={showAll} testPrefix="training-breakdown-primary" />
      <Text style={styles.listTitle}>Secondary involvement sets</Text>
      {data.secondary.length > 0
        ? <BucketList styles={styles} buckets={data.secondary} showAll={showAll} testPrefix="training-breakdown-secondary" />
        : <Text style={styles.note}>No secondary muscles recorded for these exercises.</Text>}
      <Text testID="training-breakdown-muscles-coverage" style={styles.coverage}>
        {coverageText('Primary muscles known', data.coverage.primary)}
      </Text>
      <Text style={styles.coverage}>{coverageText('Secondary muscles known', data.coverage.secondary)}</Text>
    </>
  );
}

function EquipmentView({ styles, data, showAll }) {
  return (
    <>
      <Text style={styles.note}>
        A set can involve several implements, so a set may appear in more than one row. Exercises the library does not recognise stay unknown here and keep their movement group.
      </Text>
      <BucketList styles={styles} buckets={data.items} tail={data.unknown} showAll={showAll} testPrefix="training-breakdown-equipment" />
      <Text testID="training-breakdown-equipment-coverage" style={styles.coverage}>{coverageText('Equipment known', data.coverage)}</Text>
    </>
  );
}

function Body({ styles, breakdown, view, showAll }) {
  if (view === 'muscles') return <MusclesView styles={styles} data={breakdown.muscles} showAll={showAll} />;
  if (view === 'equipment') return <EquipmentView styles={styles} data={breakdown.equipment} showAll={showAll} />;
  return <MovementView styles={styles} data={breakdown.movement} showAll={showAll} />;
}

function listLength(breakdown, view) {
  if (view === 'muscles') return Math.max(breakdown.muscles.primary.length, breakdown.muscles.secondary.length);
  if (view === 'equipment') return breakdown.equipment.items.length;
  return breakdown.movement.groups.length;
}

export function AnalyticsTrainingBreakdown({ breakdown, isLoading = false, hasError = false, paused = false, onLayout }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createTrainingBreakdownStyles(colors, kua), [colors, kua]);
  const [view, setView] = useState('movement');
  const [showAll, setShowAll] = useState(false);

  let content;
  if (isLoading) {
    content = (
      <View testID="training-breakdown-loading" style={styles.placeholder}>
        <ActivityIndicator size="small" color={kua ? kua.primary : colors.accent} />
        <Text style={styles.placeholderText}>Reading your training history…</Text>
      </View>
    );
  } else if (hasError) {
    content = (
      <View testID="training-breakdown-error" style={styles.placeholder}>
        <Text style={styles.placeholderText}>Workout notes could not be read, so the training breakdown is unavailable.</Text>
      </View>
    );
  } else if (!breakdown || breakdown.isEmpty) {
    content = (
      <View testID="training-breakdown-empty" style={styles.placeholder}>
        <Text style={styles.placeholderText}>No completed sets in eligible history yet. Log a working set to see it here.</Text>
      </View>
    );
  } else {
    const { completedSets, exerciseCount } = breakdown.totals;
    content = (
      <>
        <Text testID="training-breakdown-scope" style={styles.scope}>{breakdown.scope}</Text>
        <Text style={styles.note}>{plural(completedSets, 'completed set', 'completed sets')} across {plural(exerciseCount, 'exercise', 'exercises')}. Warm-ups and skipped sets are not counted.</Text>
        <View style={styles.viewToggle} accessibilityRole="radiogroup" accessibilityLabel="Breakdown view">
          {VIEWS.map((v) => {
            const selected = v.key === view;
            return (
              <Pressable
                key={v.key}
                testID={`training-breakdown-view-${v.key}`}
                onPress={() => { setView(v.key); setShowAll(false); }}
                style={[styles.viewOption, selected && styles.viewOptionSelected]}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${v.label} view`}
              >
                <Text style={[styles.viewOptionText, selected && styles.viewOptionTextSelected]} accessible={false}>{v.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Body styles={styles} breakdown={breakdown} view={view} showAll={showAll} />
        {listLength(breakdown, view) > ROW_LIMIT ? (
          <Pressable testID="training-breakdown-show-all" style={styles.showAll} accessibilityRole="button" onPress={() => setShowAll((s) => !s)}>
            <Text style={styles.showAllText}>{showAll ? 'Show fewer' : 'Show all'}</Text>
          </Pressable>
        ) : null}
        {breakdown.timed ? (
          <View testID="training-breakdown-timed">
            <Row styles={styles} bucket={breakdown.timed} first testID="training-breakdown-timed-row" />
          </View>
        ) : null}
      </>
    );
  }

  return (
    <View testID="training-breakdown-section" onLayout={onLayout} style={styles.section}>
      <SectionTitle>Training breakdown</SectionTitle>
      <Card style={styles.card}>
        {paused ? <Text testID="training-breakdown-paused" style={styles.paused}>Paused during Recovery · baseline history</Text> : null}
        {content}
      </Card>
    </View>
  );
}

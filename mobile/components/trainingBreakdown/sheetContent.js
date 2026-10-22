import React from 'react';
import { Text, View } from 'react-native';
import { MUSCLE_REGIONS, muscleShortName } from '../../lib/data/trainingBreakdownMappings';
import { RankedRow, plural } from './BreakdownRows';

// Bottom-sheet content for every Training breakdown drill-down (#1588). Each
// descriptor resolves against the CURRENT range's breakdown, so counts always
// match the derivation buckets; a descriptor whose bucket is gone resolves to null.

function Exercises({ styles, p, bucket, testPrefix }) {
  const max = Math.max(1, bucket.exercises[0]?.sets || 0);
  return (
    <View>
      {bucket.exercises.map((ex, i) => (
        <RankedRow key={ex.key || ex.name} styles={styles} p={p} label={ex.name} value={ex.sets} max={max} first={i === 0} plain light
          testID={`${testPrefix}-ex-${i}`} />
      ))}
    </View>
  );
}

function exerciseSheet(styles, p, bucket, { unit = 'sets', sub = '', title = bucket.label, testPrefix }) {
  const units = unit === 'entries' ? ['entry', 'entries'] : ['set', 'sets'];
  const meta = [plural(bucket.sets, units[0], units[1]), plural(bucket.exercises.length, 'exercise', 'exercises'), sub].filter(Boolean).join(' · ');
  return {
    title,
    body: (
      <>
        <Text style={styles.meta} testID="training-breakdown-sheet-meta">{meta}</Text>
        <Exercises styles={styles} p={p} bucket={bucket} testPrefix={testPrefix} />
      </>
    ),
  };
}

function Key({ styles, p }) {
  return (
    <View style={styles.keys}>
      <View style={styles.keyItem}><View style={[styles.keySwatch, { backgroundColor: p.primary }]} /><Text style={styles.keyText}>Primary</Text></View>
      <View style={styles.keyItem}><View style={[styles.keySwatch, { backgroundColor: p.primary, opacity: 0.3 }]} /><Text style={styles.keyText}>Secondary (+n)</Text></View>
    </View>
  );
}

const RANGE_TEXT = { '30D': 'last 30 days', '90D': 'last 90 days', All: 'all time' };

function Method({ styles, label, children }) {
  return <Text style={styles.methodText}><Text style={styles.methodStrong}>{label}</Text> {children}</Text>;
}

function methodology(styles, range) {
  return {
    title: 'How this is counted',
    body: (
      <>
        <Text style={styles.meta}>Eligible ordinary history · {RANGE_TEXT[range]}</Text>
        <View style={styles.method} testID="training-breakdown-methodology">
          <Method styles={styles} label="Completed sets">are working sets with reps. Warm-ups, skipped sets and entries, unparsed rows and empty prescriptions are not counted. Notes kept out of ordinary analytics by Recovery are excluded; ordinary deload notes count.</Method>
          <Method styles={styles} label="Range.">30D and 90D include notes dated today and the previous 29 or 89 days on this device&apos;s local calendar. Notes with a missing or unreadable date appear only in All.</Method>
          <Method styles={styles} label="Movement">puts each set in exactly one group: the library group, or the group you saved in that note (✎ your choice, shown with its original label). Unclassified sets are listed with the groups.</Method>
          <Method styles={styles} label="Compared">sums library groups only. Push = horizontal and vertical push; Pull = horizontal and vertical pull; Knee-dominant = squat, lunge/step and knee extension; Hip-dominant = hip hinge and hip extension. Saved group choices and Unclassified sets are left out, and each share uses only the two included sides. It describes what you logged; it is not a recommendation.</Method>
          <Method styles={styles} label="Muscles and equipment overlap.">One compound set counts under every muscle or implement it involves, so these counts never add up to your completed sets. They are sets, not measured stimulus or fatigue.</Method>
          <Method styles={styles} label="Unknown">means the library does not recognise that detail for the exercise. It is never guessed, and unknown equipment keeps its movement group.</Method>
          <Method styles={styles} label="Timed and cardio">entries are tallied separately and are not counted as strength sets.</Method>
        </View>
      </>
    ),
  };
}

function groupsSheet(styles, p, b, onOpen) {
  const m = b.movement;
  const total = b.totals.completedSets;
  const max = Math.max(1, m.groups[0]?.sets || 0, m.unclassified?.sets || 0);
  return {
    title: 'All movement groups',
    body: (
      <>
        <Text style={styles.meta}>{plural(total, 'set', 'sets')} · each set in one group</Text>
        {m.groups.map((g, i) => (
          <RankedRow key={g.id} styles={styles} p={p} label={g.label} value={g.sets} total={total} max={max} first={i === 0}
            tag={g.source === 'override' ? '✎ your choice' : null} testID={`training-breakdown-all-group-${g.id}`}
            onPress={() => onOpen({ kind: 'group', id: g.id }, true)} />
        ))}
        {m.unclassified ? (
          <RankedRow styles={styles} p={p} label="Unclassified" value={m.unclassified.sets} total={total} max={max} first={m.groups.length === 0} unknown
            testID="training-breakdown-all-group-unclassified" onPress={() => onOpen({ kind: 'unclassified' }, true)} />
        ) : null}
      </>
    ),
  };
}

function regionSheet(styles, p, b, id, onOpen) {
  const region = (b.muscles.regions || []).find((r) => r.id === id);
  const def = MUSCLE_REGIONS.find((r) => r.id === id);
  if (!region || !def) return null;
  const prim = new Map(b.muscles.primary.map((x) => [x.id, x]));
  const sec = new Map(b.muscles.secondary.map((x) => [x.id, x]));
  const ids = def.muscles.filter((m) => prim.has(m) || sec.has(m))
    .sort((x, y) => (prim.get(y)?.sets || 0) - (prim.get(x)?.sets || 0) || (sec.get(y)?.sets || 0) - (sec.get(x)?.sets || 0));
  const max = Math.max(1, ...ids.map((m) => (prim.get(m)?.sets || 0) + (sec.get(m)?.sets || 0)));
  return {
    title: region.label,
    body: (
      <>
        <Text style={styles.meta}>{plural(region.sets, 'set targets', 'sets target')} {region.label.toLowerCase()} as primary · muscle rows overlap</Text>
        <Key styles={styles} p={p} />
        {ids.length === 0 ? <Text style={styles.placeholderText}>No muscles in this region were trained in this range.</Text> : null}
        {ids.map((m, i) => {
          const ps = prim.get(m)?.sets || 0;
          const ss = sec.get(m)?.sets || 0;
          const label = muscleShortName(m, (prim.get(m) || sec.get(m)).label);
          return (
            <RankedRow key={m} styles={styles} p={p} label={label} value={ps} extra={ss ? `+${ss}` : null} secondary={ss} max={max} first={i === 0}
              a11y={`${label}, ${ps} primary sets, ${ss} secondary sets`} testID={`training-breakdown-region-muscle-${m}`}
              onPress={() => onOpen({ kind: 'muscle', id: m }, true)} />
          );
        })}
      </>
    ),
  };
}

function muscleSheet(styles, p, b, id) {
  const pb = b.muscles.primary.find((x) => x.id === id);
  const sb = b.muscles.secondary.find((x) => x.id === id);
  if (!pb && !sb) return null;
  const part = (bucket, label, prefix) => (bucket ? (
    <View key={prefix} testID={`training-breakdown-${prefix}`}>
      <Text style={[styles.keyText, { marginTop: 12 }]}>{label} · {plural(bucket.sets, 'set', 'sets')}</Text>
      <Exercises styles={styles} p={p} bucket={bucket} testPrefix={`training-breakdown-${prefix}`} />
    </View>
  ) : null);
  return {
    title: muscleShortName(id, (pb || sb).label),
    body: (
      <>
        <Text style={styles.meta}>{pb?.sets || 0} primary · {sb?.sets || 0} secondary</Text>
        {part(pb, 'Primary target', 'muscle-primary')}
        {part(sb, 'Secondary involvement', 'muscle-secondary')}
      </>
    ),
  };
}

function allEquipmentSheet(styles, p, b, onOpen) {
  const e = b.equipment;
  const total = b.totals.completedSets;
  const max = Math.max(1, e.items[0]?.sets || 0, e.unknown?.sets || 0);
  return {
    title: 'All equipment',
    body: (
      <>
        <Text style={styles.meta}>Share of {plural(total, 'set', 'sets')} · one set can use several</Text>
        {e.items.map((it, i) => (
          <RankedRow key={it.id} styles={styles} p={p} label={it.label} value={it.sets} total={total} max={max} first={i === 0}
            testID={`training-breakdown-all-equipment-${it.id}`} onPress={() => onOpen({ kind: 'equipment', id: it.id }, true)} />
        ))}
        {e.unknown ? (
          <RankedRow styles={styles} p={p} label={e.unknown.label} value={e.unknown.sets} total={total} max={max} first={e.items.length === 0} unknown
            testID="training-breakdown-all-equipment-unknown" onPress={() => onOpen({ kind: 'unknownEquipment' }, true)} />
        ) : null}
      </>
    ),
  };
}

export function resolveSheet(desc, { styles, p, breakdown: b, range, onOpen }) {
  if (!desc) return null;
  if (desc.kind === 'info') return methodology(styles, range);
  if (!b) return null;
  const m = b.movement;
  switch (desc.kind) {
    case 'group': {
      const g = m.groups.find((x) => x.id === desc.id);
      return g ? exerciseSheet(styles, p, g, { sub: g.source === 'override' ? 'your saved group' : '', testPrefix: 'training-breakdown-sheet' }) : null;
    }
    case 'unclassified':
      return m.unclassified ? exerciseSheet(styles, p, m.unclassified, { sub: 'no library group', testPrefix: 'training-breakdown-sheet' }) : null;
    case 'allGroups': return groupsSheet(styles, p, b, onOpen);
    case 'region': return regionSheet(styles, p, b, desc.id, onOpen);
    case 'muscle': return muscleSheet(styles, p, b, desc.id);
    case 'unknownMuscles':
      return b.muscles.unknown ? exerciseSheet(styles, p, b.muscles.unknown, { sub: 'not in the library', testPrefix: 'training-breakdown-sheet' }) : null;
    case 'equipment': {
      const it = b.equipment.items.find((x) => x.id === desc.id);
      return it ? exerciseSheet(styles, p, it, { testPrefix: 'training-breakdown-sheet' }) : null;
    }
    case 'unknownEquipment':
      return b.equipment.unknown ? exerciseSheet(styles, p, b.equipment.unknown, { sub: 'movement group kept', testPrefix: 'training-breakdown-sheet' }) : null;
    case 'allEquipment': return allEquipmentSheet(styles, p, b, onOpen);
    case 'timed':
      return b.timed ? exerciseSheet(styles, p, b.timed, { unit: 'entries', sub: 'not counted as strength sets', title: 'Timed and cardio', testPrefix: 'training-breakdown-sheet' }) : null;
    default: return null;
  }
}

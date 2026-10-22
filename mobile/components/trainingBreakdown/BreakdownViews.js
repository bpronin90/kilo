import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Card } from '../UI';
import { MUSCLE_REGIONS, muscleShortName } from '../../lib/data/trainingBreakdownMappings';
import { heatFill, tint } from './breakdownPalette';
import { RankedRow, pct, plural } from './BreakdownRows';

// Movement / Muscles / Equipment views (#1588). Presentation only: every count,
// share, region total and comparison comes from deriveTrainingBreakdownForRange
// (#1589). Drill-downs open bottom sheets through `onOpen(descriptor)`; nothing
// expands inline.

const TOP_GROUPS = 5;
const TOP_EQUIPMENT = 6;

function CardHead({ styles, title, hint = null, right = null }) {
  return (
    <View style={styles.cardHead}>
      <Text style={styles.cardTitle} accessibilityRole="header">{title}</Text>
      {right || (hint ? <Text style={styles.cardHint}>{hint}</Text> : null)}
    </View>
  );
}

function Comparison({ styles, p, cmp }) {
  const [a, b] = cmp.sides;
  const none = cmp.totalSets === 0;
  return (
    <View style={styles.cmp} testID={`training-breakdown-compare-${cmp.id}`} accessible
      accessibilityLabel={`${a.label} ${a.sets} sets, ${pct(a.sets, cmp.totalSets)}%; ${b.label} ${b.sets} sets, ${pct(b.sets, cmp.totalSets)}%`}>
      <View style={styles.cmpLabels}>
        <Text style={styles.cmpLabel}>{a.label} <Text style={styles.cmpCount}>{a.sets}</Text></Text>
        <Text style={styles.cmpLabel}><Text style={styles.cmpCount}>{b.sets}</Text> {b.label}</Text>
      </View>
      <View style={styles.cmpTrack}>
        {none ? null : (
          <>
            <View style={{ flex: a.sets, backgroundColor: p.primary }} />
            <View style={{ flex: b.sets, backgroundColor: p.muted }} />
          </>
        )}
      </View>
      <View style={styles.cmpLabels}>
        <Text style={styles.cmpPct}>{Math.round(a.share * 100)}%</Text>
        <Text style={styles.cmpPct}>{Math.round(b.share * 100)}%</Text>
      </View>
    </View>
  );
}

function GroupTile({ styles, p, group, max, total, onOpen }) {
  const { backgroundColor, ink } = heatFill(p, group.sets / max);
  const override = group.source === 'override';
  return (
    <Pressable
      testID={`training-breakdown-group-${group.id}`}
      onPress={() => onOpen({ kind: 'group', id: group.id })}
      style={[styles.tile, { backgroundColor }]}
      accessibilityRole="button"
      accessibilityLabel={`${group.label}${override ? ', your choice' : ''}, ${group.sets} sets, ${pct(group.sets, total)}% of completed sets`}
    >
      <Text style={[styles.tileLabel, { color: ink }]}>{group.label}{override ? ' ✎' : ''}</Text>
      <View style={styles.tileValueRow}>
        <Text style={[styles.tileValue, { color: ink }]}>{group.sets}</Text>
        <Text style={[styles.tilePct, { color: ink }]}>{pct(group.sets, total)}%</Text>
      </View>
    </Pressable>
  );
}

export function MovementView({ styles, p, breakdown, onOpen }) {
  const m = breakdown.movement;
  const total = breakdown.totals.completedSets;
  const top = m.groups.slice(0, TOP_GROUPS);
  const max = Math.max(1, top[0]?.sets || 0);
  const rows = [top.slice(0, 2), top.slice(2)].filter((r) => r.length);
  const rest = m.groups.length - top.length;
  const showMore = rest > 0 || !!m.unclassified;
  let moreText = `+${plural(rest, 'more group', 'more groups')}${m.unclassified ? ' incl. unclassified' : ''}`;
  if (rest === 0) moreText = `Unclassified · ${plural(m.unclassified?.sets || 0, 'set', 'sets')}`;
  return (
    <>
      <Card style={styles.card}>
        <CardHead styles={styles} title="Compared" hint="sets in library groups" />
        {(m.comparisons || []).map((c) => <Comparison key={c.id} styles={styles} p={p} cmp={c} />)}
      </Card>
      <Card style={styles.card}>
        <CardHead styles={styles} title="Movement groups" hint="each set counted once" />
        {rows.map((r, i) => (
          <View key={i} style={styles.tileRow}>
            {r.map((g) => <GroupTile key={g.id} styles={styles} p={p} group={g} max={max} total={total} onOpen={onOpen} />)}
          </View>
        ))}
        {showMore ? (
          <Pressable testID="training-breakdown-more-groups" style={styles.more} onPress={() => onOpen({ kind: 'allGroups' })}
            accessibilityRole="button" accessibilityLabel={`${moreText}, view all groups`}>
            <Text style={styles.moreText}>{moreText}</Text>
            <Text style={styles.link}>View all ›</Text>
          </Pressable>
        ) : null}
        <View style={styles.foot}>
          <Text testID="training-breakdown-movement-coverage" style={styles.footText}>{pct(m.coverage.knownSets, m.coverage.totalSets)}% classified</Text>
          {m.overriddenSets > 0 ? (
            <Text testID="training-breakdown-overridden" style={styles.footText}>✎ {plural(m.overriddenSets, 'set uses', 'sets use')} your saved group</Text>
          ) : null}
        </View>
        {m.unreadableOverrideNotes > 0 ? (
          <Text testID="training-breakdown-overrides-unreadable" style={styles.footText}>
            Saved group choices in {plural(m.unreadableOverrideNotes, 'note', 'notes')} could not be read, so library groups are used there.
          </Text>
        ) : null}
      </Card>
    </>
  );
}

function RegionTile({ styles, p, region, def, primaryById, max, muscleMax, onOpen }) {
  const { backgroundColor, ink } = heatFill(p, region.sets / max);
  const present = def.muscles.filter((id) => primaryById.get(id)?.sets > 0);
  const topId = [...present].sort((a, b) => primaryById.get(b).sets - primaryById.get(a).sets)[0];
  const topLabel = topId ? `Most: ${muscleShortName(topId, primaryById.get(topId).label)}` : 'No primary sets';
  return (
    <Pressable
      testID={`training-breakdown-region-${region.id}`}
      onPress={() => onOpen({ kind: 'region', id: region.id })}
      style={[styles.region, { backgroundColor }]}
      accessibilityRole="button"
      accessibilityLabel={`${region.label}, ${region.sets} primary sets, ${topLabel}`}
    >
      <View style={styles.regionTop}>
        <Text style={[styles.regionLabel, { color: ink }]}>{region.label}</Text>
        <Text style={[styles.tileValue, { color: ink }]}>{region.sets}</Text>
      </View>
      <Text style={[styles.regionTopMuscle, { color: ink }]}>{topLabel}</Text>
      {/* Strips use the palette's surface ink on every tile (#1593), not the
          per-tile text ink, so their polarity never flips on the brightest tile. */}
      <View style={styles.cells}>
        {(present.length ? present : [null]).map((id, i) => (
          <View key={id || i} testID={`training-breakdown-strip-${region.id}-${id || 'empty'}`}
            style={[styles.cell, { backgroundColor: tint(p.ink, id ? 0.25 + (primaryById.get(id).sets / muscleMax) * 0.7 : 0.14) }]} />
        ))}
      </View>
    </Pressable>
  );
}

export function MusclesView({ styles, p, breakdown, onOpen }) {
  const m = breakdown.muscles;
  const regions = m.regions || [];
  const max = Math.max(1, ...regions.map((r) => r.sets));
  const primaryById = new Map(m.primary.map((b) => [b.id, b]));
  const muscleMax = Math.max(1, ...m.primary.map((b) => b.sets));
  const defs = new Map(MUSCLE_REGIONS.map((r) => [r.id, r]));
  return (
    <Card style={styles.card}>
      <CardHead styles={styles} title="Body regions" hint="primary sets per region" />
      <View style={styles.regions}>
        {regions.map((r) => (
          <RegionTile key={r.id} styles={styles} p={p} region={r} def={defs.get(r.id)} primaryById={primaryById} max={max} muscleMax={muscleMax} onOpen={onOpen} />
        ))}
      </View>
      <View style={styles.legend} accessible accessibilityLabel="Tile shade: fewer to more sets">
        <Text style={styles.footText}>Fewer</Text>
        <View style={styles.legendSteps}>
          {[0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => <View key={t} style={{ flex: 1, backgroundColor: heatFill(p, t).backgroundColor }} />)}
        </View>
        <Text style={styles.footText}>More sets</Text>
      </View>
      <View style={styles.foot}>
        <View style={styles.pill}><Text style={styles.pillText}>Overlapping counts</Text></View>
        {m.unknown ? (
          <Pressable testID="training-breakdown-unknown-muscles" style={styles.footButton} onPress={() => onOpen({ kind: 'unknownMuscles' })}
            accessibilityRole="button" accessibilityLabel={`${m.unknown.sets} sets with unknown muscles, show exercises`}>
            <Text style={styles.footText}><Text style={styles.footStrong}>{m.unknown.sets}</Text> {m.unknown.sets === 1 ? 'set' : 'sets'} · unknown muscles<Text style={styles.chevron}> ›</Text></Text>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}

export function EquipmentView({ styles, p, breakdown, onOpen }) {
  const e = breakdown.equipment;
  const total = breakdown.totals.completedSets;
  const top = e.items.slice(0, TOP_EQUIPMENT);
  // Scale to the largest known item; Unknown is capped at full width (#1593).
  const max = Math.max(1, top[0]?.sets || 0);
  return (
    <Card style={styles.card}>
      <CardHead styles={styles} title="Share of sets using each"
        right={<View style={styles.pill}><Text style={styles.pillText}>Overlapping counts</Text></View>} />
      <View>
        {top.map((item, i) => (
          <RankedRow key={item.id} styles={styles} p={p} label={item.label} value={item.sets} total={total} max={max} first={i === 0}
            testID={`training-breakdown-equipment-${item.id}`} onPress={() => onOpen({ kind: 'equipment', id: item.id })} />
        ))}
        {e.unknown ? (
          <RankedRow styles={styles} p={p} label={e.unknown.label} value={e.unknown.sets} total={total} max={max} first={top.length === 0} unknown
            testID="training-breakdown-equipment-unknown" onPress={() => onOpen({ kind: 'unknownEquipment' })} />
        ) : null}
      </View>
      {e.items.length > TOP_EQUIPMENT ? (
        <Pressable testID="training-breakdown-all-equipment" style={styles.allButton} onPress={() => onOpen({ kind: 'allEquipment' })}
          accessibilityRole="button" accessibilityLabel={`Show all ${e.items.length} equipment`}>
          <Text style={styles.link}>All {e.items.length} equipment ›</Text>
        </Pressable>
      ) : null}
      <Text testID="training-breakdown-equipment-coverage" style={styles.footText}>
        Equipment known for {pct(e.coverage.knownSets, e.coverage.totalSets)}% of sets
      </Text>
    </Card>
  );
}

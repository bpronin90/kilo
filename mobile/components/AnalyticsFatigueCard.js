import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Card } from './UI';
import { Colors } from '../theme/colors';
import { formatCheckInDate } from '../lib/AnalyticsScreenHelpers';

function FatigueRow({ ci, onEdit }) {
  const metrics = [];
  if (ci.exercises_skipped > 0) {
    metrics.push(`${ci.exercises_skipped} skipped`);
  }
  if (ci.volume_decline_pct != null) {
    metrics.push(`${ci.volume_decline_pct}% volume drop`);
  }
  return (
    <Pressable
      style={styles.fatigueEntry}
      onPress={() => onEdit(ci)}
      accessibilityRole="button"
      accessibilityLabel={`Edit check-in for ${formatCheckInDate(ci.responded_at)}`}
    >
      <View style={styles.fatigueEntryAccent} />
      <View style={styles.fatigueEntryBody}>
        <Text style={styles.fatigueDate}>{formatCheckInDate(ci.responded_at)}</Text>
        {ci.reasons.length > 0 && (
          <Text style={styles.fatigueReasons}>{ci.reasons.join(' · ')}</Text>
        )}
        {metrics.length > 0 && (
          <Text style={styles.fatigueMeta}>{metrics.join('  ·  ')}</Text>
        )}
      </View>
      <MaterialIcons name="chevron-right" size={18} color={Colors.textMuted} style={styles.fatigueChevron} />
    </Pressable>
  );
}

function FatigueChip({ ci, onEdit }) {
  return (
    <Pressable
      style={styles.fatigueChip}
      onPress={() => onEdit(ci)}
      accessibilityRole="button"
      accessibilityLabel={`Edit check-in for ${formatCheckInDate(ci.responded_at)}`}
    >
      <Text style={styles.fatigueChipText}>{formatCheckInDate(ci.responded_at)}</Text>
    </Pressable>
  );
}

function FatigueSection({ status, label, count, rows, onEdit, variant = 'detailed' }) {
  return (
    <View style={styles.fatigueSection}>
      <View style={styles.fatigueSectionHeader}>
        <View style={[styles.fatigueDot, styles[`fatigueDot_${status}`]]} />
        <Text style={styles.fatigueSectionLabel}>{label}</Text>
        <Text style={styles.fatigueSectionCount}>{count}</Text>
      </View>
      {variant === 'chips' ? (
        <View style={styles.fatigueChipRow}>
          {rows.map(ci => (
            <FatigueChip key={ci.responded_at} ci={ci} onEdit={onEdit} />
          ))}
        </View>
      ) : (
        <View style={styles.fatigueEntryList}>
          {rows.map(ci => (
            <FatigueRow key={ci.responded_at} ci={ci} onEdit={onEdit} />
          ))}
        </View>
      )}
    </View>
  );
}

export function AnalyticsFatigueCard({
  checkInHistory,
  fatigueExpanded,
  setFatigueExpanded,
  handleCheckInEdit,
}) {
  if (checkInHistory.rough.length === 0 && checkInHistory.ok.length === 0 && checkInHistory.pending.length === 0) {
    return (
      <Card style={styles.fatigueCard}>
        <Text style={styles.fatiguePanelLabel}>Fatigue Tracking</Text>
        <Text style={styles.fatigueEmpty}>No check-ins logged yet.</Text>
      </Card>
    );
  }

  return (
    <Card style={styles.fatigueCard}>
      <Text style={styles.fatiguePanelLabel}>Fatigue Tracking</Text>
      <Pressable
        style={styles.fatigueSummary}
        onPress={() => setFatigueExpanded(e => !e)}
        accessibilityRole="button"
        accessibilityState={{ expanded: fatigueExpanded }}
        accessibilityLabel={fatigueExpanded ? 'Collapse fatigue details' : 'Expand fatigue details'}
      >
        <View style={styles.fatigueSummaryMain}>
          <Text style={styles.fatigueInsightLabel}>
            {checkInHistory.summary.top_reason ? 'Most common reason' : 'Fatigue'}
          </Text>
          <Text style={styles.fatigueInsightValue} numberOfLines={1}>
            {checkInHistory.summary.top_reason
              || (checkInHistory.summary.roughTotal > 0
                ? `${checkInHistory.summary.roughTotal} flagged session${checkInHistory.summary.roughTotal > 1 ? 's' : ''}`
                : 'No rough sessions')}
          </Text>
        </View>
        {checkInHistory.summary.pendingTotal > 0 && (
          <View
            style={styles.fatigueAlert}
            accessibilityLabel={`${checkInHistory.summary.pendingTotal} unanswered check-in${checkInHistory.summary.pendingTotal > 1 ? 's' : ''}`}
          >
            <MaterialIcons name="error-outline" size={14} color={Colors.caution} />
            <Text style={styles.fatigueAlertText}>{checkInHistory.summary.pendingTotal} unanswered</Text>
          </View>
        )}
        <MaterialIcons
          name={fatigueExpanded ? 'expand-less' : 'expand-more'}
          size={22}
          color={Colors.textMuted}
        />
      </Pressable>
      {fatigueExpanded && (
        <View style={styles.fatigueDetails}>
          {checkInHistory.rough.length > 0 && (
            <FatigueSection
              status="rough"
              label="Not great"
              count={checkInHistory.summary.roughTotal}
              rows={checkInHistory.rough}
              onEdit={handleCheckInEdit}
            />
          )}
          {checkInHistory.ok.length > 0 && (
            <FatigueSection
              status="ok"
              label="All good"
              count={checkInHistory.summary.okTotal}
              rows={checkInHistory.ok}
              onEdit={handleCheckInEdit}
              variant="chips"
            />
          )}
          {checkInHistory.pending.length > 0 && (
            <FatigueSection
              status="pending"
              label="Unanswered"
              count={checkInHistory.summary.pendingTotal}
              rows={checkInHistory.pending}
              onEdit={handleCheckInEdit}
              variant="chips"
            />
          )}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  fatigueCard: {
    padding: 20,
    gap: 8,
    backgroundColor: Colors.panelBackground,
  },
  fatiguePanelLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  fatigueEmpty: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingVertical: 8,
  },
  fatigueSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  fatigueSummaryMain: {
    flex: 1,
    gap: 2,
  },
  fatigueAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(212, 160, 23, 0.12)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  fatigueAlertText: {
    fontSize: 11,
    fontWeight: '800',
    color: Colors.caution,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fatigueDetails: {
    gap: 20,
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.divider,
  },
  fatigueInsightLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: Colors.textMuted,
  },
  fatigueInsightValue: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  fatigueSection: {
    gap: 0,
  },
  fatigueSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  fatigueDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  fatigueDot_rough: {
    backgroundColor: Colors.error,
  },
  fatigueDot_ok: {
    backgroundColor: Colors.success,
  },
  fatigueDot_pending: {
    backgroundColor: Colors.caution,
  },
  fatigueSectionLabel: {
    flex: 1,
    fontSize: 11,
    fontWeight: '800',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  fatigueSectionCount: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text,
  },
  fatigueEntryList: {
    gap: 8,
  },
  fatigueEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.subtleBg,
    borderRadius: 10,
    overflow: 'hidden',
  },
  fatigueEntryAccent: {
    alignSelf: 'stretch',
    width: 3,
    backgroundColor: Colors.error,
  },
  fatigueEntryBody: {
    flex: 1,
    gap: 4,
    paddingVertical: 12,
    paddingLeft: 14,
  },
  fatigueChevron: {
    opacity: 0.5,
    marginRight: 10,
  },
  fatigueDate: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fatigueReasons: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text,
  },
  fatigueMeta: {
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '500',
  },
  fatigueChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingLeft: 16,
  },
  fatigueChip: {
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  fatigueChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
  },
});

// Per-exercise movement-group editor (#1306): a single-choice list of every
// group plus "Reset to automatic". It owns all of the control and draft logic and
// none of the numbers, so the breakdown (RecoveryMovementGroups) stays read-only
// and this surface can be relocated (Manage block, #1307) without touching it.
//
// A tap writes through `onSet`. While the write is in flight every option is
// disabled (no duplicate writes). On failure the chosen option stays selected as
// an UNSAVED draft with the error beside it; it is never shown as persisted. The
// draft clears once the persisted group catches up with it.
//
// Options (#1581) are the detailed library groups, listed under their broad
// family. A broad (version 1) group is offered only when it is the current or
// drafted group (a legacy choice or keyword fallback), so it stays visible with
// its existing label and is never silently replaced.

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useTheme } from '../../theme/ThemeContext';
import { DETAILED_MOVEMENT_GROUPS, MOVEMENT_GROUPS, isMovementGroupId, movementGroupLabel } from '../../lib/data/movementGroups';
import { createMovementGroupStyles } from './recoveryMovementGroupStyles';

// Whole-surface availability copy, shared with the breakdown notice.
export const GROUP_EDIT_UNAVAILABLE = Object.freeze({
  unreadable: 'Saved group choices couldn’t be read. Groups use automatic rules only and can’t be edited right now.',
  missing: 'This block’s baseline routine is gone, so groups use automatic rules only and can’t be edited.',
  invalid: 'Saved group choices are unreadable. Groups use automatic rules only and can’t be edited.',
  locked: 'Group editing is paused until Recovery data is current.',
});

// [{ heading, options: [{ id, label }] }] in broad-family order.
const DETAILED_SECTIONS = Object.freeze(MOVEMENT_GROUPS
  .map(b => ({ heading: b.label, options: DETAILED_MOVEMENT_GROUPS.filter(d => d.legacy === b.id) }))
  .filter(s => s.options.length > 0));

export function MovementGroupEditorControl({ exercise, editing, routineTitle }) {
  const { colors, kuaPalette: kua } = useTheme();
  const styles = useMemo(() => createMovementGroupStyles(colors, kua), [colors, kua]);
  const [open, setOpen] = useState(false);
  // { group: id | null (reset) } - the not-yet-persisted choice, if any.
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const { key, name, group, source, automatic_group: automatic } = exercise;
  const target = draft ? (draft.group == null ? automatic : draft.group) : null;
  useEffect(() => {
    if (draft && !error && !busy && group === target) setDraft(null);
  }, [draft, error, busy, group, target]);

  if (!editing || editing.available !== true) return null;
  const selected = target || group;
  const disabled = busy || editing.locked === true;

  const choose = async (next) => {
    if (disabled) return;
    setError(null);
    setDraft({ group: next });
    setBusy(true);
    try {
      const result = await editing.onSet({ noteId: editing.noteId, key, group: next });
      if (!result || result.ok === false) setError((result && result.error) || 'That group could not be saved.');
    } catch (e) {
      setError((e && e.message) || 'That group could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Pressable
        testID={`movement-group-edit-${key}`}
        onPress={() => setOpen(o => !o)}
        style={styles.changeButton}
        accessibilityRole="button"
        accessibilityLabel={`${open ? 'Close' : 'Change'} group for ${name}. Now ${movementGroupLabel(group)}`}
        accessibilityState={{ expanded: open }}
      >
        <Text style={styles.changeButtonText}>{open ? 'Done' : 'Change group'}</Text>
      </Pressable>
      {open ? (
        <View testID={`movement-group-editor-${key}`} style={[styles.editor, { flexBasis: '100%' }]} accessibilityRole="radiogroup" accessibilityLabel={`Group for ${name}`}>
          <Text style={styles.scope}>
            {`Applies to ${name} in every week and every block that uses ${routineTitle}.`}
          </Text>
          {(() => {
            const broad = [group, selected].filter((id, i, a) => isMovementGroupId(id) && a.indexOf(id) === i);
            const sections = broad.length
              ? [{ heading: source === 'override' ? 'Broad group (your earlier choice)' : 'Broad group (from name keywords)', options: broad.map(id => ({ id, label: movementGroupLabel(id) })) }, ...DETAILED_SECTIONS]
              : DETAILED_SECTIONS;
            return sections.map(section => (
              <View key={section.heading} accessibilityRole="none">
                <Text style={styles.optionHeading} accessibilityRole="header">{section.heading}</Text>
                {section.options.map(g => {
                  const isSelected = selected === g.id;
                  return (
                    <Pressable
                      key={g.id}
                      testID={`movement-group-option-${key}-${g.id}`}
                      onPress={() => choose(g.id)}
                      disabled={disabled}
                      style={styles.option}
                      accessibilityRole="radio"
                      accessibilityLabel={g.label}
                      accessibilityState={{ selected: isSelected, disabled, busy: busy && draft?.group === g.id }}
                    >
                      <MaterialIcons name={isSelected ? 'radio-button-checked' : 'radio-button-unchecked'} size={20} color={kua ? kua.primary : colors.accentText} accessible={false} />
                      <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>{g.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ));
          })()}
          <Pressable
            testID={`movement-group-reset-${key}`}
            onPress={() => choose(null)}
            disabled={disabled || (source !== 'override' && !draft)}
            style={styles.option}
            accessibilityRole="button"
            accessibilityLabel={`Reset ${name} to automatic`}
            accessibilityState={{ disabled: disabled || (source !== 'override' && !draft), busy: busy && draft?.group == null }}
          >
            <MaterialIcons name="restart-alt" size={20} color={kua ? kua.primary : colors.accentText} accessible={false} />
            <Text style={[styles.resetText, (source !== 'override' && !draft) && styles.disabledText]}>
              {`Reset to automatic (${movementGroupLabel(automatic)})`}
            </Text>
          </Pressable>
          {busy ? <Text style={styles.exerciseMeta} accessibilityLiveRegion="polite">Saving…</Text> : null}
          {error ? (
            <Text testID={`movement-group-error-${key}`} style={styles.errorText} accessibilityRole="alert">
              {`Not saved: ${error}`}
            </Text>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

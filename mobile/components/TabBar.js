import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors } from '../theme/colors';

export function TabBar({ tabs, activeTab, onTabPress }) {
  return (
    <View style={styles.container}>
      {tabs.map((tab) => (
        <Pressable
          key={tab}
          onPressIn={() => onTabPress(tab)}
          style={[styles.tab, activeTab === tab ? styles.tabActive : null]}
        >
          <Text style={[styles.tabText, activeTab === tab ? styles.tabTextActive : null]}>
            {tab}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    flexDirection: 'row',
    gap: 8,
    backgroundColor: Colors.tabBarBackground,
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
    backgroundColor: Colors.accent,
  },
  tabText: {
    color: Colors.tabInactive,
    fontSize: 13,
    fontWeight: '700',
  },
  tabTextActive: {
    color: Colors.tabBarBackground,
  },
});

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Card from '@/src/components/ui/Card';
import { colors } from '@/src/constants/colors';
import { Insight } from '@/src/services/ai/insightsEngine';

interface InsightCardProps {
  insight: Insight;
}

export default function InsightCard({ insight }: InsightCardProps) {
  const getBackgroundColor = () => {
    switch (insight.type) {
      case 'warning': return '#FEF3C7';
      case 'success': return '#D1FAE5';
      case 'info': return '#DBEAFE';
      case 'tip': return '#E0E7FF';
      default: return colors.background;
    }
  };

  const getTextColor = () => {
    switch (insight.type) {
      case 'warning': return '#92400E';
      case 'success': return '#065F46';
      case 'info': return '#1E40AF';
      case 'tip': return '#3730A3';
      default: return colors.text;
    }
  };

  return (
    <Card style={{ ...styles.container, backgroundColor: getBackgroundColor() }} padding={16}>
      <View style={styles.header}>
        <Text style={styles.icon}>{insight.icon}</Text>
        <Text style={[styles.title, { color: getTextColor() }]}>{insight.title}</Text>
      </View>
      <Text style={[styles.message, { color: getTextColor() }]}>{insight.message}</Text>
      {insight.action ? (
        <View style={styles.actionWrap}>
          <Text style={[styles.actionLabel, { color: getTextColor() }]}>NEXT STEP</Text>
          <Text style={[styles.action, { color: getTextColor() }]}>{insight.action}</Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  icon: { fontSize: 24, marginRight: 8 },
  title: { flex: 1, fontSize: 16, fontWeight: '700' },
  message: { fontSize: 14, lineHeight: 20 },
  actionWrap: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(23, 26, 53, 0.16)',
  },
  actionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 4, opacity: 0.75 },
  action: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
});

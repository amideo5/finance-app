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
      case 'warning':
        return '#FEF3C7';
      case 'success':
        return '#D1FAE5';
      case 'info':
        return '#DBEAFE';
      case 'tip':
        return '#E0E7FF';
      default:
        return colors.background;
    }
  };

  const getTextColor = () => {
    switch (insight.type) {
      case 'warning':
        return '#92400E';
      case 'success':
        return '#065F46';
      case 'info':
        return '#1E40AF';
      case 'tip':
        return '#3730A3';
      default:
        return colors.text;
    }
  };

  return (
    <Card style={{ ...styles.container, backgroundColor: getBackgroundColor() }} padding={16}>
      <View style={styles.header}>
        <Text style={styles.icon}>{insight.icon}</Text>
        <Text style={[styles.title, { color: getTextColor() }]}>{insight.title}</Text>
      </View>
      <Text style={[styles.message, { color: getTextColor() }]}>{insight.message}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  icon: {
    fontSize: 24,
    marginRight: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
  },
});

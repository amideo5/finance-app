import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Card from '@/src/components/ui/Card';
import { colors } from '@/src/constants/colors';
import { formatCurrency } from '@/src/utils/format';

interface GoalProgressProps {
  name: string;
  currentAmount: number;
  targetAmount: number;
  icon?: string;
  targetDate?: string;
  onPress?: () => void;
}

export default function GoalProgress({
  name,
  currentAmount,
  targetAmount,
  icon,
  targetDate,
  onPress,
}: GoalProgressProps) {
  const progress = Math.min((currentAmount / targetAmount) * 100, 100);
  const remaining = Math.max(targetAmount - currentAmount, 0);

  return (
    <Card onPress={onPress} padding={16}>
      <View style={styles.header}>
        <Text style={styles.icon}>{icon || '🎯'}</Text>
        <View style={styles.headerText}>
          <Text style={styles.name}>{name}</Text>
          {targetDate && <Text style={styles.date}>Target: {targetDate}</Text>}
        </View>
      </View>

      <View style={styles.amounts}>
        <View>
          <Text style={styles.amountLabel}>Current</Text>
          <Text style={styles.amount}>{formatCurrency(currentAmount)}</Text>
        </View>
        <View style={styles.targetContainer}>
          <Text style={styles.amountLabel}>Target</Text>
          <Text style={styles.amount}>{formatCurrency(targetAmount)}</Text>
        </View>
      </View>

      <View style={styles.progressContainer}>
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
        <Text style={styles.progressText}>{progress.toFixed(0)}%</Text>
      </View>

      <Text style={styles.remaining}>
        {remaining > 0
          ? `${formatCurrency(remaining)} remaining`
          : 'Goal achieved!'}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  icon: {
    fontSize: 32,
    marginRight: 12,
  },
  headerText: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  date: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  amounts: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  targetContainer: {
    alignItems: 'flex-end',
  },
  amountLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  amount: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressBar: {
    flex: 1,
    height: 8,
    backgroundColor: colors.border,
    borderRadius: 4,
    overflow: 'hidden',
    marginRight: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.success,
    borderRadius: 4,
  },
  progressText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    minWidth: 40,
    textAlign: 'right',
  },
  remaining: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});

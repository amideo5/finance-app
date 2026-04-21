import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors } from '@/src/constants/colors';
import { formatCurrency, formatShortDate } from '@/src/utils/format';

interface TransactionItemProps {
  type: 'income' | 'expense';
  category: string;
  amount: number;
  date: string;
  notes?: string;
  icon?: string;
  onPress?: () => void;
}

export default function TransactionItem({
  type,
  category,
  amount,
  date,
  notes,
  icon,
  onPress,
}: TransactionItemProps) {
  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={!onPress}
    >
      <View style={styles.iconContainer}>
        <Text style={styles.icon}>{icon || (type === 'income' ? '💰' : '💳')}</Text>
      </View>
      <View style={styles.details}>
        <Text style={styles.category}>{category}</Text>
        {notes && <Text style={styles.notes} numberOfLines={1}>{notes}</Text>}
        <Text style={styles.date}>{formatShortDate(date)}</Text>
      </View>
      <Text style={[
        styles.amount,
        type === 'income' ? styles.incomeAmount : styles.expenseAmount
      ]}>
        {type === 'income' ? '+' : '-'}{formatCurrency(amount)}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: colors.card,
    borderRadius: 12,
    marginBottom: 8,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  icon: {
    fontSize: 24,
  },
  details: {
    flex: 1,
  },
  category: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  notes: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  date: {
    fontSize: 12,
    color: colors.textLight,
  },
  amount: {
    fontSize: 16,
    fontWeight: '700',
  },
  incomeAmount: {
    color: colors.income,
  },
  expenseAmount: {
    color: colors.expense,
  },
});

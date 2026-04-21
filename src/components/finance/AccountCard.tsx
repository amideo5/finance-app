import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Card from '@/src/components/ui/Card';
import { colors } from '@/src/constants/colors';
import { formatCurrency } from '@/src/utils/format';

interface AccountCardProps {
  name: string;
  type: string;
  balance: number;
  icon?: string;
  accountNumber?: string;
  onPress?: () => void;
}

export default function AccountCard({
  name,
  type,
  balance,
  icon,
  accountNumber,
  onPress,
}: AccountCardProps) {
  const getTypeLabel = () => {
    const typeMap: { [key: string]: string } = {
      upi: 'UPI',
      bank: 'Bank Account',
      credit_card: 'Credit Card',
      debit_card: 'Debit Card',
      wallet: 'Wallet',
      cash: 'Cash',
    };
    return typeMap[type] || type;
  };

  return (
    <Card onPress={onPress} padding={16}>
      <View style={styles.header}>
        <View style={styles.iconContainer}>
          <Text style={styles.icon}>{icon || '💳'}</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.type}>{getTypeLabel()}</Text>
          {accountNumber && <Text style={styles.accountNumber}>{accountNumber}</Text>}
        </View>
      </View>
      <View style={styles.balanceContainer}>
        <Text style={styles.balanceLabel}>Balance</Text>
        <Text style={styles.balance}>{formatCurrency(balance)}</Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
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
  headerText: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  type: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  accountNumber: {
    fontSize: 12,
    color: colors.textLight,
  },
  balanceContainer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
  },
  balanceLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  balance: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  },
});

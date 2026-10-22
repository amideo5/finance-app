import AccountCard from '@/src/components/finance/AccountCard';
import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { backfillCashTransactions, getAccounts, getOrCreateCashAccount } from '@/src/services/firebase/accountsService';
import { FinanceAccount } from '@/types/finance';
import { useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function AccountsScreen() {
  const router = useRouter();
  const { currentProfile } = useProfile();
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [loading, setLoading] = useState(false);

  const linkHistoricalCash = async () => {
    if (!currentProfile) return;
    try {
      const cash = await getOrCreateCashAccount(currentProfile.id, currentProfile.currency || 'INR');
      const linked = await backfillCashTransactions(currentProfile.id, cash.id);
      await loadAccounts();
      Alert.alert('Historical cash transactions', linked
        ? `Linked ${linked} previous cash transaction(s) to Cash. Balances were not changed.`
        : 'No unlinked cash transactions were found.');
    } catch (error) {
      console.error('Cash transaction migration failed:', error);
      Alert.alert('Migration failed', 'Could not link historical cash transactions. Please try again.');
    }
  };

  const loadAccounts = useCallback(async () => {
    if (!currentProfile) return;

    setLoading(true);
    try {
      setAccounts(await getAccounts(currentProfile.id) as FinanceAccount[]);
    } catch (error) {
      console.error('Error loading accounts:', error);
      Alert.alert('Error', 'Could not load accounts. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [currentProfile]);

  useEffect(() => {
    // Load the selected profile's accounts when the active profile changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAccounts();
  }, [loadAccounts]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Accounts</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => router.push('/accounts/add')}
        >
          <Plus color={colors.card} size={24} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.migrationButton} onPress={() => router.push('/accounts/historical')}>
        <Text style={styles.migrationText}>Assign accounts to historical transactions</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.migrationButton} onPress={() => Alert.alert(
        'Link previous cash transactions?',
        'This will associate unlinked transactions marked Cash with your Cash account. It will not change balances. Other payment methods need account-by-account review.',
        [{ text: 'Cancel', style: 'cancel' }, { text: 'Link cash transactions', onPress: () => { void linkHistoricalCash(); } }],
      )}>
        <Text style={styles.migrationText}>Link previous cash transactions</Text>
      </TouchableOpacity>

      <ScrollView
        style={styles.list}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={loadAccounts} />
        }
      >
        {accounts.map((account) => (
          <AccountCard
            key={account.id}
            name={account.name}
            type={account.type}
            balance={account.balance}
            accountNumber={account.account_number ?? undefined}
          />
        ))}
        {accounts.length === 0 && !loading && (
          <Text style={{ color: colors.textSecondary, textAlign: 'center', marginTop: 32 }}>
            No accounts yet. Add one to start tracking balances.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 24,
    paddingTop: 48,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
  },
  addButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  migrationButton: { marginHorizontal: 24, marginBottom: 8, paddingVertical: 10 },
  migrationText: { color: colors.primary, fontWeight: '600' },
  list: {
    flex: 1,
    paddingHorizontal: 24,
  },
});

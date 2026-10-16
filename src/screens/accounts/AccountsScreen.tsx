import AccountCard from '@/src/components/finance/AccountCard';
import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { getAccounts } from '@/src/services/firebase/accountsService';
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
  list: {
    flex: 1,
    paddingHorizontal: 24,
  },
});

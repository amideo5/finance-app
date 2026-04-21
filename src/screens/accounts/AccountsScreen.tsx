import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import AccountCard from '@/src/components/finance/AccountCard';
import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { Plus } from 'lucide-react-native';

export default function AccountsScreen() {
  const router = useRouter();
  const { currentProfile } = useProfile();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (currentProfile) {
      loadAccounts();
    }
  }, [currentProfile]);

  const loadAccounts = async () => {
    if (!currentProfile) return;

    setLoading(true);
    
    const data = null;;
    setAccounts(data != null ? data : []);
    setLoading(false);
  };

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
            accountNumber={account.account_number}
          />
        ))}
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

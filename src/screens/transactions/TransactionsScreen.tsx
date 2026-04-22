import TransactionItem from '@/src/components/finance/TransactionItem';
import TransactionFilterSheet from '@/src/components/finance/TransactionFilterSheet';
import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { db } from '@/src/firebaseConfig';
import { useRouter } from 'expo-router';
import {
  collection,
  getDocs,
  orderBy,
  query,
} from 'firebase/firestore';
import React, { useEffect, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
} from 'react-native';

export default function TransactionsScreen() {
  const router = useRouter();
  const { currentProfile } = useProfile();

  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // 🔥 Filter state
  const [filterVisible, setFilterVisible] = useState(false);
  const [filters, setFilters] = useState<{
    type?: 'all' | 'income' | 'expense';
    category?: string | null;
    startDate?: Date | null;
    endDate?: Date | null;
  }>({});

  useEffect(() => {
    if (currentProfile) {
      loadTransactions();
    }
  }, [currentProfile]);

  const loadTransactions = async () => {
    if (!currentProfile) return;

    setLoading(true);
    try {
      const snapshot = await getDocs(
        query(
          collection(db, 'profiles', currentProfile.id, 'transactions'),
          orderBy('date', 'desc')
        )
      );

      const data: any[] = [];
      snapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() });
      });

      setTransactions(data);
    } catch (error) {
      console.error('Error loading transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  // 🔥 Apply filters locally
  const filteredTransactions = transactions.filter((t) => {
    if (filters.type && filters.type !== 'all' && t.type !== filters.type)
      return false;

    if (filters.category && t.category !== filters.category)
      return false;

    if (filters.startDate && new Date(t.date) < filters.startDate)
      return false;

    if (filters.endDate && new Date(t.date) > filters.endDate)
      return false;

    return true;
  });

  return (
    <View style={styles.container}>
      <View style={{ height: 20 }} />

      {/* HEADER */}
      <View style={styles.header}>
        <Text style={styles.title}>Transactions</Text>

        <TouchableOpacity onPress={() => setFilterVisible(true)}>
          <Text style={styles.filterBtn}>Filter</Text>
        </TouchableOpacity>
      </View>

      {/* ACTIVE FILTER INDICATOR */}
      {(filters.type ||
        filters.category ||
        filters.startDate ||
        filters.endDate) && (
        <View style={styles.activeFilters}>
          <Text style={styles.activeText}>
            Filters applied
          </Text>
        </View>
      )}

      {/* LIST */}
      <ScrollView
        style={styles.list}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={loadTransactions} />
        }
      >
        {filteredTransactions.map((transaction) => (
          <TransactionItem
            key={transaction.id}
            type={transaction.type}
            category={transaction.category || 'Unknown'}
            amount={transaction.amount}
            date={transaction.date}
            notes={transaction.notes}
            icon={transaction.categoryIcon}
            onPress={() => router.push(`/transactions/${transaction.id}`)}
          />
        ))}

        {filteredTransactions.length === 0 && (
          <Text style={styles.empty}>No transactions found</Text>
        )}
      </ScrollView>

      {/* 🔥 FILTER SHEET */}
      <TransactionFilterSheet
        visible={filterVisible}
        onClose={() => setFilterVisible(false)}
        onApply={(f) => setFilters(f)}
      />
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
  filterBtn: {
    color: colors.primary,
    fontWeight: '600',
  },
  activeFilters: {
    paddingHorizontal: 24,
    marginBottom: 8,
  },
  activeText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  list: {
    flex: 1,
    paddingHorizontal: 24,
  },
  empty: {
    textAlign: 'center',
    marginTop: 40,
    color: colors.textSecondary,
  },
});
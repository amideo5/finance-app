import TransactionItem from '@/src/components/finance/TransactionItem';
import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { db } from '@/src/firebaseConfig';
import { useRouter } from 'expo-router';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { Plus } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function TransactionsScreen() {
  const router = useRouter();
  const { currentProfile } = useProfile();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (currentProfile) {
      loadTransactions();
    }
  }, [currentProfile]);

  const loadTransactions = async () => {
    if (!currentProfile) return;

    setLoading(true);
    try {
      const transactionsSnapshot = await getDocs(
        query(
          collection(db, 'profiles', currentProfile.id, 'transactions'),
          orderBy('date', 'desc')
        )
      );
      const data: any[] = [];
      transactionsSnapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() });
      });
      setTransactions(data);
    } catch (error) {
      console.error('Error loading transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Transactions</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => router.push('/transactions/add-expense')}
        >
          <Plus color={colors.card} size={24} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.list}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={loadTransactions} />
        }
      >
        {transactions.map((transaction) => (
          <TransactionItem
            key={transaction.id}
            type={transaction.type}
            category={transaction.category || 'Unknown'}
            amount={transaction.amount}
            date={transaction.date}
            notes={transaction.notes}
            icon={transaction.categoryIcon}
            onPress={() => router.push('/transactions')}
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

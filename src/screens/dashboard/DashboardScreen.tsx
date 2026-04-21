import TransactionItem from '@/src/components/finance/TransactionItem';
import InsightCard from '@/src/components/insights/InsightCard';
import Card from '@/src/components/ui/Card';
import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { db } from '@/src/firebaseConfig';
import { generateInsights, Insight } from '@/src/services/ai/insightsEngine';
import { formatCurrency } from '@/src/utils/format';
import { useRouter } from 'expo-router';
import {
  collection,
  getDocs,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { Plus } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function DashboardScreen() {
  const router = useRouter();
  const { currentProfile } = useProfile();
  const [loading, setLoading] = useState(false);
  const [balance, setBalance] = useState(0);
  const [monthlyIncome, setMonthlyIncome] = useState(0);
  const [monthlyExpense, setMonthlyExpense] = useState(0);
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);

  useEffect(() => {
    if (currentProfile) {
      loadDashboardData();
    }
  }, [currentProfile]);

  const loadDashboardData = async () => {
    if (!currentProfile) return;

    setLoading(true);

    try {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      // Fetch all transactions to calculate total balance
      const allTransactionsSnapshot = await getDocs(
        collection(db, 'profiles', currentProfile.id, 'transactions')
      );
      const allTransactions: any[] = [];
      allTransactionsSnapshot.forEach((doc) => {
        allTransactions.push({ id: doc.id, ...doc.data() });
      });

      // Calculate total balance: income - expenses
      const totalIncome = allTransactions
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + Number(t.amount || 0), 0);

      const totalExpense = allTransactions
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + Number(t.amount || 0), 0);

      const totalBalance = totalIncome - totalExpense;
      setBalance(totalBalance);

      // Fetch current month transactions
      const transactionsSnapshot = await getDocs(
        query(
          collection(db, 'profiles', currentProfile.id, 'transactions'),
          where('date', '>=', firstDay.toISOString().split('T')[0]),
          where('date', '<=', lastDay.toISOString().split('T')[0]),
          orderBy('date', 'desc')
        )
      );
      const transactions: any[] = [];
      transactionsSnapshot.forEach((doc) => {
        transactions.push({ id: doc.id, ...doc.data() });
      });

      const income = transactions
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + Number(t.amount || 0), 0);

      const expense = transactions
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + Number(t.amount || 0), 0);

      setMonthlyIncome(income);
      setMonthlyExpense(expense);

      const recent = transactions.slice(0, 5);
      setRecentTransactions(recent);

      // Fetch previous month transactions for insights
      const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const previousMonthLast = new Date(now.getFullYear(), now.getMonth(), 0);

      const previousTransactionsSnapshot = await getDocs(
        query(
          collection(db, 'profiles', currentProfile.id, 'transactions'),
          where('date', '>=', previousMonth.toISOString().split('T')[0]),
          where('date', '<=', previousMonthLast.toISOString().split('T')[0])
        )
      );
      const previousTransactions: any[] = [];
      previousTransactionsSnapshot.forEach((doc) => {
        previousTransactions.push({ id: doc.id, ...doc.data() });
      });

      // Fetch budgets
      const budgetsSnapshot = await getDocs(
        collection(db, 'profiles', currentProfile.id, 'budgets')
      );
      const budgets: any[] = [];
      budgetsSnapshot.forEach((doc) => {
        budgets.push({ id: doc.id, ...doc.data() });
      });

      const generatedInsights = generateInsights(
        transactions,
        budgets,
        previousTransactions
      );

      setInsights(generatedInsights);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = () => {
    loadDashboardData();
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={onRefresh} />
      }
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hello</Text>
          <Text style={styles.profileName}>{currentProfile?.name}</Text>
        </View>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => router.push('/transactions/add-expense')}
        >
          <Plus color={colors.card} size={24} />
        </TouchableOpacity>
      </View>

      <Card style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Total Balance</Text>
        <Text style={styles.balanceAmount}>{formatCurrency(balance)}</Text>
        <View style={styles.balanceDetails}>
          <View style={styles.balanceDetailItem}>
            <Text style={styles.balanceDetailLabel}>Income</Text>
            <Text style={[styles.balanceDetailAmount, styles.incomeText]}>
              {formatCurrency(monthlyIncome)}
            </Text>
          </View>
          <View style={styles.balanceDetailItem}>
            <Text style={styles.balanceDetailLabel}>Expenses</Text>
            <Text style={[styles.balanceDetailAmount, styles.expenseText]}>
              {formatCurrency(monthlyExpense)}
            </Text>
          </View>
        </View>
      </Card>

      {insights.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Insights</Text>
          {insights.slice(0, 2).map((insight) => (
            <InsightCard key={insight.id} insight={insight} />
          ))}
        </View>
      )}

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Transactions</Text>
          <TouchableOpacity onPress={() => router.push('/transactions')}>
            <Text style={styles.sectionLink}>View All</Text>
          </TouchableOpacity>
        </View>

        {recentTransactions.length === 0 ? (
          <Card>
            <Text style={styles.emptyText}>No transactions yet</Text>
            <Text style={styles.emptySubtext}>
              Start tracking your expenses and income
            </Text>
          </Card>
        ) : (
          recentTransactions.map((transaction) => (
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
          ))
        )}
      </View>
    </ScrollView>
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
    marginBottom: 24,
    backgroundColor: colors.textSecondary,
  },
  greeting: {
    fontSize: 16,
    color: colors.card,
  },
  profileName: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.card,
  },
  addButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceCard: {
    marginHorizontal: 24,
    marginBottom: 24,
  },
  balanceLabel: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  balanceAmount: {
    fontSize: 36,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 16,
  },
  balanceDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 16,
  },
  balanceDetailItem: {
    flex: 1,
  },
  balanceDetailLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  balanceDetailAmount: {
    fontSize: 18,
    fontWeight: '600',
  },
  incomeText: {
    color: colors.income,
  },
  expenseText: {
    color: colors.expense,
  },
  section: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
  },
  sectionLink: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});

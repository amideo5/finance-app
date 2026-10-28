import TransactionItem from '@/src/components/finance/TransactionItem';
import InsightCard from '@/src/components/insights/InsightCard';
import Card from '@/src/components/ui/Card';
import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { db } from '@/src/firebaseConfig';
import { generateInsights, Insight } from '@/src/services/ai/insightsEngine';
import { getUserSplits } from '@/src/services/firebase/splitService';
import { formatCurrency } from '@/src/utils/format';
import { getExcludedSourceAmountInPaise, getReportableTransactions } from '@/src/utils/splitReporting';
import { toLocalDateKey } from '@/src/utils/validation';
import { useRouter } from 'expo-router';
import {
  collection,
  getAggregateFromServer,
  getDocs,
  orderBy,
  query,
  sum,
  where,
} from 'firebase/firestore';
import { Plus, Sparkles, FileText } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function DashboardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { currentProfile } = useProfile();
  const [loading, setLoading] = useState(false);
  const [balance, setBalance] = useState(0);
  const [monthlyIncome, setMonthlyIncome] = useState(0);
  const [monthlyExpense, setMonthlyExpense] = useState(0);
  const [recentTransactions, setRecentTransactions] = useState<any[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const requestVersion = useRef(0);

  const loadDashboardData = useCallback(async () => {
    if (!currentProfile) return;
    const requestId = ++requestVersion.current;

    setLoading(true);

    try {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const transactionCollection = collection(db, 'profiles', currentProfile.id, 'transactions');
      const firstDayKey = toLocalDateKey(firstDay);
      const lastDayKey = toLocalDateKey(lastDay);
      const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const previousMonthLast = new Date(now.getFullYear(), now.getMonth(), 0);
      const previousStartKey = toLocalDateKey(previousMonth);
      const previousEndKey = toLocalDateKey(previousMonthLast);

      const [incomeTotalSnapshot, expenseTotalSnapshot, repaymentSnapshot, monthSnapshot, previousSnapshot, budgetsSnapshot, splits, bankSnapshot] = await Promise.all([
        getAggregateFromServer(query(transactionCollection, where('type', '==', 'income')), { total: sum('amount') }),
        getAggregateFromServer(query(transactionCollection, where('type', '==', 'expense')), { total: sum('amount') }),
        getDocs(query(transactionCollection, where('kind', '==', 'repayment'))),
        getDocs(query(
          transactionCollection,
          where('date', '>=', firstDayKey),
          where('date', '<=', lastDayKey),
          orderBy('date', 'desc')
        )),
        getDocs(query(
          transactionCollection,
          where('date', '>=', previousStartKey),
          where('date', '<=', previousEndKey)
        )),
        getDocs(collection(db, 'profiles', currentProfile.id, 'budgets')),
        getUserSplits(currentProfile.userId),
        getDocs(query(collection(db, 'profiles', currentProfile.id, 'accounts'))),
      ]);
      if (requestId !== requestVersion.current) return;

      const repayments = repaymentSnapshot.docs.map((transactionDoc) => transactionDoc.data());
      // console.log('Repayments:', repayments);
      const repaymentIncomePaise = repayments
        .filter((transaction) => transaction.type === 'income')
        .reduce((sum, transaction) => sum + (Number.isSafeInteger(transaction.amountInPaise)
          ? transaction.amountInPaise : Math.round(Number(transaction.amount || 0) * 100)), 0);
      // console.log('Repayment income (paise):', repaymentIncomePaise/100);
      const repaymentExpensePaise = repayments
        .filter((transaction) => transaction.type === 'expense')
        .reduce((sum, transaction) => sum + (Number.isSafeInteger(transaction.amountInPaise)
          ? transaction.amountInPaise : Math.round(Number(transaction.amount || 0) * 100)), 0);
      // console.log('Repayment expense (paise):', repaymentExpensePaise/100);
      const excludedSourcePaise = getExcludedSourceAmountInPaise(splits, currentProfile.id);
      // console.log('Excluded source (paise):', excludedSourcePaise / 100);
      // Repayments are transfers between accounts, not new income or spending.
      const incomeTotalPaise = Math.max(0, Math.round(Number(incomeTotalSnapshot.data().total || 0) * 100) 
      // + repaymentIncomePaise
    );
      const expenseTotalPaise = Math.max(0,
        Math.round(Number(expenseTotalSnapshot.data().total || 0) * 100)
        // + repaymentExpensePaise
        // - excludedSourcePaise
        ,
      );
      // console.log('Income total (paise):', incomeTotalPaise / 100);
      // console.log('Income snapshot :', incomeTotalSnapshot.data().total || 0);
      // console.log('Expense total (paise):', expenseTotalPaise / 100);
      // console.log('Balance (₹):', (incomeTotalPaise - expenseTotalPaise) / 100);
      
      const totalBalance = bankSnapshot.docs.reduce((sum, accountDoc) => {
        const accountData = accountDoc.data();
        const accountBalance = Number.isSafeInteger(accountData.balanceInPaise)
          ? accountData.balanceInPaise : Math.round(Number(accountData.balance || 0) * 100);
        return sum + accountBalance;
      }, 0) / 100;
      // console.log('Total balance from accounts (₹):', totalBalance);
      setBalance(totalBalance);

      const transactions = monthSnapshot.docs.map((transactionDoc) => ({
        id: transactionDoc.id,
        ...transactionDoc.data(),
      })) as any[];

      const reportableMonth = getReportableTransactions(transactions, splits, currentProfile.id);
      const income = reportableMonth
        .filter(t => t.type === 'income')
        .reduce((sum, t) => sum + Math.round(Number(t.amount || 0) * 100), 0) / 100;

      const expense = reportableMonth
        .filter(t => t.type === 'expense')
        .reduce((sum, t) => sum + Math.round(Number(t.amount || 0) * 100), 0) / 100;

      setMonthlyIncome(income);
      setMonthlyExpense(expense);

      const recent = transactions.slice(0, 5).map((transaction) => ({
        ...transaction,
        kind: transaction.kind || (splits.some((split) =>
          split.sourceProfileId === currentProfile.id && split.sourceTransactionId === transaction.id
        ) ? 'source' : undefined),
      }));
      setRecentTransactions(recent);

      const previousTransactions = previousSnapshot.docs.map((transactionDoc) => ({
        id: transactionDoc.id,
        ...transactionDoc.data(),
      })) as any[];
      const reportablePreviousMonth = getReportableTransactions(previousTransactions, splits, currentProfile.id);
      const budgets = budgetsSnapshot.docs.map((budgetDoc) => ({
        id: budgetDoc.id,
        ...budgetDoc.data(),
      })) as any[];

      const generatedInsights = generateInsights(
        reportableMonth,
        budgets,
        reportablePreviousMonth
      );

      setInsights(generatedInsights);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      if (requestId === requestVersion.current) setLoading(false);
    }
  }, [currentProfile]);

  useEffect(() => {
    if (currentProfile) {
      // Refresh dashboard values from Firestore for the active profile.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadDashboardData();
    } else {
      requestVersion.current += 1;
    }
  }, [currentProfile, loadDashboardData]);

  const onRefresh = () => {
    loadDashboardData();
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 16 }}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={onRefresh} />
      }
    >
      <LinearGradient colors={['#29265E', '#5146D8', '#7168F6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.header, { paddingTop: Math.max(insets.top + 8, 52) }]}>
        <View style={styles.headerCopy}>
          <View style={styles.greetingRow}><Sparkles color="#D9D5FF" size={15} /><Text style={styles.greeting}>YOUR MONEY SPACE</Text></View>
          <Text style={styles.profileName}>Hello, {currentProfile?.name?.split(' ')[0] || 'there'}</Text>
          <Text style={styles.headerSubtitle}>A little more clarity, every day.</Text>
        </View>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => router.push('/transactions/add-expense')}
          accessibilityLabel="Add transaction"
        >
          <Plus color={colors.primary} size={23} />
        </TouchableOpacity>
      </LinearGradient>

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
          <View><Text style={styles.sectionTitle}>Recent Transactions</Text><Text style={styles.sectionSubtitle}>Your latest money moves</Text></View>
          <View style={styles.sectionActions}>
            {/* <TouchableOpacity style={styles.statementLink} onPress={() => router.push('/statement')}>
              <FileText size={14} color={colors.primary} />
              <Text style={styles.sectionLink}>Statement</Text>
            </TouchableOpacity> */}
            <TouchableOpacity onPress={() => router.push('/transactions')}>
              <Text style={styles.sectionLink}>View all</Text>
            </TouchableOpacity>
          </View>
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
              kind={transaction.kind}
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
    paddingHorizontal: 23,
    paddingTop: 52,
    paddingBottom: 28,
    marginBottom: 22,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  headerCopy: { flex: 1 },
  greetingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 9 },
  greeting: { fontSize: 10, letterSpacing: 1.5, color: '#D9D5FF', fontWeight: '800' },
  profileName: { fontSize: 25, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 11, color: '#DDD9FF', marginTop: 5 },
  addButton: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },
  balanceCard: {
    marginHorizontal: 18,
    marginBottom: 26,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
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
  sectionSubtitle: { color: colors.textSecondary, fontSize: 11, marginTop: 4 },
  sectionActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statementLink: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 8, backgroundColor: '#ECEBFF', borderRadius: 11 },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
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

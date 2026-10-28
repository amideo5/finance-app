import TransactionFilterSheet from '@/src/components/finance/TransactionFilterSheet';
import TransactionItem from '@/src/components/finance/TransactionItem';
import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { db } from '@/src/firebaseConfig';
import { getUserSplits } from '@/src/services/firebase/splitService';
import { useRouter } from 'expo-router';
import { ArrowLeftRight, FileText, SlidersHorizontal } from 'lucide-react-native';
import {
    collection,
    getDocs,
    limit,
    orderBy,
    query,
    startAfter,
    where,
    type DocumentData,
    type QueryConstraint,
    type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const PAGE_SIZE = 30;

export default function TransactionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { currentProfile } = useProfile();

  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const pagination = useRef({
    hasMore: true,
    loadingMore: false,
    lastDocument: null as QueryDocumentSnapshot<DocumentData> | null,
  });
  const requestVersion = useRef(0);

  // 🔥 Filter state
  const [filterVisible, setFilterVisible] = useState(false);
  const [filters, setFilters] = useState<{
    type?: 'all' | 'income' | 'expense';
    categories?: string[];
    startDate?: string | null;
    endDate?: string | null;
  }>({});

  const loadTransactions = useCallback(async (reset = true) => {
    if (!currentProfile) return;
    const requestId = reset ? ++requestVersion.current : requestVersion.current;
    if (reset) {
      setLoading(true);
      pagination.current.loadingMore = false;
      setLoadingMore(false);
      pagination.current.hasMore = true;
      pagination.current.lastDocument = null;
    } else {
      if (pagination.current.loadingMore || !pagination.current.hasMore || !pagination.current.lastDocument) return;
      pagination.current.loadingMore = true;
      setLoadingMore(true);
    }

    try {
      const constraints: QueryConstraint[] = [];
      if (filters.type && filters.type !== 'all') {
        constraints.push(where('type', '==', filters.type));
      }
      if (filters.categories?.length) {
        constraints.push(where('category', 'in', filters.categories));
      }
      if (filters.startDate) constraints.push(where('date', '>=', filters.startDate));
      if (filters.endDate) constraints.push(where('date', '<=', filters.endDate));
      constraints.push(orderBy('date', 'desc'), limit(PAGE_SIZE));
      if (!reset && pagination.current.lastDocument) constraints.push(startAfter(pagination.current.lastDocument));

      const snapshot = await getDocs(query(
        collection(db, 'profiles', currentProfile.id, 'transactions'),
        ...constraints
      ));
      const linkedSplits = await getUserSplits(currentProfile.userId);
      if (requestId !== requestVersion.current) return;
      const page = snapshot.docs.map((transactionDoc) => {
        const transaction = { id: transactionDoc.id, ...transactionDoc.data() } as any;
        const isSplitSource = linkedSplits.some((split) => split.sourceProfileId === currentProfile.id && split.sourceTransactionId === transaction.id);
        return { ...transaction, kind: transaction.kind || (isSplitSource ? 'source' : undefined) };
      });
      setTransactions((existing) => reset ? page : [...existing, ...page]);
      pagination.current.lastDocument = snapshot.docs[snapshot.docs.length - 1] ?? null;
      pagination.current.hasMore = snapshot.docs.length === PAGE_SIZE;
    } catch (error) {
      console.error('Error loading transactions:', error);
    } finally {
      if (requestId === requestVersion.current) {
        setLoading(false);
        setLoadingMore(false);
        pagination.current.loadingMore = false;
      }
    }
  }, [currentProfile, filters]);

  useEffect(() => {
    pagination.current = { hasMore: true, loadingMore: false, lastDocument: null };
    // The query result is external data and is applied after the Firestore request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTransactions(true);
  }, [loadTransactions]);

  const activeFilterLabels: string[] = [];
  if (filters.type && filters.type !== 'all') {
    activeFilterLabels.push(filters.type === 'income' ? 'Income' : 'Expense');
  }
  if (filters.categories?.length) {
    activeFilterLabels.push(filters.categories.length === 1
      ? filters.categories[0]
      : `${filters.categories.length} categories`);
  }
  if (filters.startDate || filters.endDate) {
    activeFilterLabels.push(`${filters.startDate || 'Any date'} – ${filters.endDate || 'Today'}`);
  }
  const activeFilterCount = activeFilterLabels.length;

  return (
    <View style={styles.container}>
      {/* HEADER */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top + 8, 28) }]}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>YOUR ACTIVITY</Text>
          <Text style={styles.title}>Transactions</Text>
          <Text style={styles.subtitle}>Every move, all in one place.</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.iconAction} onPress={() => router.push('/statement')} accessibilityLabel="Generate statement">
            <FileText size={18} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconAction} onPress={() => router.push('/transactions/self-transfer')} accessibilityLabel="Transfer">
            <ArrowLeftRight size={18} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterAction, activeFilterCount > 0 && styles.filterActionActive]}
            onPress={() => setFilterVisible(true)}
            accessibilityLabel={activeFilterCount > 0 ? `Filter transactions, ${activeFilterCount} filter groups active` : 'Filter transactions'}
          >
            <SlidersHorizontal size={16} color="#FFFFFF" />
            <Text style={styles.filterActionText}>Filter</Text>
            {activeFilterCount > 0 ? (
              <View style={styles.filterBadge}><Text style={styles.filterBadgeText}>{activeFilterCount}</Text></View>
            ) : null}
          </TouchableOpacity>
        </View>
      </View>

      {/* ACTIVE FILTER SUMMARY */}
      {activeFilterCount > 0 ? (
        <View style={styles.activeFilters}>
          <View style={styles.activeFiltersHeading}>
            <Text style={styles.activeFiltersTitle}>ACTIVE FILTERS</Text>
            <Text style={styles.activeFiltersCount}>{activeFilterCount} applied</Text>
          </View>
          <View style={styles.activeChipRow}>
            {activeFilterLabels.map((label) => (
              <View key={label} style={styles.activeChip}>
                <Text numberOfLines={1} style={styles.activeChipText}>{label}</Text>
              </View>
            ))}
            <TouchableOpacity onPress={() => setFilterVisible(true)} style={styles.editFiltersButton}>
              <Text style={styles.editFiltersText}>Edit</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* LIST */}
      <FlatList
        style={styles.list}
        data={transactions}
        keyExtractor={(transaction) => transaction.id}
        refreshing={loading}
        onRefresh={() => void loadTransactions(true)}
        onEndReached={() => void loadTransactions(false)}
        onEndReachedThreshold={0.5}
        renderItem={({ item: transaction }) => (
          <TransactionItem
            type={transaction.type}
            kind={transaction.kind}
            category={
              transaction.kind === 'self-transfer'
                ? transaction.title || 'Transfer'
                : transaction.category || 'Unknown'
            }
            amount={transaction.amount}
            date={transaction.date}
            notes={transaction.notes}
            icon={transaction.categoryIcon}
            onPress={() => router.push(`/transactions/${transaction.id}`)}
          />
        )}
        ListEmptyComponent={loading ? null : <Text style={styles.empty}>No transactions found</Text>}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} /> : null}
        contentContainerStyle={[transactions.length === 0 ? styles.emptyList : undefined, { paddingBottom: Math.max(insets.bottom, 16) + 20 }]}
      />

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
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 18,
    gap: 10,
  },
  headerCopy: { flex: 1 },
  eyebrow: { fontSize: 10, letterSpacing: 1.5, color: colors.primary, fontWeight: '800', marginBottom: 5 },
  title: { fontSize: 27, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 11, color: colors.textSecondary, marginTop: 4 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  iconAction: { width: 37, height: 37, borderRadius: 13, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  filterAction: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary, paddingVertical: 10, paddingHorizontal: 11, borderRadius: 13, minHeight: 38 },
  filterActionActive: { backgroundColor: colors.primaryDark },
  filterActionText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  filterBadge: { minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 99, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  filterBadgeText: { color: colors.primary, fontSize: 10, fontWeight: '900' },
  activeFilters: {
    marginHorizontal: 18,
    marginTop: -3,
    marginBottom: 11,
    padding: 11,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#E1DFFF',
    backgroundColor: '#F0EFFF',
  },
  activeFiltersHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 },
  activeFiltersTitle: { color: colors.primaryDark, fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  activeFiltersCount: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
  activeChipRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  activeChip: { maxWidth: '100%', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E1DFFF', borderRadius: 99, paddingHorizontal: 9, paddingVertical: 5 },
  activeChipText: { color: colors.primaryDark, fontSize: 10, fontWeight: '700' },
  editFiltersButton: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 99, backgroundColor: colors.primary },
  editFiltersText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  list: {
    flex: 1,
    paddingHorizontal: 18,
  },
  emptyList: {
    flexGrow: 1,
  },
  empty: {
    textAlign: 'center',
    marginTop: 40,
    color: colors.textSecondary,
  },
});
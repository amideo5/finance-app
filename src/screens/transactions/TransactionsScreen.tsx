import TransactionFilterSheet from '@/src/components/finance/TransactionFilterSheet';
import TransactionItem from '@/src/components/finance/TransactionItem';
import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { db } from '@/src/firebaseConfig';
import { getUserSplits } from '@/src/services/firebase/splitService';
import { useRouter } from 'expo-router';
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

const PAGE_SIZE = 30;

export default function TransactionsScreen() {
  const router = useRouter();
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
      {((filters.type && filters.type !== 'all') ||
        filters.categories?.length ||
        filters.startDate ||
        filters.endDate) && (
        <View style={styles.activeFilters}>
          <Text style={styles.activeText}>
            Filters applied
          </Text>
        </View>
      )}

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
            category={transaction.category || 'Unknown'}
            amount={transaction.amount}
            date={transaction.date}
            notes={transaction.notes}
            icon={transaction.categoryIcon}
            onPress={() => router.push(`/transactions/${transaction.id}`)}
          />
        )}
        ListEmptyComponent={loading ? null : <Text style={styles.empty}>No transactions found</Text>}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} /> : null}
        contentContainerStyle={transactions.length === 0 ? styles.emptyList : undefined}
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
  emptyList: {
    flexGrow: 1,
  },
  empty: {
    textAlign: 'center',
    marginTop: 40,
    color: colors.textSecondary,
  },
});
import { colors } from '@/src/constants/colors';
import { db } from '@/src/firebaseConfig';
import { useProfile } from '@/src/context/ProfileContext';
import { getUserSplits } from '@/src/services/firebase/splitService';
import { getUserFriends } from '@/src/services/firebase/friendsService';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/src/constants/categories';
import { formatCurrency, formatShortDate } from '@/src/utils/format';
import { toLocalDateKey } from '@/src/utils/validation';
import type { SharedExpenseSplit } from '@/types/finance';
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
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  Search,
  Wallet,
  X,
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const PAGE_SIZE = 500;
type TransactionKindFilter = 'all' | 'split' | 'regular' | 'source' | 'allocation' | 'repayment' | 'transfer';
type TransactionTypeFilter = 'all' | 'income' | 'expense';
type SortMode = 'newest' | 'oldest' | 'amountHigh' | 'amountLow';

type StatementTransaction = Record<string, any> & {
  id: string;
  date: string;
  category?: string;
  amount?: number;
  amountInPaise?: number;
  type?: string;
  kind?: string;
  paymentMode?: string;
  accountId?: string | null;
  notes?: string | null;
  splitId?: string;
};

const PAYMENT_MODES = [
  { label: 'All', value: 'all' },
  { label: 'Cash', value: 'cash' },
  { label: 'UPI', value: 'upi' },
  { label: 'Card', value: 'card' },
  { label: 'Bank', value: 'bank' },
  { label: 'Wallet', value: 'wallet' },
];

const KIND_FILTERS: { label: string; value: TransactionKindFilter }[] = [
  { label: 'Everything', value: 'all' },
  { label: 'Split-related', value: 'split' },
  { label: 'Regular', value: 'regular' },
  { label: 'Shared source', value: 'source' },
  { label: 'Allocations', value: 'allocation' },
  { label: 'Repayments', value: 'repayment' },
  { label: 'Transfers', value: 'transfer' },
];

function amountOf(transaction: StatementTransaction): number {
  if (Number.isSafeInteger(transaction.amountInPaise)) return Number(transaction.amountInPaise) / 100;
  return Number(transaction.amount || 0);
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  // Prevent spreadsheet formula injection from user-entered notes or names.
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

function htmlEscape(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function dateLabel(startDate: string | null, endDate: string | null): string {
  if (!startDate && !endDate) return 'All time';
  if (startDate && endDate) return `${startDate}  →  ${endDate}`;
  if (startDate) return `From ${startDate}`;
  return `Until ${endDate}`;
}

function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function StatementScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { currentProfile } = useProfile();
  const [transactions, setTransactions] = useState<StatementTransaction[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [splits, setSplits] = useState<SharedExpenseSplit[]>([]);
  const [friends, setFriends] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const requestVersion = useRef(0);

  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [draftStartDate, setDraftStartDate] = useState<string | null>(null);
  const [draftEndDate, setDraftEndDate] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<TransactionTypeFilter>('all');
  const [paymentMode, setPaymentMode] = useState('all');
  const [kindFilter, setKindFilter] = useState<TransactionKindFilter>('all');
  const [categoryFilters, setCategoryFilters] = useState<string[]>([]);
  const [accountFilter, setAccountFilter] = useState('all');
  const [counterpartyFilter, setCounterpartyFilter] = useState('all');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [searchText, setSearchText] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [filtersExpanded, setFiltersExpanded] = useState(true);

  const sourceSplitByTransaction = useMemo(() => {
    const map = new Map<string, SharedExpenseSplit>();
    splits.forEach((split) => {
      if (split.sourceProfileId === currentProfile?.id) map.set(split.sourceTransactionId, split);
    });
    return map;
  }, [splits, currentProfile?.id]);

  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const splitById = useMemo(() => new Map(splits.map((split) => [split.id, split])), [splits]);
  const splitsByTransactionId = useMemo(() => {
    const byTransactionId = new Map<string, SharedExpenseSplit[]>();
    const add = (transactionId: string | undefined | null, split: SharedExpenseSplit) => {
      if (!transactionId) return;
      const id = String(transactionId);
      const existing = byTransactionId.get(id) || [];
      if (!existing.some((item) => item.id === split.id)) existing.push(split);
      byTransactionId.set(id, existing);
    };

    splits.forEach((split) => {
      if (split.sourceProfileId === currentProfile?.id) add(split.sourceTransactionId, split);
      Object.values(split.allocationTransactionIds || {}).forEach((transactionId) => add(transactionId, split));
      transactions.forEach((transaction) => {
        if (String(transaction.splitId || '') === split.id) add(transaction.id, split);
        if (transaction.sourceTransactionId && String(transaction.sourceTransactionId) === split.sourceTransactionId) {
          add(transaction.id, split);
        }
      });
    });
    return byTransactionId;
  }, [splits, transactions, currentProfile?.id]);
  const counterpartyNames = useMemo(() => {
    const names = new Map<string, string>();

    // Keep useful names from split participants and historical transaction rows.
    splits.forEach((split) => split.participants.forEach((participant) => {
      if (participant.userId && participant.displayName?.trim()) {
        names.set(participant.userId, participant.displayName.trim());
      }
    }));
    transactions.forEach((transaction) => {
      const id = String(transaction.counterpartyUserId || '');
      const name = String(transaction.counterpartyName || '').trim();
      if (id && name && !names.has(id)) names.set(id, name);
    });

    // Add every friend, including friends who have never appeared in a transaction.
    friends.forEach((friend, index) => {
      const id = String(friend.friendId || friend.userId || '');
      if (!id) return;
      const profileName = String(
        friend.profileData?.name || friend.profileData?.displayName || friend.name || '',
      ).trim();
      const existingName = names.get(id)?.trim();
      names.set(id, profileName || existingName || `Friend ${index + 1}`);
    });

    return names;
  }, [splits, transactions, friends]);

  const counterpartyOptions = useMemo(() => (
    [...counterpartyNames.entries()]
      // Includes all friends, everyone in a known split, and historic counterparties.
      .filter(([id]) => Boolean(id))
      .sort((a, b) => a[1].localeCompare(b[1]))
  ), [counterpartyNames]);
    const loadStatement = useCallback(async (isRefresh = false) => {
    if (!currentProfile) {
      requestVersion.current += 1;
      setTransactions([]);
      setAccounts([]);
      setSplits([]);
      setFriends([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const requestId = ++requestVersion.current;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setLoadError(false);

    try {
      const transactionCollection = collection(db, 'profiles', currentProfile.id, 'transactions');
      const [accountsSnapshot, userSplits, transactionRows, friendRows] = await Promise.all([
        getDocs(collection(db, 'profiles', currentProfile.id, 'accounts')),
        getUserSplits(currentProfile.userId),
        (async () => {
          const allRows: StatementTransaction[] = [];
          let lastDocument: QueryDocumentSnapshot<DocumentData> | null = null;
          while (true) {
            const constraints: QueryConstraint[] = [];
            if (startDate) constraints.push(where('date', '>=', startDate));
            if (endDate) constraints.push(where('date', '<=', endDate));
            constraints.push(orderBy('date', 'desc'), limit(PAGE_SIZE));
            if (lastDocument) constraints.push(startAfter(lastDocument));

            const page = await getDocs(query(transactionCollection, ...constraints));
            allRows.push(...page.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() } as StatementTransaction)));
            if (page.docs.length < PAGE_SIZE) break;
            lastDocument = page.docs[page.docs.length - 1] ?? null;
            if (!lastDocument) break;
          }
          return allRows;
        })(),
        // Friend lookup should not prevent a statement from loading if friend metadata is unavailable.
        getUserFriends(currentProfile.userId).catch((error) => {
          console.warn('Unable to load friends for statement counterparty filter:', error);
          return [];
        }),
      ]);
      if (requestId !== requestVersion.current) return;

      const sourceMap = new Map<string, SharedExpenseSplit>();
      const allocationSplitByTransactionId = new Map<string, SharedExpenseSplit>();
      userSplits.forEach((split) => {
        // Link the original expense to its split even if the transaction itself
        // doesn't persist a splitId field.
        if (split.sourceProfileId === currentProfile.id) sourceMap.set(split.sourceTransactionId, split);
        // Allocation transaction IDs are stored by participant user ID on the split.
        Object.values(split.allocationTransactionIds || {}).forEach((transactionId) => {
          if (transactionId) allocationSplitByTransactionId.set(String(transactionId), split);
        });
      });
      const normalized = transactionRows.map((transaction) => {
        const splitFromId = transaction.splitId
          ? userSplits.find((split) => split.id === transaction.splitId)
          : undefined;
        const relatedSplit = splitFromId
          || sourceMap.get(transaction.id)
          || allocationSplitByTransactionId.get(transaction.id)
          || (transaction.sourceTransactionId
            ? userSplits.find((split) => split.sourceTransactionId === transaction.sourceTransactionId)
            : undefined);
        return {
          ...transaction,
          kind: transaction.kind || (sourceMap.has(transaction.id) ? 'source' : undefined),
          splitId: relatedSplit?.id || transaction.splitId,
        };
      });
      setTransactions(normalized);
      setAccounts(accountsSnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
      setSplits(userSplits);
      setFriends(friendRows);
    } catch (error) {
      console.error('Unable to generate statement:', error);
      if (requestId === requestVersion.current) {
        setLoadError(true);
        Alert.alert('Statement unavailable', 'Could not load your transactions. Please check your connection and try again.');
      }
    } finally {
      if (requestId === requestVersion.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [currentProfile, startDate, endDate]);

  useEffect(() => {
    // Loading is asynchronous; the callback manages its own loading state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStatement();
  }, [loadStatement]);

  const categoryOptions = useMemo(() => {
    const fromRows = transactions.map((transaction) => String(transaction.category || 'Other')).filter(Boolean);
    const fromConstants = [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES].map((category) => category.name);
    return [...new Set([...fromRows, ...fromConstants])].sort((a, b) => a.localeCompare(b));
  }, [transactions]);

  const visibleTransactions = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    const min = minAmount.trim() === '' ? null : Number(minAmount);
    const max = maxAmount.trim() === '' ? null : Number(maxAmount);
    const filtered = transactions.filter((transaction) => {
      const amount = amountOf(transaction);
      const kind = transaction.kind || '';
      const splitId = transaction.splitId || '';
      const account = transaction.accountId ? accountById.get(transaction.accountId) : null;
      const split = splitId ? splitById.get(splitId) : null;
      const payment = String(transaction.paymentMode || '').toLowerCase();
      const isSplit = Boolean(splitId || ['source', 'allocation', 'repayment'].includes(kind));

      if (typeFilter !== 'all' && transaction.type !== typeFilter) return false;
      if (paymentMode !== 'all' && payment !== paymentMode) return false;
      if (categoryFilters.length && !categoryFilters.includes(String(transaction.category || 'Other'))) return false;
      if (accountFilter !== 'all' && String(transaction.accountId || 'none') !== accountFilter) return false;
      if (counterpartyFilter !== 'all') {
        const relatedSplits = splitsByTransactionId.get(transaction.id)
          || (splitId && splitById.has(splitId) ? [splitById.get(splitId)!] : []);
        const directCounterparty = String(transaction.counterpartyUserId || '') === counterpartyFilter;
        const splitParticipant = relatedSplits.some((relatedSplit) => (
          relatedSplit.participantIds?.includes(counterpartyFilter)
          || relatedSplit.participants?.some((participant) => String(participant.userId) === counterpartyFilter)
        ));
        const splitObligation = relatedSplits.some((relatedSplit) => relatedSplit.obligations?.some((obligation) => (
          String(obligation.fromUserId) === counterpartyFilter || String(obligation.toUserId) === counterpartyFilter
        )));
        if (!directCounterparty && !splitParticipant && !splitObligation) return false;
      }
      if (kindFilter === 'split' && !isSplit) return false;
      if (kindFilter === 'regular' && isSplit) return false;
      if (kindFilter === 'transfer' && !['self-transfer', 'investment-transfer'].includes(kind)) return false;
      if (kindFilter !== 'all' && kindFilter !== 'split' && kindFilter !== 'regular' && kindFilter !== 'transfer' && kind !== kindFilter) return false;
      if (min !== null && Number.isFinite(min) && amount < min) return false;
      if (max !== null && Number.isFinite(max) && amount > max) return false;
      if (keyword) {
        const haystack = [
          transaction.category,
          transaction.title,
          transaction.notes,
          transaction.paymentMode,
          transaction.type,
          account?.name,
          split?.title,
          transaction.counterpartyName,
          transaction.counterpartyUserId,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(keyword)) return false;
      }
      return true;
    });
    return filtered.sort((a, b) => {
      if (sortMode === 'oldest') return String(a.date || '').localeCompare(String(b.date || ''));
      if (sortMode === 'amountHigh') return amountOf(b) - amountOf(a);
      if (sortMode === 'amountLow') return amountOf(a) - amountOf(b);
      return String(b.date || '').localeCompare(String(a.date || ''));
    });
  }, [transactions, typeFilter, paymentMode, categoryFilters, accountFilter, counterpartyFilter, kindFilter, searchText, minAmount, maxAmount, accountById, splitById, sortMode, sourceSplitByTransaction, splitsByTransactionId]);

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    visibleTransactions.forEach((transaction) => {
      if (transaction.kind === 'investment-transfer' || transaction.investmentTransferId) return;
      const amount = amountOf(transaction);
      if (transaction.type === 'income') income += amount;
      else if (transaction.type === 'expense') expense += amount;
    });
    return { income, expense, net: income - expense };
  }, [visibleTransactions]);

  const activeFilterCount = [
    typeFilter !== 'all', paymentMode !== 'all', kindFilter !== 'all', categoryFilters.length > 0,
    accountFilter !== 'all', counterpartyFilter !== 'all', searchText.trim() !== '', minAmount !== '', maxAmount !== '', startDate !== null, endDate !== null,
  ].filter(Boolean).length;

  const setPreset = (preset: '7d' | '30d' | '90d' | 'month' | 'year' | 'all') => {
    if (preset === 'all') {
      setStartDate(null);
      setEndDate(null);
      return;
    }
    const today = new Date();
    const start = new Date(today);
    if (preset === '7d') start.setDate(today.getDate() - 6);
    if (preset === '30d') start.setDate(today.getDate() - 29);
    if (preset === '90d') start.setDate(today.getDate() - 89);
    if (preset === 'month') start.setDate(1);
    if (preset === 'year') start.setMonth(0, 1);
    setStartDate(toLocalDateKey(start));
    setEndDate(toLocalDateKey(today));
  };

  const toggleCategory = (category: string) => {
    setCategoryFilters((previous) => previous.includes(category)
      ? previous.filter((item) => item !== category)
      : [...previous, category]);
  };

  const clearFilters = () => {
    setStartDate(null);
    setEndDate(null);
    setTypeFilter('all');
    setPaymentMode('all');
    setKindFilter('all');
    setCategoryFilters([]);
    setAccountFilter('all');
    setCounterpartyFilter('all');
    setSortMode('newest');
    setSearchText('');
    setMinAmount('');
    setMaxAmount('');
  };
    const markedDates = useMemo(() => {
    if (!draftStartDate && !draftEndDate) return {};
    const marked: Record<string, any> = {};
    if (draftStartDate && draftEndDate) {
      const cursor = new Date(`${draftStartDate}T12:00:00`);
      const end = new Date(`${draftEndDate}T12:00:00`);
      while (cursor <= end) {
        const key = toLocalDateKey(cursor);
        marked[key] = { color: colors.primary, textColor: '#FFFFFF' };
        cursor.setDate(cursor.getDate() + 1);
      }
      marked[draftStartDate] = { startingDay: true, color: colors.primary, textColor: '#FFFFFF' };
      marked[draftEndDate] = { endingDay: true, color: colors.primary, textColor: '#FFFFFF' };
    } else if (draftStartDate) {
      marked[draftStartDate] = { startingDay: true, endingDay: true, color: colors.primary, textColor: '#FFFFFF' };
    } else if (draftEndDate) {
      marked[draftEndDate] = { startingDay: true, endingDay: true, color: colors.primary, textColor: '#FFFFFF' };
    }
    return marked;
  }, [draftStartDate, draftEndDate]);

  const selectCalendarDay = (day: { dateString: string }) => {
    if (!draftStartDate || (draftStartDate && draftEndDate)) {
      setDraftStartDate(day.dateString);
      setDraftEndDate(null);
    } else if (day.dateString < draftStartDate) {
      setDraftStartDate(day.dateString);
    } else {
      setDraftEndDate(day.dateString);
    }
  };

  const exportStatement = async () => {
    const rows = [
      ['Date', 'Type', 'Category', 'Amount', 'Currency', 'Payment mode', 'Account', 'Split treatment', 'Split', 'Notes'],
      ...visibleTransactions.map((transaction) => {
        const split = transaction.splitId ? splitById.get(transaction.splitId) : null;
        const account = transaction.accountId ? accountById.get(transaction.accountId) : null;
        return [
          transaction.date || '',
          transaction.type || '',
          transaction.kind === 'self-transfer' ? transaction.title || 'Transfer' : transaction.category || 'Other',
          amountOf(transaction).toFixed(2),
          currentProfile?.currency || 'INR',
          transaction.paymentMode || '',
          account?.name || '',
          transaction.kind || 'regular',
          split?.title || '',
          transaction.notes || '',
        ];
      }),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    const filename = `statement-${toLocalDateKey(new Date())}.csv`;

    try {
      if (Platform.OS === 'web') {
        const environment = globalThis as any;
        const blob = new environment.Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
        const url = environment.URL.createObjectURL(blob);
        const link = environment.document.createElement('a');
        link.href = url;
        link.download = filename;
        environment.document.body.appendChild(link);
        link.click();
        environment.document.body.removeChild(link);
        setTimeout(() => environment.URL.revokeObjectURL(url), 1000);
      } else {
        await Share.share({ title: 'Finance statement CSV', message: csv });
      }
    } catch (error) {
      console.error('Statement export failed:', error);
      Alert.alert('Export failed', 'Your statement could not be exported. Please try again.');
    }
  };

  const exportPdfStatement = async () => {
    if (visibleTransactions.length === 0) return;

    const currency = currentProfile?.currency || 'INR';
    const formattedGeneratedAt = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    const filters = [
      `Period: ${dateLabel(startDate, endDate)}`,
      `Sort: ${sortMode === 'newest' ? 'Newest first' : sortMode === 'oldest' ? 'Oldest first' : sortMode === 'amountHigh' ? 'Largest amount first' : 'Smallest amount first'}`,
      `Type: ${typeFilter === 'all' ? 'All types' : typeFilter}`,
      `Payment method: ${paymentMode === 'all' ? 'All methods' : paymentMode.toUpperCase()}`,
      `Category: ${categoryFilters.length ? categoryFilters.join(', ') : 'All categories'}`,
      `Split treatment: ${kindFilter}`,
      searchText.trim() ? `Search: ${searchText.trim()}` : '',
      accountFilter !== 'all' ? `Account: ${accounts.find((account) => account.id === accountFilter)?.name || accountFilter}` : '',
      counterpartyFilter !== 'all' ? `Person / counterparty: ${counterpartyNames.get(counterpartyFilter) || 'Selected friend'}` : '',
      minAmount.trim() ? `Min amount: ${minAmount}` : '',
      maxAmount.trim() ? `Max amount: ${maxAmount}` : '',
    ].filter(Boolean);

    const tableRows = visibleTransactions.map((transaction) => {
      const split = transaction.splitId ? splitById.get(transaction.splitId) : sourceSplitByTransaction.get(transaction.id);
      const account = transaction.accountId ? accountById.get(transaction.accountId) : null;
      const title = transaction.kind === 'self-transfer' ? transaction.title || 'Transfer' : transaction.category || 'Uncategorized';
      const amount = amountOf(transaction);
      const isInternalTransfer = transaction.kind === 'self-transfer' || transaction.kind === 'repayment' || transaction.kind === 'source' || transaction.kind === 'investment-transfer' || Boolean(transaction.investmentTransferId);
      const amountLabel = `${isInternalTransfer ? '↔ ' : transaction.type === 'income' ? '+' : '−'}${formatCurrency(amount, currency)}`;
      return `<tr>
        <td>${htmlEscape(transaction.date || '')}</td><td>${htmlEscape(title)}</td>
        <td>${htmlEscape(transaction.type || '')}</td><td>${htmlEscape(transaction.paymentMode || '—')}</td>
        <td>${htmlEscape(account?.name || '—')}</td><td>${htmlEscape(transaction.kind || 'regular')}</td>
        <td>${htmlEscape(split?.title || '—')}</td><td class="amount">${htmlEscape(amountLabel)}</td>
        <td>${htmlEscape(transaction.notes || '')}</td>
      </tr>`;
    }).join('');

    const html = `<!doctype html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" /><title>Finance statement</title>
<style>
  @page { size: A4 landscape; margin: 13mm; } * { box-sizing: border-box; }
  body { color: #171A35; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; font-size: 9px; margin: 0; }
  .brand { color: #6157E8; font-size: 8px; font-weight: 800; letter-spacing: 1.6px; text-transform: uppercase; }
  h1 { font-size: 26px; margin: 6px 0 4px; letter-spacing: -.6px; } .subtitle { color: #747891; font-size: 10px; }
  .topline { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
  .generated { color: #747891; font-size: 9px; text-align: right; }
  .summary { background: #F2F1FF; border: 1px solid #E1DFFF; border-radius: 12px; padding: 13px 16px; display: flex; gap: 22px; margin-bottom: 12px; }
  .metric { flex: 1; } .metric span { display: block; color: #747891; font-size: 8px; margin-bottom: 6px; text-transform: uppercase; letter-spacing: .8px; }
  .metric strong { display: block; font-size: 16px; color: #171A35; } .metric strong.income { color: #16875B; } .metric strong.expense { color: #D84A5B; }
  .filters { margin: 0 0 14px; padding: 8px 10px; background: #F8F8FC; border-radius: 8px; color: #545872; line-height: 1.6; }
  .filters strong { color: #171A35; } table { width: 100%; border-collapse: collapse; font-size: 8px; table-layout: fixed; }
  thead { display: table-header-group; } tr { page-break-inside: avoid; }
  th { text-align: left; background: #6157E8; color: #fff; padding: 8px 6px; font-size: 7px; letter-spacing: .4px; text-transform: uppercase; }
  td { border-bottom: 1px solid #E6E8F2; padding: 7px 6px; vertical-align: top; overflow-wrap: anywhere; }
  tbody tr:nth-child(even) { background: #FAFAFD; } .amount { text-align: right; font-weight: 700; white-space: nowrap; }
  .foot { margin-top: 13px; padding-top: 8px; border-top: 1px solid #E6E8F2; font-size: 8px; color: #747891; display: flex; justify-content: space-between; }
</style></head><body>
  <div class="topline"><div><div class="brand">Personal finance</div><h1>Statement</h1><div class="subtitle">A filtered record of your transactions</div></div><div class="generated">Generated<br/><strong>${htmlEscape(formattedGeneratedAt)}</strong><br/>${visibleTransactions.length} matching entries</div></div>
  <div class="summary"><div class="metric"><span>Net total</span><strong>${htmlEscape(formatCurrency(totals.net, currency))}</strong></div>
    <div class="metric"><span>Money in</span><strong class="income">${htmlEscape(formatCurrency(totals.income, currency))}</strong></div>
    <div class="metric"><span>Money out</span><strong class="expense">${htmlEscape(formatCurrency(totals.expense, currency))}</strong></div>
    <div class="metric"><span>Transactions</span><strong>${visibleTransactions.length}</strong></div></div>
  <div class="filters"><strong>Applied filters</strong><br/>${filters.map((filter) => htmlEscape(filter)).join(' &nbsp; · &nbsp; ')}</div>
  <table><thead><tr><th style="width:8%">Date</th><th style="width:17%">Transaction</th><th style="width:7%">Type</th><th style="width:8%">Payment</th><th style="width:10%">Account</th><th style="width:11%">Treatment</th><th style="width:12%">Split</th><th style="width:12%;text-align:right">Amount</th><th style="width:15%">Notes</th></tr></thead><tbody>${tableRows}</tbody></table>
  <div class="foot"><span>Generated from your Finance App. This report reflects the filters shown above.</span><span>${htmlEscape(currency)} · ${visibleTransactions.length} entries</span></div>
</body></html>`;

    try {
      if (Platform.OS === 'web') {
        // Print a statement-specific document, instead of printing the app screen.
        // The browser's print dialog lets the user choose “Save as PDF”.
        const environment = globalThis as any;
        const printWindow = environment.window?.open('', '_blank');
        if (!printWindow) {
          environment.window?.alert?.('Your browser blocked the statement preview. Allow pop-ups for this app and try again.');
          return;
        }
        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();
        environment.setTimeout(() => {
          printWindow.focus();
          printWindow.print();
        }, 300);
        return;
      }
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Share finance statement PDF' });
      } else {
        await Print.printAsync({ html });
        Alert.alert('PDF prepared', 'The system share sheet is unavailable, so the print dialog has been opened instead.');
      }
    } catch (error) {
      console.error('Statement PDF export failed:', error);
      Alert.alert('PDF export failed', 'Your statement PDF could not be generated. Please try again.');
    }
  };
    const renderTransaction = ({ item }: { item: StatementTransaction }) => {
    const amount = amountOf(item);
    const isIncome = item.type === 'income';
    const isRepayment = item.kind === 'repayment';
    const isInvestmentTransfer = item.kind === 'investment-transfer' || Boolean(item.investmentTransferId);
    const isSource = item.kind === 'source';
    const account = item.accountId ? accountById.get(item.accountId) : null;
    const split = item.splitId ? splitById.get(item.splitId) : sourceSplitByTransaction.get(item.id);
    const categoryIcon = item.categoryIcon || (isRepayment || isInvestmentTransfer ? '↔' : isIncome ? '↙' : '↗');
    return (
      <TouchableOpacity
        activeOpacity={0.8}
        style={styles.transactionRow}
        onPress={() => router.push(`/transactions/${item.id}`)}
      >
        <View style={[styles.transactionIcon, isIncome && styles.transactionIconIncome, (isRepayment || isInvestmentTransfer) && styles.transactionIconTransfer]}>
          <Text style={styles.transactionEmoji}>{categoryIcon}</Text>
        </View>
        <View style={styles.transactionMain}>
          <Text style={styles.transactionTitle} numberOfLines={1}>{item.kind === 'self-transfer' ? item.title || 'Transfer' : item.category || 'Uncategorized'}</Text>
          <Text style={styles.transactionMeta} numberOfLines={1}>
            {formatShortDate(item.date)}  ·  {String(item.paymentMode || 'Payment not set').toUpperCase()}
          </Text>
          {(item.notes || split?.title || account?.name) ? (
            <Text style={styles.transactionSubmeta} numberOfLines={1}>
              {[item.notes, split?.title, account?.name].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
        </View>
        <View style={styles.transactionAmountWrap}>
          <Text style={[
            styles.transactionAmount,
            isIncome && styles.incomeText,
            (!isIncome && !isRepayment && !isSource) && styles.expenseText,
            (isRepayment || isSource || isInvestmentTransfer) && styles.transferText,
          ]}>
            {isSource ? '↗ ' : isRepayment || isInvestmentTransfer ? '↔ ' : isIncome ? '+' : '−'}{formatCurrency(amount, currentProfile?.currency || 'INR')}
          </Text>
          <Text style={styles.transactionKind}>{item.kind === 'allocation' ? 'ALLOCATION' : item.kind === 'source' ? 'SHARED SOURCE' : item.kind === 'repayment' ? 'REPAYMENT' : (item.type || 'TRANSACTION').toUpperCase()}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const listHeader = (
    <View>
      <View style={[styles.topBar, { paddingTop: Math.max(insets.top + 8, 18) }]}>

        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ArrowLeft color={colors.text} size={20} />
        </TouchableOpacity>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>YOUR MONEY, IN FOCUS</Text>
          <Text style={styles.pageTitle}>Statement</Text>
          <Text style={styles.pageSubtitle}>A clearer view of every transaction.</Text>
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Export filtered statement as PDF" style={styles.exportButton} onPress={() => void exportPdfStatement()} disabled={visibleTransactions.length === 0}>
          <FileText size={19} color={visibleTransactions.length ? '#FFFFFF' : colors.textLight} />
        </TouchableOpacity>
      </View>

      <LinearGradient colors={['#29265E', '#5146D8', '#6C63F5']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.summaryCard}>
        <View style={styles.summaryTop}>
          <View>
            <Text style={styles.summaryLabel}>NET TOTAL OF MATCHED ENTRIES</Text>
            <Text style={styles.netAmount}>{formatCurrency(totals.net, currentProfile?.currency || 'INR')}</Text>
          </View>
          <View style={styles.summaryBadge}>
            <FileSpreadsheet color="#FFFFFF" size={18} />
            <Text style={styles.summaryBadgeText}>{visibleTransactions.length} entries</Text>
          </View>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryMetrics}>
          <View style={styles.summaryMetric}>
            <View style={styles.metricIconIncome}><ArrowDownLeft color="#A9F3D0" size={16} /></View>
            <View>
              <Text style={styles.metricLabel}>Money in</Text>
              <Text style={styles.metricValue}>{formatCurrency(totals.income, currentProfile?.currency || 'INR')}</Text>
            </View>
          </View>
          <View style={styles.metricSeparator} />
          <View style={styles.summaryMetric}>
            <View style={styles.metricIconExpense}><ArrowUpRight color="#FFD5D8" size={16} /></View>
            <View>
              <Text style={styles.metricLabel}>Money out</Text>
              <Text style={styles.metricValue}>{formatCurrency(totals.expense, currentProfile?.currency || 'INR')}</Text>
            </View>
          </View>
        </View>
        <View style={styles.dateTag}>
          <CalendarDays color="#E1DEFF" size={13} />
          <Text style={styles.dateTagText}>{dateLabel(startDate, endDate)}</Text>
        </View>
      </LinearGradient>

      <View style={styles.sectionHeading}>
        <View style={styles.sectionHeadingLeft}>
          <View style={styles.sectionIcon}><Filter size={17} color={colors.primary} /></View>
          <View>
            <Text style={styles.sectionTitle}>Build your statement</Text>
            <Text style={styles.sectionCaption}>Mix and match filters to narrow it down</Text>
          </View>
        </View>
        <TouchableOpacity onPress={() => setFiltersExpanded((expanded) => !expanded)} style={styles.collapseButton}>
          {activeFilterCount > 0 ? <View style={styles.filterCount}><Text style={styles.filterCountText}>{activeFilterCount}</Text></View> : null}
          <ChevronDown size={18} color={colors.textSecondary} style={filtersExpanded ? { transform: [{ rotate: '180deg' }] } : undefined} />
        </TouchableOpacity>
      </View>

      {filtersExpanded ? (
        <View style={styles.filterCard}>
          <View style={styles.searchWrap}>
            <Search size={18} color={colors.textLight} />
            <TextInput
              value={searchText}
              onChangeText={setSearchText}
              placeholder="Search category, note, account or split"
              placeholderTextColor={colors.textLight}
              style={styles.searchInput}
              returnKeyType="search"
            />
            {searchText.length > 0 ? <TouchableOpacity onPress={() => setSearchText('')}><X size={16} color={colors.textSecondary} /></TouchableOpacity> : null}
          </View>

          <Text style={styles.filterLabel}>DATE RANGE</Text>
          <View style={styles.chipRow}>
            <FilterChip label="7 days" selected={Boolean(startDate && endDate && startDate === toLocalDateKey(new Date(Date.now() - 6 * 86400000)))} onPress={() => setPreset('7d')} />
            <FilterChip label="30 days" selected={Boolean(startDate && endDate && startDate === toLocalDateKey(new Date(Date.now() - 29 * 86400000)))} onPress={() => setPreset('30d')} />
            <FilterChip label="90 days" selected={Boolean(startDate && endDate && startDate === toLocalDateKey(new Date(Date.now() - 89 * 86400000)))} onPress={() => setPreset('90d')} />
            <FilterChip label="This month" selected={Boolean(startDate === toLocalDateKey(new Date(new Date().getFullYear(), new Date().getMonth(), 1)))} onPress={() => setPreset('month')} />
            <FilterChip label="This year" selected={Boolean(startDate === toLocalDateKey(new Date(new Date().getFullYear(), 0, 1)))} onPress={() => setPreset('year')} />
          </View>
          <View style={styles.dateActionRow}>
            <TouchableOpacity style={styles.dateSelectButton} onPress={() => {
              setDraftStartDate(startDate);
              setDraftEndDate(endDate);
              setCalendarVisible(true);
            }}>
              <CalendarDays size={16} color={colors.primary} />
              <Text style={styles.dateSelectText}>{startDate || endDate ? dateLabel(startDate, endDate) : 'Choose custom dates'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.allTimeButton} onPress={() => setPreset('all')}><Text style={styles.allTimeText}>All time</Text></TouchableOpacity>
          </View>

          <Text style={styles.filterLabel}>TRANSACTION TYPE</Text>
          <View style={styles.chipRow}>
            {(['all', 'income', 'expense'] as TransactionTypeFilter[]).map((value) => (
              <FilterChip key={value} label={value === 'all' ? 'All types' : value === 'income' ? 'Income' : 'Expense'} selected={typeFilter === value} onPress={() => setTypeFilter(value)} />
            ))}
          </View>

          <Text style={styles.filterLabel}>PAYMENT METHOD</Text>
          <View style={styles.chipRow}>
            {PAYMENT_MODES.map((mode) => (
              <FilterChip key={mode.value} label={mode.label} selected={paymentMode === mode.value} onPress={() => setPaymentMode(mode.value)} />
            ))}
          </View>

          <Text style={styles.filterLabel}>SPLITS & TRANSFERS</Text>
          <View style={styles.chipRow}>
            {KIND_FILTERS.map((kind) => (
              <FilterChip key={kind.value} label={kind.label} selected={kindFilter === kind.value} onPress={() => setKindFilter(kind.value)} />
            ))}
          </View>

          <Text style={styles.filterLabel}>CATEGORY</Text>
          <View style={styles.chipRow}>
            {categoryOptions.map((category) => (
              <FilterChip key={category} label={category} selected={categoryFilters.includes(category)} onPress={() => toggleCategory(category)} />
            ))}
          </View>

          {accounts.length > 0 ? <>
            <Text style={styles.filterLabel}>ACCOUNT</Text>
            <View style={styles.chipRow}>
              <FilterChip label="All accounts" selected={accountFilter === 'all'} onPress={() => setAccountFilter('all')} />
              {accounts.map((account) => <FilterChip key={account.id} label={account.name || 'Account'} selected={accountFilter === account.id} onPress={() => setAccountFilter(account.id)} />)}
              <FilterChip label="No account" selected={accountFilter === 'none'} onPress={() => setAccountFilter('none')} />
            </View>
          </> : null}

          {counterpartyOptions.length > 0 ? <>
            <Text style={styles.filterLabel}>PERSON / COUNTERPARTY</Text>
            <View style={styles.chipRow}>
              <FilterChip label="Anyone" selected={counterpartyFilter === 'all'} onPress={() => setCounterpartyFilter('all')} />
              {counterpartyOptions.map(([id, name]) => <FilterChip key={id} label={name} selected={counterpartyFilter === id} onPress={() => setCounterpartyFilter(id)} />)}
            </View>
          </> : null}

          <Text style={styles.filterLabel}>SORT RESULTS</Text>
          <View style={styles.chipRow}>
            {([
              { label: 'Newest first', value: 'newest' },
              { label: 'Oldest first', value: 'oldest' },
              { label: 'Largest amount', value: 'amountHigh' },
              { label: 'Smallest amount', value: 'amountLow' },
            ] as { label: string; value: SortMode }[]).map((option) => <FilterChip key={option.value} label={option.label} selected={sortMode === option.value} onPress={() => setSortMode(option.value)} />)}
          </View>

          <Text style={styles.filterLabel}>AMOUNT RANGE ({currentProfile?.currency || 'INR'})</Text>
          <View style={styles.amountRangeRow}>
            <View style={styles.amountInputWrap}>
              <Text style={styles.amountPrefix}>Min</Text>
              <TextInput value={minAmount} onChangeText={setMinAmount} placeholder="0" placeholderTextColor={colors.textLight} keyboardType="decimal-pad" style={styles.amountInput} />
            </View>
            <View style={styles.amountRangeLine} />
            <View style={styles.amountInputWrap}>
              <Text style={styles.amountPrefix}>Max</Text>
              <TextInput value={maxAmount} onChangeText={setMaxAmount} placeholder="Any" placeholderTextColor={colors.textLight} keyboardType="decimal-pad" style={styles.amountInput} />
            </View>
          </View>

          <View style={styles.filterFooter}>
            <TouchableOpacity style={styles.resetButton} onPress={clearFilters}>
              <Text style={styles.resetText}>Reset filters</Text>
            </TouchableOpacity>
            <View style={styles.resultPill}><Text style={styles.resultPillText}>{visibleTransactions.length} matches</Text></View>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.collapsedFilters} onPress={() => setFiltersExpanded(true)}>
          <Text style={styles.collapsedText}>{activeFilterCount ? `${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} active` : 'No filters applied'}</Text>
          <Text style={styles.editFiltersText}>Edit filters</Text>
        </TouchableOpacity>
      )}

      <View style={styles.resultsHeading}>
        <View>
          <Text style={styles.resultsTitle}>Transactions</Text>
          <Text style={styles.resultsSubtitle}>{visibleTransactions.length} records · newest first</Text>
        </View>
        <View style={styles.exportActions}>
          <TouchableOpacity style={styles.pdfButton} onPress={() => void exportPdfStatement()} disabled={visibleTransactions.length === 0}>
            <FileText size={15} color={visibleTransactions.length ? '#FFFFFF' : colors.textLight} />
            <Text style={[styles.pdfButtonText, !visibleTransactions.length && { color: colors.textLight }]}>PDF</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.csvButton} onPress={() => void exportStatement()} disabled={visibleTransactions.length === 0}>
            <Download size={15} color={visibleTransactions.length ? colors.primary : colors.textLight} />
            <Text style={[styles.csvButtonText, !visibleTransactions.length && { color: colors.textLight }]}>CSV</Text>
          </TouchableOpacity>
        </View>
      </View>
      {loading && transactions.length === 0 ? <View style={styles.loadingBox}><ActivityIndicator size="large" color={colors.primary} /><Text style={styles.loadingText}>Building your statement…</Text></View> : null}
      {loadError && transactions.length === 0 ? <View style={styles.emptyState}><Text style={styles.emptyTitle}>Couldn’t load statement</Text><Text style={styles.emptySubtitle}>Pull to refresh and try again.</Text></View> : null}
    </View>
  );
    return (
    <View style={styles.container}>
      <FlatList
        data={visibleTransactions}
        keyExtractor={(item) => item.id}
        renderItem={renderTransaction}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={!loading && !loadError ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}><Wallet size={24} color={colors.primary} /></View>
            <Text style={styles.emptyTitle}>No matching transactions</Text>
            <Text style={styles.emptySubtitle}>Try a wider date range or remove a filter.</Text>
          </View>
        ) : null}
        contentContainerStyle={[styles.listContent, { paddingBottom: Math.max(insets.bottom, 18) + 20 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadStatement(true)} tintColor={colors.primary} />}
        keyboardShouldPersistTaps="handled"
      />

      <Modal visible={calendarVisible} animationType="slide" transparent onRequestClose={() => setCalendarVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.calendarSheet}>
            <View style={styles.calendarHeader}>
              <View>
                <Text style={styles.calendarTitle}>Custom date range</Text>
                <Text style={styles.calendarSubtitle}>Select a start date, then an end date</Text>
              </View>
              <TouchableOpacity style={styles.calendarClose} onPress={() => setCalendarVisible(false)}><X size={20} color={colors.textSecondary} /></TouchableOpacity>
            </View>
            <View style={styles.calendarSelectedDates}>
              <View style={styles.calendarDateBox}><Text style={styles.calendarDateLabel}>FROM</Text><Text style={styles.calendarDateValue}>{draftStartDate || 'Not set'}</Text></View>
              <View style={styles.calendarDateBox}><Text style={styles.calendarDateLabel}>TO</Text><Text style={styles.calendarDateValue}>{draftEndDate || 'Not set'}</Text></View>
            </View>
            <Calendar
              markingType="period"
              markedDates={markedDates}
              onDayPress={selectCalendarDay}
              maxDate={toLocalDateKey(new Date())}
              theme={{
                calendarBackground: colors.card,
                backgroundColor: colors.card,
                todayTextColor: colors.primary,
                arrowColor: colors.primary,
                monthTextColor: colors.text,
                textSectionTitleColor: colors.textSecondary,
                dayTextColor: colors.text,
                textDisabledColor: colors.textLight,
              }}
            />
            <View style={styles.calendarActions}>
              <TouchableOpacity style={styles.calendarClear} onPress={() => { setDraftStartDate(null); setDraftEndDate(null); }}><Text style={styles.resetText}>Clear dates</Text></TouchableOpacity>
              <TouchableOpacity style={styles.calendarApply} onPress={() => {
                if (draftStartDate && draftEndDate && draftEndDate < draftStartDate) {
                  setStartDate(draftEndDate);
                  setEndDate(draftStartDate);
                } else {
                  setStartDate(draftStartDate);
                  setEndDate(draftEndDate);
                }
                setCalendarVisible(false);
              }}><Text style={styles.calendarApplyText}>Apply range</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listContent: { paddingBottom: 36 },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 18, paddingBottom: 20, gap: 12 },
  backButton: { width: 42, height: 42, borderRadius: 15, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  headingCopy: { flex: 1 },
  eyebrow: { fontSize: 10, letterSpacing: 1.7, color: colors.primary, fontWeight: '800', marginBottom: 4 },
  pageTitle: { fontSize: 30, fontWeight: '800', color: colors.text, letterSpacing: -0.8 },
  pageSubtitle: { marginTop: 3, fontSize: 12, color: colors.textSecondary },
  exportButton: { width: 42, height: 42, borderRadius: 15, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  summaryCard: { marginHorizontal: 18, padding: 20, borderRadius: 26, marginBottom: 28, shadowColor: '#3932A3', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.2, shadowRadius: 18, elevation: 7 },
  summaryTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  summaryLabel: { color: '#CDC9FF', fontSize: 10, letterSpacing: 1.5, fontWeight: '800', marginBottom: 7 },
  netAmount: { color: '#FFFFFF', fontSize: 31, fontWeight: '800', letterSpacing: -0.8 },
  summaryBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.15)' },
  summaryBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  summaryDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.2)', marginTop: 18, marginBottom: 16 },
  summaryMetrics: { flexDirection: 'row', alignItems: 'center' },
  summaryMetric: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  metricIconIncome: { width: 34, height: 34, borderRadius: 12, backgroundColor: 'rgba(91,219,168,0.16)', alignItems: 'center', justifyContent: 'center' },
  metricIconExpense: { width: 34, height: 34, borderRadius: 12, backgroundColor: 'rgba(255,148,159,0.16)', alignItems: 'center', justifyContent: 'center' },
  metricLabel: { color: '#D6D3FF', fontSize: 11, marginBottom: 4 },
  metricValue: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  metricSeparator: { width: 1, height: 34, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: 12 },
  dateTag: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.12)', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 11, marginTop: 18 },
  dateTagText: { color: '#E5E3FF', fontSize: 11, fontWeight: '600' },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 14 },
  sectionHeadingLeft: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  sectionIcon: { width: 38, height: 38, borderRadius: 14, backgroundColor: '#E9E8FF', alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  sectionCaption: { color: colors.textSecondary, fontSize: 11, marginTop: 3 },
  collapseButton: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  filterCount: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  filterCountText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  filterCard: { marginHorizontal: 18, padding: 16, backgroundColor: colors.card, borderRadius: 23, borderWidth: 1, borderColor: colors.border, marginBottom: 26 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13, height: 46, borderRadius: 15, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, color: colors.text, fontSize: 12, paddingVertical: 0 },
  filterLabel: { marginTop: 20, marginBottom: 10, fontSize: 10, letterSpacing: 1.2, color: colors.textSecondary, fontWeight: '800' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  chipTextSelected: { color: '#FFFFFF' },
  dateActionRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  dateSelectButton: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 13, backgroundColor: '#F0EFFF', minHeight: 42 },
  dateSelectText: { flex: 1, color: colors.primary, fontSize: 11, fontWeight: '700' },
  allTimeButton: { paddingHorizontal: 12, justifyContent: 'center', borderRadius: 13, borderWidth: 1, borderColor: colors.border },
  allTimeText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  amountRangeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  amountInputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 44, borderRadius: 13, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  amountPrefix: { fontSize: 11, color: colors.textLight, fontWeight: '700' },
  amountInput: { flex: 1, fontSize: 12, color: colors.text, paddingVertical: 0 },
  amountRangeLine: { width: 12, height: 1, backgroundColor: colors.border },
  filterFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 21, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.border },
  resetButton: { paddingVertical: 8, paddingHorizontal: 2 },
  resetText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  resultPill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: '#E9F8F1' },
  resultPillText: { color: '#16875B', fontSize: 11, fontWeight: '800' },
  collapsedFilters: { marginHorizontal: 18, marginBottom: 26, padding: 16, borderRadius: 17, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  collapsedText: { fontSize: 12, color: colors.textSecondary },
  editFiltersText: { color: colors.primary, fontWeight: '800', fontSize: 12 },
  resultsHeading: { paddingHorizontal: 20, marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  resultsTitle: { fontSize: 19, fontWeight: '800', color: colors.text, letterSpacing: -0.3 },
  resultsSubtitle: { fontSize: 11, color: colors.textSecondary, marginTop: 4 },
  exportActions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  pdfButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, paddingVertical: 9, backgroundColor: colors.primary, borderRadius: 12 },
  pdfButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  csvButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, paddingVertical: 9, backgroundColor: '#ECEBFF', borderRadius: 12 },
  csvButtonText: { color: colors.primary, fontSize: 11, fontWeight: '800' },
  transactionRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 18, marginBottom: 9, paddingHorizontal: 13, paddingVertical: 13, borderRadius: 18, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  transactionIcon: { width: 44, height: 44, borderRadius: 15, backgroundColor: '#FFF1E8', alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  transactionIconIncome: { backgroundColor: '#E4F8EF' },
  transactionIconTransfer: { backgroundColor: '#ECEBFF' },
  transactionEmoji: { fontSize: 19 },
  transactionMain: { flex: 1, paddingRight: 6 },
  transactionTitle: { fontSize: 13, fontWeight: '800', color: colors.text, marginBottom: 5 },
  transactionMeta: { fontSize: 10, color: colors.textSecondary },
  transactionSubmeta: { fontSize: 10, color: colors.textLight, marginTop: 4 },
  transactionAmountWrap: { alignItems: 'flex-end', maxWidth: '38%' },
  transactionAmount: { color: colors.text, fontSize: 12, fontWeight: '800', textAlign: 'right' },
  incomeText: { color: '#159A68' },
  expenseText: { color: '#D84A5B' },
  transferText: { color: colors.primary },
  transactionKind: { fontSize: 8, letterSpacing: 0.4, color: colors.textLight, marginTop: 5, fontWeight: '800' },
  emptyState: { alignItems: 'center', marginHorizontal: 28, marginTop: 18, marginBottom: 36, padding: 24, borderRadius: 22, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  emptyIcon: { width: 54, height: 54, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ECEBFF', marginBottom: 13 },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '800', marginBottom: 6 },
  emptySubtitle: { color: colors.textSecondary, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  loadingBox: { alignItems: 'center', paddingVertical: 26, gap: 10 },
  loadingText: { color: colors.textSecondary, fontSize: 12 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,24,45,0.48)' },
  calendarSheet: { backgroundColor: colors.card, paddingHorizontal: 18, paddingTop: 22, paddingBottom: 20, borderTopLeftRadius: 26, borderTopRightRadius: 26, maxHeight: '92%' },
  calendarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 17 },
  calendarTitle: { fontSize: 19, fontWeight: '800', color: colors.text },
  calendarSubtitle: { color: colors.textSecondary, fontSize: 11, marginTop: 5 },
  calendarClose: { width: 36, height: 36, borderRadius: 13, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  calendarSelectedDates: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  calendarDateBox: { flex: 1, padding: 12, backgroundColor: colors.background, borderRadius: 13, borderWidth: 1, borderColor: colors.border },
  calendarDateLabel: { color: colors.textLight, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  calendarDateValue: { color: colors.text, fontSize: 12, fontWeight: '700', marginTop: 6 },
  calendarActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  calendarClear: { paddingVertical: 13, paddingHorizontal: 4 },
  calendarApply: { paddingVertical: 13, paddingHorizontal: 21, borderRadius: 14, backgroundColor: colors.primary },
  calendarApplyText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
});
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  CreditCard,
  FileText,
  ReceiptText,
  RotateCw,
  UsersRound,
  Wallet,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { db } from '@/src/firebaseConfig';

type TransactionRecord = {
  amount?: number;
  category?: string;
  title?: string;
  type?: string;
  date?: string;
  currency?: string;
  paymentMode?: string;
  notes?: string | null;
  kind?: string;
  accountId?: string | null;
  investmentTransferId?: string;
  investmentTransferDirection?: 'in' | 'out';
};

function formatDate(value?: string) {
  if (!value) return 'Date unavailable';
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(dateOnly ? `${value}T12:00:00` : value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatAmount(value: unknown, currency?: string) {
  const amount = Number(value ?? 0);
  const formatted = (Number.isFinite(amount) ? amount : 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (!currency || currency.toUpperCase() === 'INR') return `₹${formatted}`;
  return `${currency.toUpperCase()} ${formatted}`;
}

function displayLabel(value?: string | null) {
  if (!value) return 'Not specified';
  return value
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export default function TransactionDetail() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const transactionId = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { currentProfile } = useProfile();

  const [transaction, setTransaction] = useState<TransactionRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      setLoadError(null);
      setTransaction(null);

      if (!currentProfile?.id || !transactionId) {
        setLoadError('This transaction is unavailable for the current profile.');
        setLoading(false);
        return;
      }

      try {
        const ref = doc(
          db,
          'profiles',
          currentProfile.id,
          'transactions',
          transactionId,
        );
        const snapshot = await getDoc(ref);
        if (!active) return;

        if (snapshot.exists()) {
          setTransaction(snapshot.data() as TransactionRecord);
        } else {
          setLoadError('We couldn’t find this transaction. It may have been removed.');
        }
      } catch (error) {
        console.error('Unable to load transaction details', error);
        if (active) setLoadError('Check your connection and try loading this transaction again.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [transactionId, currentProfile?.id, retryToken]);

  const canSplit = Boolean(
    transaction &&
      transaction.type === 'expense' &&
      transaction.currency === 'INR' &&
      !transaction.kind,
  );
  const isInvestmentTransfer = transaction?.kind === 'investment-transfer' || Boolean(transaction?.investmentTransferId);
  const isIncome = transaction?.type === 'income';
  const title = transaction?.title || transaction?.category || 'Transaction';

  if (loading) {
    return (
      <View style={[styles.stateScreen, { paddingTop: insets.top + 24 }]}>
        <View style={styles.stateIcon}>
          <ReceiptText size={28} color={colors.primary} />
        </View>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.stateTitle}>Loading transaction</Text>
        <Text style={styles.stateMessage}>Getting the details for this entry…</Text>
      </View>
    );
  }

  if (!transaction) {
    return (
      <View style={[styles.stateScreen, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={styles.stateBackButton} onPress={() => router.back()} activeOpacity={0.8}>
          <ArrowLeft size={18} color={colors.text} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <View style={styles.stateIconError}>
          <CircleAlert size={28} color={colors.danger} />
        </View>
        <Text style={styles.stateTitle}>{loadError?.startsWith('We couldn’t find') ? 'Transaction not found' : 'Unable to load transaction'}</Text>
        <Text style={styles.stateMessage}>{loadError || 'This transaction is unavailable.'}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          activeOpacity={0.85}
          onPress={() => setRetryToken((value) => value + 1)}
        >
          <RotateCw size={17} color="#FFFFFF" />
          <Text style={styles.retryButtonText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + 8,
            paddingBottom: canSplit ? 28 : Math.max(insets.bottom, 20) + 24,
          },
        ]}
      >
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft size={19} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.topBarCopy}>
            <Text style={styles.eyebrow}>YOUR ACTIVITY</Text>
            <Text style={styles.screenTitle}>Transaction details</Text>
          </View>
          <View style={styles.topBarIcon}>
            <ReceiptText size={20} color={colors.primary} />
          </View>
        </View>

        <LinearGradient
          colors={isIncome && !isInvestmentTransfer ? ['#12684E', '#15966A', '#24B783'] : ['#29265E', '#5146D8', '#6C63F5']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroTopRow}>
            <View style={styles.heroIcon}>
              {isInvestmentTransfer ? <ArrowLeftRight size={23} color="#FFFFFF" /> : isIncome
                ? <ArrowDownLeft size={23} color="#FFFFFF" />
                : <ArrowUpRight size={23} color="#FFFFFF" />}
            </View>
            <View style={styles.typePill}>
              <Text style={styles.typePillText}>{isInvestmentTransfer ? 'Transfer' : displayLabel(transaction.type || 'transaction')}</Text>
            </View>
          </View>
          <Text style={styles.heroCategory}>{title}</Text>
          <Text style={styles.amount}>
            {isInvestmentTransfer ? '↔ ' : isIncome ? '+' : transaction.type === 'expense' ? '−' : ''}
            {formatAmount(transaction.amount, transaction.currency)}
          </Text>
          <View style={styles.heroDivider} />
          <View style={styles.heroDateRow}>
            <CalendarDays size={15} color="#E3E1FF" />
            <Text style={styles.heroDate}>{formatDate(transaction.date)}</Text>
          </View>
        </LinearGradient>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Transaction overview</Text>
          <Text style={styles.sectionCaption}>Details saved with this entry</Text>
        </View>

        <View style={styles.detailsCard}>
          <View style={styles.detailRow}>
            <View style={styles.detailIcon}>
              <ReceiptText size={17} color={colors.primary} />
            </View>
            <View style={styles.detailCopy}>
              <Text style={styles.detailLabel}>Category</Text>
              <Text style={styles.detailValue}>{transaction.category || 'Uncategorized'}</Text>
            </View>
            <CheckCircle2 size={17} color={colors.success} />
          </View>
          <View style={styles.rowDivider} />
          <View style={styles.detailRow}>
            <View style={styles.detailIcon}>
              <CreditCard size={17} color={colors.primary} />
            </View>
            <View style={styles.detailCopy}>
              <Text style={styles.detailLabel}>Payment method</Text>
              <Text style={styles.detailValue}>{displayLabel(transaction.paymentMode)}</Text>
            </View>
          </View>
          {transaction.currency ? (
            <>
              <View style={styles.rowDivider} />
              <View style={styles.detailRow}>
                <View style={styles.detailIcon}>
                  <Wallet size={17} color={colors.primary} />
                </View>
                <View style={styles.detailCopy}>
                  <Text style={styles.detailLabel}>Currency</Text>
                  <Text style={styles.detailValue}>{transaction.currency.toUpperCase()}</Text>
                </View>
              </View>
            </>
          ) : null}
        </View>

        {transaction.notes?.trim() ? (
          <View style={styles.notesCard}>
            <View style={styles.notesHeading}>
              <FileText size={17} color={colors.primary} />
              <Text style={styles.notesTitle}>Notes</Text>
            </View>
            <Text style={styles.notesText}>{transaction.notes.trim()}</Text>
          </View>
        ) : null}

        {canSplit ? (
          <View style={styles.splitInfoCard}>
            <View style={styles.splitInfoIcon}>
              <UsersRound size={21} color={colors.primary} />
            </View>
            <View style={styles.splitInfoCopy}>
              <Text style={styles.splitInfoTitle}>Share this expense</Text>
              <Text style={styles.splitInfoText}>
                Split this payment with friends and keep everyone’s share organized.
              </Text>
            </View>
          </View>
        ) : null}
      </ScrollView>

      {canSplit ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <TouchableOpacity
            style={styles.splitButton}
            activeOpacity={0.86}
            onPress={() => router.push(`/splits/create?txId=${transactionId}`)}
            accessibilityRole="button"
          >
            <UsersRound size={19} color="#FFFFFF" />
            <Text style={styles.splitButtonText}>Split with friends</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scrollContent: { paddingHorizontal: 20, gap: 0 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 22 },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 15,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  stateBackButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  topBarCopy: { flex: 1 },
  eyebrow: { color: colors.primary, fontWeight: '800', letterSpacing: 1.3, fontSize: 10 },
  screenTitle: { color: colors.text, fontSize: 21, fontWeight: '800', marginTop: 3 },
  topBarIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    backgroundColor: '#ECEBFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: { borderRadius: 26, padding: 22, marginBottom: 26, overflow: 'hidden' },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  typePill: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: 'rgba(255,255,255,0.16)' },
  typePillText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
  heroCategory: { color: '#E7E5FF', marginTop: 23, fontSize: 14, fontWeight: '600' },
  amount: { color: '#FFFFFF', fontSize: 34, lineHeight: 42, fontWeight: '800', letterSpacing: -0.8, marginTop: 5 },
  heroDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.22)', marginVertical: 17 },
  heroDateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroDate: { color: '#E3E1FF', fontSize: 13, fontWeight: '500' },
  sectionHeader: { marginBottom: 13 },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  sectionCaption: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  detailsCard: { backgroundColor: colors.card, borderRadius: 20, paddingHorizontal: 15, borderWidth: 1, borderColor: colors.border },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 15 },
  detailIcon: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0EFFF' },
  detailCopy: { flex: 1, gap: 3 },
  detailLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '500' },
  detailValue: { color: colors.text, fontSize: 14, fontWeight: '700' },
  rowDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 51 },
  notesCard: { backgroundColor: colors.card, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 16, marginTop: 14 },
  notesHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 9 },
  notesTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  notesText: { color: colors.textSecondary, fontSize: 14, lineHeight: 21 },
  splitInfoCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#F0EFFF', borderRadius: 20, borderWidth: 1, borderColor: '#DFDDFF', padding: 15, marginTop: 18 },
  splitInfoIcon: { width: 43, height: 43, borderRadius: 15, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  splitInfoCopy: { flex: 1, gap: 4 },
  splitInfoTitle: { color: colors.text, fontWeight: '800', fontSize: 14 },
  splitInfoText: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  footer: { paddingTop: 12, paddingHorizontal: 20, backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border },
  splitButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: colors.primary, borderRadius: 17, paddingVertical: 16, shadowColor: colors.primary, shadowOpacity: 0.22, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  splitButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  stateScreen: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  stateIcon: { width: 68, height: 68, borderRadius: 22, backgroundColor: '#ECEBFF', alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  stateIconError: { width: 68, height: 68, borderRadius: 22, backgroundColor: '#FDEBED', alignItems: 'center', justifyContent: 'center', marginTop: 58, marginBottom: 20 },
  stateTitle: { color: colors.text, fontSize: 19, fontWeight: '800', textAlign: 'center', marginTop: 14 },
  stateMessage: { color: colors.textSecondary, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 7, maxWidth: 300 },
  retryButton: { marginTop: 22, backgroundColor: colors.primary, borderRadius: 14, paddingHorizontal: 20, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', gap: 9 },
  retryButtonText: { color: '#FFFFFF', fontWeight: '800' },
});
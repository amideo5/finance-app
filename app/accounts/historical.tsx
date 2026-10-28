import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { db } from '@/src/firebaseConfig';
import { assignHistoricalTransactions, getAccounts } from '@/src/services/firebase/accountsService';
import { FinanceAccount } from '@/types/finance';
import { useRouter } from 'expo-router';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  CalendarDays,
  Check,
  ChevronRight,
  CreditCard,
  History,
  Landmark,
  Link2,
  ReceiptText,
  WalletCards,
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type HistoricalTransaction = {
  id: string;
  amount?: number;
  type?: string;
  category?: string;
  date?: string;
  paymentMode?: string;
  accountId?: string | null;
  notes?: string;
};

const isCash = (tx: HistoricalTransaction) =>
  String(tx.paymentMode || '').trim().toLowerCase() === 'cash';

const accountKindLabel = (account: FinanceAccount) => {
  const type = String(account.type || 'account').replace(/[-_]/g, ' ').trim();
  return type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Account';
};

const transactionDateLabel = (value?: string) => {
  if (!value) return 'Date unavailable';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'Date unavailable'
    : parsed.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function HistoricalTransactionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { currentProfile } = useProfile();
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [transactions, setTransactions] = useState<HistoricalTransaction[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [chosenAccount, setChosenAccount] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!currentProfile?.id) return;
    setLoading(true);
    try {
      const [accountList, txSnapshot] = await Promise.all([
        getAccounts(currentProfile.id),
        getDocs(query(collection(db, 'profiles', currentProfile.id, 'transactions'), orderBy('date', 'desc'))),
      ]);
      setAccounts(accountList as FinanceAccount[]);
      // Cash is handled by the dedicated Cash backfill action on Accounts.
      setTransactions(txSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as HistoricalTransaction))
        .filter(tx => !tx.accountId && !isCash(tx)
          // Firestore rules intentionally prevent client edits to server-generated
          // split/settlement rows and records marked with protected metadata.
          && !(tx as any).kind && !(tx as any).serverGenerated
          && !(tx as any).splitId && !(tx as any).settlementId));
      setSelected([]);
      setChosenAccount('');
    } catch (e) {
      console.error('Could not load historical transactions', e);
      Alert.alert('Could not load', 'Please try again.');
    } finally {
      setLoading(false);
    }
  }, [currentProfile?.id]);

  useEffect(() => { void load(); }, [load]);

  const bankAccounts = useMemo(() => accounts.filter(a => a.type !== 'cash'), [accounts]);
  const toggle = (id: string) => setSelected(old => old.includes(id) ? old.filter(x => x !== id) : [...old, id]);
  const allSelected = transactions.length > 0 && selected.length === transactions.length;
  const selectedAccount = bankAccounts.find(account => account.id === chosenAccount);

  const assign = async () => {
    if (!currentProfile?.id || !chosenAccount || selected.length === 0) {
      Alert.alert('Choose transactions and an account', 'Select at least one transaction and a bank/account.');
      return;
    }
    setSaving(true);
    try {
      const result = await assignHistoricalTransactions(currentProfile.id, selected, chosenAccount);
      Alert.alert(
        result.failed ? 'Partially linked' : 'Accounts linked',
        `${result.updated} transaction(s) linked. ${result.failed} could not be updated (possibly due to profile permissions or protected/locked records). Account balances were not changed.`
      );
      await load();
    } catch (e) {
      console.error('Historical account assignment failed', e);
      Alert.alert('Assignment failed', 'Could not link transactions. Please retry.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.pageContent, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
      >
        <View style={[styles.header, { paddingTop: Math.max(insets.top + 8, 24) }]}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Back to accounts"
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.8}
          >
            <ArrowLeft size={19} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>ACCOUNT ORGANIZATION</Text>
            <Text style={styles.title}>Historical transactions</Text>
            <Text style={styles.subtitle}>Connect older transactions to the account they came from.</Text>
          </View>
          <View style={styles.headerIcon}>
            <History size={23} color={colors.primary} />
          </View>
        </View>

        <LinearGradient
          colors={['#29265E', '#5146D8', '#6C63F5']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.infoHero}
        >
          <View style={styles.heroIcon}><Link2 size={19} color="#FFFFFF" /></View>
          <Text style={styles.heroTitle}>Link without changing balances</Text>
          <Text style={styles.heroSubtitle}>This only adds an account link to eligible older transactions. Your account balances are not recalculated.</Text>
          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{transactions.length}</Text>
              <Text style={styles.heroStatLabel}>Unlinked records</Text>
            </View>
            <View style={styles.heroStatDivider} />
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{selected.length}</Text>
              <Text style={styles.heroStatLabel}>Selected</Text>
            </View>
            <View style={styles.heroStatDivider} />
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{bankAccounts.length}</Text>
              <Text style={styles.heroStatLabel}>Eligible accounts</Text>
            </View>
          </View>
          <View pointerEvents="none" style={styles.heroGlow} />
        </LinearGradient>

        <View style={styles.sectionHeading}>
          <View style={styles.sectionIconWrap}>
            <Landmark size={18} color={colors.primary} />
          </View>
          <View style={styles.sectionHeadingCopy}>
            <Text style={styles.sectionTitle}>Choose destination account</Text>
            <Text style={styles.sectionSubtitle}>Where were these transactions paid from?</Text>
          </View>
          <Text style={styles.sectionCount}>{bankAccounts.length}</Text>
        </View>

        {loading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.loadingText}>Finding unlinked transactions…</Text>
          </View>
        ) : bankAccounts.length === 0 ? (
          <View style={styles.noticeCard}>
            <View style={styles.noticeIcon}><WalletCards size={22} color={colors.primary} /></View>
            <View style={styles.noticeCopy}>
              <Text style={styles.noticeTitle}>No bank or card accounts yet</Text>
              <Text style={styles.noticeText}>Add a bank or card account first. Cash transactions are handled separately from the Accounts screen.</Text>
            </View>
            <TouchableOpacity style={styles.noticeAction} onPress={() => router.push('/accounts/add')} activeOpacity={0.8}>
              <ArrowRight size={18} color={colors.primary} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.accountList}>
            {bankAccounts.map(account => {
              const chosen = chosenAccount === account.id;
              const isCard = String(account.type || '').toLowerCase().includes('card');
              const AccountIcon = isCard ? CreditCard : Landmark;
              return (
                <TouchableOpacity
                  key={account.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: chosen }}
                  activeOpacity={0.82}
                  style={[styles.accountCard, chosen && styles.accountCardChosen]}
                  onPress={() => setChosenAccount(account.id)}
                >
                  <View style={[styles.accountIcon, chosen && styles.accountIconChosen]}>
                    <AccountIcon size={20} color={chosen ? '#FFFFFF' : colors.primary} />
                  </View>
                  <View style={styles.accountCopy}>
                    <Text style={styles.accountName} numberOfLines={1}>{account.name}</Text>
                    <Text style={styles.accountMeta}>{accountKindLabel(account)}</Text>
                  </View>
                  <View style={[styles.radio, chosen && styles.radioChosen]}>
                    {chosen ? <Check size={14} color="#FFFFFF" strokeWidth={3} /> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <View style={[styles.sectionHeading, styles.transactionSectionHeading]}>
          <View style={styles.sectionIconWrap}>
            <ReceiptText size={18} color={colors.primary} />
          </View>
          <View style={styles.sectionHeadingCopy}>
            <Text style={styles.sectionTitle}>Unlinked transactions</Text>
            <Text style={styles.sectionSubtitle}>Select the records you want to connect</Text>
          </View>
          <View style={styles.countPill}><Text style={styles.countPillText}>{transactions.length}</Text></View>
        </View>

        {transactions.length > 0 ? (
          <View style={styles.transactionPanel}>
            <View style={styles.panelToolbar}>
              <View style={styles.panelToolbarCopy}>
                <Text style={styles.panelTitle}>{selected.length ? `${selected.length} selected` : 'Ready to review'}</Text>
                <Text style={styles.panelSubtitle}>Cash and protected split records are excluded</Text>
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => setSelected(allSelected ? [] : transactions.map(t => t.id))}
                style={styles.selectAllButton}
                activeOpacity={0.8}
              >
                <Text style={styles.selectAllText}>{allSelected ? 'Clear all' : 'Select all'}</Text>
              </TouchableOpacity>
            </View>

            {transactions.map((tx, index) => {
              const isSelected = selected.includes(tx.id);
              const isIncome = tx.type === 'income';
              return (
                <TouchableOpacity
                  key={tx.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSelected }}
                  activeOpacity={0.8}
                  style={[
                    styles.transactionRow,
                    index === transactions.length - 1 && styles.transactionRowLast,
                    isSelected && styles.transactionRowSelected,
                  ]}
                  onPress={() => toggle(tx.id)}
                >
                  <View style={[styles.transactionSelect, isSelected && styles.transactionSelectActive]}>
                    {isSelected ? <Check size={14} color="#FFFFFF" strokeWidth={3} /> : null}
                  </View>
                  <View style={[styles.transactionIcon, isIncome ? styles.transactionIconIncome : styles.transactionIconExpense]}>
                    {isIncome ? <ArrowRight size={18} color={colors.success} /> : <Banknote size={18} color="#D97706" />}
                  </View>
                  <View style={styles.transactionCopy}>
                    <Text style={styles.transactionTitle} numberOfLines={1}>{tx.category || tx.type || 'Transaction'}</Text>
                    <View style={styles.transactionMetaRow}>
                      <CalendarDays size={12} color={colors.textLight} />
                      <Text style={styles.transactionMeta} numberOfLines={1}>{transactionDateLabel(tx.date)}</Text>
                      <View style={styles.metaDot} />
                      <Text style={styles.transactionMeta} numberOfLines={1}>{tx.paymentMode || 'Unknown method'}</Text>
                    </View>
                    {tx.notes ? <Text style={styles.transactionNotes} numberOfLines={1}>{tx.notes}</Text> : null}
                  </View>
                  <View style={styles.amountWrap}>
                    <Text style={[styles.amount, isIncome && styles.incomeAmount]} numberOfLines={1}>₹{Number(tx.amount || 0).toLocaleString('en-IN')}</Text>
                    <ChevronRight size={15} color={isSelected ? colors.primary : colors.textLight} />
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : !loading ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}><Check size={25} color={colors.success} /></View>
            <Text style={styles.emptyTitle}>You’re all caught up</Text>
            <Text style={styles.emptyText}>No unlinked non-cash transactions were found. Eligible historical records will appear here.</Text>
          </View>
        ) : null}
      </ScrollView>

      {!loading ? (
        <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) + 10 }]}>
          <View style={styles.bottomBarCopy}>
            <Text style={styles.bottomBarTitle}>{selected.length ? `${selected.length} transaction${selected.length === 1 ? '' : 's'} selected` : 'Ready to link records?'}</Text>
            <Text style={styles.bottomBarSubtitle} numberOfLines={1}>{selectedAccount ? `Destination: ${selectedAccount.name}` : 'Choose an account and select transactions'}</Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={saving || !selected.length || !chosenAccount}
            style={[styles.assignButton, (!selected.length || !chosenAccount || saving) && styles.assignButtonDisabled]}
            onPress={() => void assign()}
            activeOpacity={0.85}
          >
            {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Link2 size={17} color="#FFFFFF" />}
            <Text style={styles.assignText}>{saving ? 'Linking…' : 'Link records'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  pageContent: { paddingHorizontal: 18, paddingBottom: 20 },
  header: { flexDirection: 'row', alignItems: 'center', paddingBottom: 20, gap: 12 },
  backButton: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  headerCopy: { flex: 1 },
  eyebrow: { color: colors.primary, fontSize: 9, letterSpacing: 1.5, fontWeight: '800', marginBottom: 4 },
  title: { color: colors.text, fontSize: 23, lineHeight: 28, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: colors.textSecondary, marginTop: 5, fontSize: 12, lineHeight: 17 },
  headerIcon: { width: 43, height: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: '#EAE9FF' },
  infoHero: { overflow: 'hidden', borderRadius: 24, padding: 18, marginBottom: 23 },
  heroIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  heroTitle: { color: '#FFFFFF', fontSize: 18, lineHeight: 23, fontWeight: '800', letterSpacing: -0.25 },
  heroSubtitle: { color: '#E3E1FF', fontSize: 12, lineHeight: 18, marginTop: 6, maxWidth: 330 },
  heroStats: { flexDirection: 'row', alignItems: 'center', marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.18)' },
  heroStat: { flex: 1 },
  heroStatValue: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  heroStatLabel: { color: '#D9D7FF', fontSize: 10, marginTop: 3 },
  heroStatDivider: { width: 1, height: 30, backgroundColor: 'rgba(255,255,255,0.22)', marginHorizontal: 12 },
  heroGlow: { position: 'absolute', width: 170, height: 170, borderRadius: 85, backgroundColor: 'rgba(255,255,255,0.06)', right: -60, top: -60 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  sectionIconWrap: { width: 38, height: 38, borderRadius: 13, backgroundColor: '#EAE9FF', alignItems: 'center', justifyContent: 'center' },
  sectionHeadingCopy: { flex: 1 },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  sectionSubtitle: { color: colors.textSecondary, fontSize: 11, marginTop: 3 },
  sectionCount: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', backgroundColor: colors.card, borderRadius: 10, overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 6 },
  accountList: { gap: 9 },
  accountCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 17, borderWidth: 1, borderColor: colors.border, padding: 12, backgroundColor: colors.card, gap: 11 },
  accountCardChosen: { borderColor: colors.primary, backgroundColor: '#F4F3FF' },
  accountIcon: { width: 43, height: 43, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0F1F8' },
  accountIconChosen: { backgroundColor: colors.primary },
  accountCopy: { flex: 1 },
  accountName: { color: colors.text, fontWeight: '700', fontSize: 13 },
  accountMeta: { color: colors.textSecondary, fontSize: 11, marginTop: 4, textTransform: 'capitalize' },
  radio: { width: 23, height: 23, borderRadius: 12, borderWidth: 1.5, borderColor: '#C8CAD9', alignItems: 'center', justifyContent: 'center' },
  radioChosen: { borderColor: colors.primary, backgroundColor: colors.primary },
  noticeCard: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14, borderRadius: 17, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  noticeIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#EAE9FF', alignItems: 'center', justifyContent: 'center' },
  noticeCopy: { flex: 1 },
  noticeTitle: { color: colors.text, fontWeight: '800', fontSize: 13 },
  noticeText: { color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 4 },
  noticeAction: { width: 32, height: 32, borderRadius: 11, backgroundColor: '#F0EFFF', alignItems: 'center', justifyContent: 'center' },
  transactionSectionHeading: { marginTop: 24, marginBottom: 12 },
  countPill: { minWidth: 31, height: 28, borderRadius: 10, backgroundColor: '#EAE9FF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  countPillText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  transactionPanel: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 13, paddingTop: 2, overflow: 'hidden' },
  panelToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.border },
  panelToolbarCopy: { flex: 1 },
  panelTitle: { color: colors.text, fontWeight: '800', fontSize: 12 },
  panelSubtitle: { color: colors.textSecondary, fontSize: 10, marginTop: 3 },
  selectAllButton: { backgroundColor: '#F0EFFF', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  selectAllText: { color: colors.primary, fontSize: 11, fontWeight: '800' },
  transactionRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, marginHorizontal: -13, paddingHorizontal: 13 },
  transactionRowLast: { borderBottomWidth: 0 },
  transactionRowSelected: { backgroundColor: '#F8F7FF' },
  transactionSelect: { width: 22, height: 22, borderWidth: 1.5, borderColor: '#C8CAD9', borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  transactionSelectActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  transactionIcon: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  transactionIconIncome: { backgroundColor: '#E5F8EF' },
  transactionIconExpense: { backgroundColor: '#FFF2DE' },
  transactionCopy: { flex: 1, minWidth: 0 },
  transactionTitle: { color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '700' },
  transactionMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 5, gap: 4, flexWrap: 'nowrap' },
  transactionMeta: { color: colors.textSecondary, fontSize: 9 },
  metaDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.textLight, marginHorizontal: 1 },
  transactionNotes: { color: colors.textLight, fontSize: 10, marginTop: 4 },
  amountWrap: { alignItems: 'flex-end', justifyContent: 'center', gap: 5, maxWidth: 100 },
  amount: { color: colors.text, fontSize: 11, fontWeight: '800' },
  incomeAmount: { color: colors.success },
  emptyCard: { alignItems: 'center', paddingVertical: 26, paddingHorizontal: 22, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 20 },
  emptyIcon: { width: 54, height: 54, borderRadius: 18, backgroundColor: '#E3F8EE', alignItems: 'center', justifyContent: 'center', marginBottom: 11 },
  emptyTitle: { color: colors.text, fontWeight: '800', fontSize: 15 },
  emptyText: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 6 },
  loadingCard: { alignItems: 'center', justifyContent: 'center', padding: 26, borderRadius: 18, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, gap: 10 },
  loadingText: { color: colors.textSecondary, fontSize: 12 },
  bottomBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 13, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border },
  bottomBarCopy: { flex: 1, minWidth: 0 },
  bottomBarTitle: { color: colors.text, fontWeight: '800', fontSize: 12 },
  bottomBarSubtitle: { color: colors.textSecondary, fontSize: 10, marginTop: 4 },
  assignButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: 14, paddingHorizontal: 15, paddingVertical: 12 },
  assignButtonDisabled: { opacity: 0.42 },
  assignText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
});

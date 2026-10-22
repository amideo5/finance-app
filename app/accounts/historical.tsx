import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { db } from '@/src/firebaseConfig';
import { assignHistoricalTransactions, getAccounts } from '@/src/services/firebase/accountsService';
import { FinanceAccount } from '@/types/finance';
import { useRouter } from 'expo-router';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

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

export default function HistoricalTransactionsScreen() {
  const router = useRouter();
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

  return <View style={styles.container}>
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()}><Text style={styles.back}>‹ Accounts</Text></TouchableOpacity>
      <Text style={styles.title}>Historical transactions</Text>
      <Text style={styles.subtitle}>Link old transactions to the account they used. This changes the account link only—not balances.</Text>
    </View>
    {loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} /> : <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.section}>Choose account</Text>
      {bankAccounts.length === 0 && <Text style={styles.note}>Add a bank or card account first. Cash transactions are handled from the Accounts screen.</Text>}
      {bankAccounts.map(account => <TouchableOpacity key={account.id} style={[styles.account, chosenAccount === account.id && styles.chosen]} onPress={() => setChosenAccount(account.id)}>
        <Text style={styles.accountName}>{account.name}</Text><Text style={styles.radio}>{chosenAccount === account.id ? '●' : '○'}</Text>
      </TouchableOpacity>)}
      <View style={styles.selectionRow}>
        <Text style={styles.section}>Unlinked transactions ({transactions.length})</Text>
        <TouchableOpacity onPress={() => setSelected(selected.length === transactions.length ? [] : transactions.map(t => t.id))}>
          <Text style={styles.action}>{selected.length === transactions.length && transactions.length ? 'Clear' : 'Select all'}</Text>
        </TouchableOpacity>
      </View>
      {transactions.map(tx => <TouchableOpacity key={tx.id} style={styles.tx} onPress={() => toggle(tx.id)}>
        <View style={styles.check}><Text style={styles.checkText}>{selected.includes(tx.id) ? '✓' : ''}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.txTitle}>{tx.category || tx.type || 'Transaction'} · {tx.paymentMode || 'Payment method unknown'}</Text>
          <Text style={styles.txDate}>{tx.date ? new Date(tx.date).toLocaleDateString() : 'Date unavailable'}</Text>
        </View>
        <Text style={styles.amount}>₹{Number(tx.amount || 0).toLocaleString('en-IN')}</Text>
      </TouchableOpacity>)}
      {!transactions.length && <Text style={styles.note}>No unlinked non-cash transactions found.</Text>}
      <TouchableOpacity disabled={saving || !selected.length || !chosenAccount} style={[styles.assignButton, (!selected.length || !chosenAccount || saving) && styles.disabled]} onPress={() => void assign()}>
        <Text style={styles.assignText}>{saving ? 'Linking…' : `Link ${selected.length} selected transaction(s)`}</Text>
      </TouchableOpacity>
    </ScrollView>}
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { padding: 24, paddingTop: 48 },
  back: { color: colors.primary, fontWeight: '600', marginBottom: 14 },
  title: { fontSize: 25, fontWeight: '700', color: colors.text },
  subtitle: { color: colors.textSecondary, marginTop: 8, lineHeight: 20 },
  content: { paddingHorizontal: 24, paddingBottom: 32 },
  section: { color: colors.text, fontWeight: '700', marginTop: 14, marginBottom: 8 },
  account: { flexDirection: 'row', justifyContent: 'space-between', padding: 13, borderRadius: 10, borderWidth: 1, borderColor: colors.border, marginBottom: 8 },
  chosen: { borderColor: colors.primary, backgroundColor: colors.card },
  accountName: { color: colors.text, fontWeight: '600' },
  radio: { color: colors.primary, fontSize: 17 },
  selectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  action: { color: colors.primary, fontWeight: '600' },
  tx: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  check: { width: 22, height: 22, borderWidth: 1, borderColor: colors.primary, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  checkText: { color: colors.primary, fontWeight: '700' },
  txTitle: { color: colors.text, fontWeight: '600' },
  txDate: { color: colors.textSecondary, fontSize: 12, marginTop: 3 },
  amount: { color: colors.text, fontWeight: '600' },
  note: { color: colors.textSecondary, marginVertical: 12 },
  assignButton: { backgroundColor: colors.primary, borderRadius: 12, padding: 15, alignItems: 'center', marginTop: 20 },
  disabled: { opacity: 0.45 },
  assignText: { color: '#fff', fontWeight: '700' },
});

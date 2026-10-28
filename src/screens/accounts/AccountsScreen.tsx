import AccountCard from '@/src/components/finance/AccountCard';
import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { backfillCashTransactions, getAccounts, getOrCreateCashAccount } from '@/src/services/firebase/accountsService';
import { FinanceAccount } from '@/types/finance';
import { useRouter } from 'expo-router';
import { ArrowRight, History, Plus, Wallet, WalletCards } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { formatCurrency } from '@/src/utils/format';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function AccountsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { currentProfile } = useProfile();
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [loading, setLoading] = useState(false);

  const linkHistoricalCash = async () => {
    if (!currentProfile) return;
    try {
      const cash = await getOrCreateCashAccount(currentProfile.id, currentProfile.currency || 'INR');
      const linked = await backfillCashTransactions(currentProfile.id, cash.id);
      await loadAccounts();
      Alert.alert('Historical cash transactions', linked
        ? `Linked ${linked} previous cash transaction(s) to Cash. Balances were not changed.`
        : 'No unlinked cash transactions were found.');
    } catch (error) {
      console.error('Cash transaction migration failed:', error);
      Alert.alert('Migration failed', 'Could not link historical cash transactions. Please try again.');
    }
  };

  const loadAccounts = useCallback(async () => {
    if (!currentProfile) return;

    setLoading(true);
    try {
      setAccounts(await getAccounts(currentProfile.id) as FinanceAccount[]);
    } catch (error) {
      console.error('Error loading accounts:', error);
      Alert.alert('Error', 'Could not load accounts. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [currentProfile]);

  useEffect(() => {
    // Load the selected profile's accounts when the active profile changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAccounts();
  }, [loadAccounts]);

  const totalBalance = accounts.reduce((total, account) => total + Number(account.balance || 0), 0);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.pageContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadAccounts} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.header, { paddingTop: Math.max(insets.top + 8, 26) }]}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>YOUR MONEY, ORGANIZED</Text>
            <Text style={styles.title}>Accounts</Text>
            <Text style={styles.subtitle}>All your balances in one place</Text>
          </View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Add account" style={styles.addButton} onPress={() => router.push('/accounts/add')}>
            <Plus color={colors.card} size={23} />
          </TouchableOpacity>
        </View>

        <LinearGradient colors={['#6157E8', '#4940C9', '#3830A8']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.balanceHero}>
          <View style={styles.balanceHeroTop}>
            <View style={styles.balanceHeroIcon}><Wallet size={19} color="#FFFFFF" /></View>
            <Text style={styles.balanceHeroLabel}>TOTAL ACCOUNT BALANCE</Text>
          </View>
          <Text style={styles.totalBalance}>{formatCurrency(totalBalance, currentProfile?.currency || 'INR')}</Text>
          <View style={styles.balanceHeroFooter}>
            <View>
              <Text style={styles.heroSmallLabel}>Active accounts</Text>
              <Text style={styles.heroSmallValue}>{accounts.length}</Text>
            </View>
            <View style={styles.heroFooterDivider} />
            <View>
              <Text style={styles.heroSmallLabel}>Refresh status</Text>
              <Text style={styles.heroSmallValue}>{loading ? 'Updating…' : 'Up to date'}</Text>
            </View>
          </View>
          <View pointerEvents="none" style={styles.heroGlow} />
        </LinearGradient>

        <View style={styles.sectionHeading}>
          <View>
            <Text style={styles.sectionTitle}>Manage accounts</Text>
            <Text style={styles.sectionSubtitle}>Quick tools for accurate records</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.actionCard} onPress={() => router.push('/accounts/historical')} activeOpacity={0.85}>
          <View style={[styles.actionIcon, { backgroundColor: '#EAE9FF' }]}><History size={20} color={colors.primary} /></View>
          <View style={styles.actionCopy}>
            <Text style={styles.actionTitle}>Historical transactions</Text>
            <Text style={styles.actionSubtitle}>Assign accounts to older records</Text>
          </View>
          <ArrowRight size={18} color={colors.textLight} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionCard} onPress={() => Alert.alert(
          'Link previous cash transactions?',
          'This will associate unlinked transactions marked Cash with your Cash account. It will not change balances. Other payment methods need account-by-account review.',
          [{ text: 'Cancel', style: 'cancel' }, { text: 'Link cash transactions', onPress: () => { void linkHistoricalCash(); } }],
        )} activeOpacity={0.85}>
          <View style={[styles.actionIcon, { backgroundColor: '#E2F8EE' }]}><WalletCards size={20} color="#16875B" /></View>
          <View style={styles.actionCopy}>
            <Text style={styles.actionTitle}>Link cash transactions</Text>
            <Text style={styles.actionSubtitle}>Connect older cash records without changing balances</Text>
          </View>
          <ArrowRight size={18} color={colors.textLight} />
        </TouchableOpacity>

        <View style={[styles.sectionHeading, styles.accountListHeading]}>
          <View>
            <Text style={styles.sectionTitle}>Your accounts</Text>
            <Text style={styles.sectionSubtitle}>{accounts.length} {accounts.length === 1 ? 'account' : 'accounts'} connected</Text>
          </View>
          <TouchableOpacity onPress={() => router.push('/accounts/add')} style={styles.addInlineButton}>
            <Plus size={15} color={colors.primary} /><Text style={styles.addInlineText}>Add new</Text>
          </TouchableOpacity>
        </View>

        {accounts.map((account) => (
          <AccountCard
            key={account.id}
            name={account.name}
            type={account.type}
            balance={account.balance}
            accountNumber={account.account_number ?? undefined}
          />
        ))}
        {accounts.length === 0 && !loading ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}><WalletCards size={25} color={colors.primary} /></View>
            <Text style={styles.emptyTitle}>No accounts yet</Text>
            <Text style={styles.emptyText}>Add a bank, wallet, card or cash account to start tracking balances.</Text>
            <TouchableOpacity style={styles.emptyAddButton} onPress={() => router.push('/accounts/add')}><Plus size={16} color="#FFFFFF" /><Text style={styles.emptyAddText}>Add your first account</Text></TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  pageContent: { paddingHorizontal: 18, paddingTop: 0, paddingBottom: 36 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 26, paddingBottom: 22 },
  headerCopy: { flex: 1, paddingRight: 12 },
  eyebrow: { color: colors.primary, fontSize: 9, letterSpacing: 1.6, fontWeight: '800', marginBottom: 5 },
  title: { fontSize: 29, fontWeight: '800', color: colors.text, letterSpacing: -0.7 },
  subtitle: { color: colors.textSecondary, fontSize: 12, marginTop: 5 },
  addButton: { width: 46, height: 46, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: colors.primary, shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.22, shadowRadius: 9, elevation: 4 },
  balanceHero: { borderRadius: 26, marginBottom: 27, padding: 22, overflow: 'hidden', shadowColor: '#3932A3', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.18, shadowRadius: 18, elevation: 6 },
  balanceHeroTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  balanceHeroIcon: { width: 36, height: 36, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)' },
  balanceHeroLabel: { color: '#DFDDFF', fontSize: 10, letterSpacing: 1.2, fontWeight: '800' },
  totalBalance: { color: '#FFFFFF', fontSize: 31, fontWeight: '800', letterSpacing: -0.8, marginTop: 17 },
  balanceHeroFooter: { flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 23, paddingTop: 17, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.2)' },
  heroSmallLabel: { fontSize: 10, color: '#D4D1FF', marginBottom: 5 },
  heroSmallValue: { fontSize: 13, color: '#FFFFFF', fontWeight: '800' },
  heroFooterDivider: { width: 1, height: 30, backgroundColor: 'rgba(255,255,255,0.24)' },
  heroGlow: { position: 'absolute', width: 170, height: 170, borderRadius: 85, right: -70, top: -85, backgroundColor: 'rgba(255,255,255,0.08)' },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  sectionSubtitle: { color: colors.textSecondary, fontSize: 11, marginTop: 4 },
  actionCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderRadius: 19, padding: 14, marginBottom: 9, borderWidth: 1, borderColor: colors.border },
  actionIcon: { width: 43, height: 43, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  actionCopy: { flex: 1, gap: 4 },
  actionTitle: { color: colors.text, fontSize: 12, fontWeight: '800' },
  actionSubtitle: { color: colors.textSecondary, fontSize: 10, lineHeight: 15 },
  accountListHeading: { marginTop: 20, marginBottom: 13 },
  addInlineButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: '#EAE9FF', borderRadius: 12 },
  addInlineText: { color: colors.primary, fontWeight: '800', fontSize: 11 },
  emptyCard: { alignItems: 'center', paddingHorizontal: 26, paddingVertical: 30, borderRadius: 22, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, marginTop: 3 },
  emptyIcon: { width: 55, height: 55, borderRadius: 19, backgroundColor: '#EAE9FF', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '800', marginBottom: 7 },
  emptyText: { color: colors.textSecondary, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  emptyAddButton: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 14, backgroundColor: colors.primary, marginTop: 18 },
  emptyAddText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
});

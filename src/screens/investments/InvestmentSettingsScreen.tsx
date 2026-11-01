import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { isValidDateKey, toDateKey } from '@/src/services/calculations/investmentGrowth';
import { getAccounts } from '@/src/services/firebase/accountsService';
import { getInvestmentPortfolio, updateInvestmentSettings } from '@/src/services/firebase/investmentsService';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Check, Settings2 } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { toLocalDateKey } from '@/src/utils/validation';

const COMPOUNDING = [
  { value: 'daily', label: 'Daily' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'half_yearly', label: 'Half-yearly' },
  { value: 'annually', label: 'Annually' },
];
const CONTRIBUTIONS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
];

export default function InvestmentSettingsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ investmentId?: string | string[] }>();
  const investmentId = Array.isArray(params.investmentId) ? params.investmentId[0] : params.investmentId;
  const { currentProfile } = useProfile();
  const insets = useSafeAreaInsets();
  const [investment, setInvestment] = useState<any>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [startDate, setStartDate] = useState(toDateKey());
  const [annualRate, setAnnualRate] = useState('');
  const [compoundingFrequency, setCompoundingFrequency] = useState('quarterly');
  const [tenureMonths, setTenureMonths] = useState('');
  const [marketDataId, setMarketDataId] = useState('');
  const [recurringAmount, setRecurringAmount] = useState('');
  const [contributionFrequency, setContributionFrequency] = useState('monthly');
  const [sourceAccountId, setSourceAccountId] = useState('none');
  const [recurringEnabled, setRecurringEnabled] = useState(false);

  const load = useCallback(async () => {
    if (!currentProfile?.id || !investmentId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [portfolio, bankAccounts] = await Promise.all([
        getInvestmentPortfolio(currentProfile.id),
        getAccounts(currentProfile.id),
      ]);
      const found = portfolio.investments.find((item: any) => item.id === investmentId);
      if (!found) throw new Error('This investment could not be found.');
      setInvestment(found);
      setAccounts(bankAccounts.filter((item: any) => String(item.type || '').toLowerCase() === 'bank'));
      const openingEntry = portfolio.transactions.find((item: any) => item.investmentId === found.id && item.type === 'opening_balance');
      setStartDate(found.startDate || openingEntry?.date || toDateKey());
      setAnnualRate(found.annualInterestRatePercent === null || found.annualInterestRatePercent === undefined ? '' : String(found.annualInterestRatePercent));
      setCompoundingFrequency(found.compoundingFrequency || 'quarterly');
      setTenureMonths(found.tenureMonths ? String(found.tenureMonths) : '');
      setMarketDataId(found.marketDataId || '');
      setRecurringAmount(found.recurringContributionAmountInPaise ? String(Number(found.recurringContributionAmountInPaise) / 100) : '');
      setContributionFrequency(found.contributionFrequency || 'monthly');
      setSourceAccountId(found.recurringContributionSourceAccountId || 'none');
      setRecurringEnabled(found.recurringContributionEnabled === true);
    } catch (error) {
      console.error('Could not load investment settings:', error);
      Alert.alert('Could not load settings', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setLoading(false);
    }
  }, [currentProfile?.id, investmentId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const submit = async () => {
    if (!currentProfile?.id || !investmentId || !investment) return;
    if (!isValidDateKey(startDate) || startDate > toLocalDateKey(new Date())) {
      Alert.alert('Check the start date', 'Use a real calendar date that is not in the future (YYYY-MM-DD).');
      return;
    }
    const rate = Number(annualRate);
    if (['fixed_deposit', 'recurring_deposit'].includes(investment.assetClass) && (!annualRate.trim() || !Number.isFinite(rate) || rate < 0 || rate > 100)) {
      Alert.alert('Check the rate', 'Enter an annual interest rate between 0 and 100%.');
      return;
    }
    const tenure = tenureMonths.trim() ? Number(tenureMonths) : null;
    if (tenure !== null && (!Number.isInteger(tenure) || tenure < 1 || tenure > 600)) {
      Alert.alert('Check the tenure', 'Tenure must be between 1 and 600 months, or leave it blank.');
      return;
    }
    const recurringPaise = recurringAmount.trim() ? Math.round(Number(recurringAmount.replace(/,/g, '')) * 100) : 0;
    if (investment.assetClass === 'recurring_deposit' && (!Number.isFinite(recurringPaise) || recurringPaise < 0 || (recurringEnabled && recurringPaise <= 0))) {
      Alert.alert('Check installment amount', 'Enter a positive recurring installment or turn the schedule off.');
      return;
    }

    setSaving(true);
    try {
      const selectedAccount = accounts.find((item) => item.id === sourceAccountId);
      await updateInvestmentSettings(currentProfile.id, investmentId, {
        startDate,
        annualInterestRatePercent: rate,
        compoundingFrequency,
        tenureMonths: tenure,
        marketDataId,
        recurringContributionAmountInPaise: recurringPaise,
        contributionFrequency,
        recurringContributionSourceAccountId: sourceAccountId === 'none' ? null : sourceAccountId,
        recurringContributionSourceAccountName: sourceAccountId === 'none' ? null : (selectedAccount?.name || 'Bank account'),
        recurringContributionEnabled: recurringEnabled,
      });
      Alert.alert('Settings saved', 'Growth calculations and valuation settings have been updated.');
      router.back();
    } catch (error) {
      console.error('Could not save investment settings:', error);
      Alert.alert('Could not save settings', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <View style={styles.loadingScreen}><ActivityIndicator color={colors.primary} /><Text style={styles.helper}>Loading investment settings…</Text></View>;
  }

  if (!investment) {
    return <View style={styles.loadingScreen}><Text style={styles.title}>Investment not found</Text><TouchableOpacity onPress={() => router.back()}><Text style={styles.backText}>Go back</Text></TouchableOpacity></View>;
  }

  const isTerm = ['fixed_deposit', 'recurring_deposit'].includes(investment.assetClass);
  const isRd = investment.assetClass === 'recurring_deposit';
  const isMarket = ['mutual_fund', 'stock'].includes(investment.assetClass);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top + 6, 24), paddingBottom: Math.max(insets.bottom, 18) + 24 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ArrowLeft size={18} color={colors.text} /><Text style={styles.backText}>Investment details</Text>
        </TouchableOpacity>
        <View style={styles.headingIcon}><Settings2 size={25} color={colors.primary} /></View>
        <Text style={styles.title}>Configure growth</Text>
        <Text style={styles.subtitle}>{investment.name} · update the date, rate, recurring schedule or automatic market-price settings.</Text>

        <Text style={styles.label}>INVESTMENT START DATE (YYYY-MM-DD)</Text>
        <TextInput value={startDate} onChangeText={setStartDate} style={styles.input} placeholder="2026-10-29" placeholderTextColor={colors.textLight} />

        {isTerm ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Accrued interest model</Text>
            <View style={styles.twoColumn}>
              <View style={styles.halfField}>
                <Text style={styles.label}>ANNUAL RATE (%)</Text>
                <TextInput value={annualRate} onChangeText={setAnnualRate} style={styles.input} placeholder="7.1" placeholderTextColor={colors.textLight} keyboardType="decimal-pad" />
              </View>
              <View style={styles.halfField}>
                <Text style={styles.label}>TENURE (MONTHS)</Text>
                <TextInput value={tenureMonths} onChangeText={setTenureMonths} style={styles.input} placeholder="Optional" placeholderTextColor={colors.textLight} keyboardType="number-pad" />
              </View>
            </View>
            <Text style={styles.label}>COMPOUNDING FREQUENCY</Text>
            <View style={styles.choiceWrap}>
              {COMPOUNDING.map((item) => <TouchableOpacity key={item.value} style={[styles.choiceChip, compoundingFrequency === item.value && styles.choiceChipSelected]} onPress={() => setCompoundingFrequency(item.value)}><Text style={[styles.choiceText, compoundingFrequency === item.value && styles.choiceTextSelected]}>{item.label}</Text></TouchableOpacity>)}
            </View>
            <Text style={styles.helper}>Changing the start date re-anchors the opening principal entry; subsequent contributions retain their actual dates.</Text>
          </View>
        ) : null}

        {isRd ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Recurring installment schedule</Text>
            <Text style={styles.label}>INSTALLMENT AMOUNT (₹)</Text>
            <TextInput value={recurringAmount} onChangeText={setRecurringAmount} style={styles.input} placeholder="e.g. 2000" placeholderTextColor={colors.textLight} keyboardType="decimal-pad" />
            <Text style={styles.label}>FREQUENCY</Text>
            <View style={styles.choiceWrap}>
              {CONTRIBUTIONS.map((item) => <TouchableOpacity key={item.value} style={[styles.choiceChip, contributionFrequency === item.value && styles.choiceChipSelected]} onPress={() => setContributionFrequency(item.value)}><Text style={[styles.choiceText, contributionFrequency === item.value && styles.choiceTextSelected]}>{item.label}</Text></TouchableOpacity>)}
            </View>
            <TouchableOpacity style={styles.toggleRow} onPress={() => setRecurringEnabled((value) => !value)}>
              <View style={[styles.checkbox, recurringEnabled && styles.checkboxOn]}>{recurringEnabled ? <Check size={13} color="#FFFFFF" /> : null}</View>
              <View style={{ flex: 1 }}><Text style={styles.toggleTitle}>Automatically record installments</Text><Text style={styles.helper}>Catch up due installments when the app opens.</Text></View>
            </TouchableOpacity>
            <Text style={styles.label}>SOURCE ACCOUNT</Text>
            <View style={styles.accountChoices}>
              <TouchableOpacity style={[styles.accountChoice, sourceAccountId === 'none' && styles.accountChoiceSelected]} onPress={() => setSourceAccountId('none')}>
                <Text style={[styles.accountChoiceName, sourceAccountId === 'none' && styles.accountChoiceNameSelected]}>No source · portfolio-only</Text><Text style={styles.accountChoiceMeta}>No bank balance or daily transaction changes.</Text>
              </TouchableOpacity>
              {accounts.map((account) => <TouchableOpacity key={account.id} style={[styles.accountChoice, sourceAccountId === account.id && styles.accountChoiceSelected]} onPress={() => setSourceAccountId(account.id)}><Text style={[styles.accountChoiceName, sourceAccountId === account.id && styles.accountChoiceNameSelected]}>{account.name || 'Bank account'}</Text><Text style={styles.accountChoiceMeta}>Tracked balance: ₹{Number(account.balance || 0).toLocaleString('en-IN')}</Text></TouchableOpacity>)}
            </View>
            <Text style={styles.helper}>A linked source debits the app's tracked balance only; no real bank mandate or external debit is created.</Text>
          </View>
        ) : null}

        {isMarket ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Automatic market valuation</Text>
            <Text style={styles.helper}>{investment.assetClass === 'mutual_fund' ? 'Search MFAPI for the scheme code, then the latest published NAV will be multiplied by your units.' : 'Enter an Alpha Vantage ticker. Stock quotes are fetched securely through the Supabase stock-quote Edge Function.'}</Text>
            <Text style={styles.label}>{investment.assetClass === 'mutual_fund' ? 'MFAPI SCHEME CODE' : 'EXCHANGE TICKER'}</Text>
            <TextInput value={marketDataId} onChangeText={setMarketDataId} style={styles.input} placeholder={investment.assetClass === 'mutual_fund' ? 'e.g. 125497' : 'e.g. RELIANCE.BSE'} placeholderTextColor={colors.textLight} autoCapitalize="characters" />
            {investment.assetClass === 'mutual_fund' && !Number(investment.units) ? <Text style={styles.warning}>This holding has no units stored, so NAV cannot calculate the value. Existing units must be added to the holding before automatic valuation is useful.</Text> : null}
          </View>
        ) : null}

        <View style={styles.infoBox}><Text style={styles.infoTitle}>How automatic updates work</Text><Text style={styles.infoText}>FD/RD accruals are calculated at read time and do not create daily fake transactions. Market assets record an idempotent valuation entry when a fresh provider date is available. RD due events are caught up on the next app open, not by a background job while the app is closed.</Text></View>

        <TouchableOpacity style={[styles.saveButton, saving && styles.disabledButton]} onPress={() => { void submit(); }} disabled={saving}>
          <Check size={17} color="#FFFFFF" /><Text style={styles.saveButtonText}>{saving ? 'Saving settings…' : 'Save growth settings'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20 },
  loadingScreen: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  backButton: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 22, alignSelf: 'flex-start' },
  backText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  headingIcon: { width: 54, height: 54, borderRadius: 18, backgroundColor: '#EAE9FF', alignItems: 'center', justifyContent: 'center', marginBottom: 13 },
  title: { color: colors.text, fontSize: 25, fontWeight: '800', letterSpacing: -0.6 },
  subtitle: { color: colors.textSecondary, fontSize: 11, lineHeight: 17, marginTop: 7, marginBottom: 20 },
  label: { color: colors.textSecondary, fontSize: 9, fontWeight: '800', letterSpacing: 0.8, marginBottom: 8, marginTop: 13 },
  input: { minHeight: 47, borderRadius: 13, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, paddingHorizontal: 13, color: colors.text, fontSize: 12 },
  twoColumn: { flexDirection: 'row', gap: 10 },
  halfField: { flex: 1 },
  panel: { backgroundColor: colors.card, borderRadius: 16, padding: 14, marginTop: 17, borderWidth: 1, borderColor: colors.border },
  panelTitle: { color: colors.text, fontSize: 13, fontWeight: '800', marginBottom: 5 },
  choiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 7 },
  choiceChip: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  choiceChipSelected: { borderColor: colors.primary, backgroundColor: '#EAE9FF' },
  choiceText: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
  choiceTextSelected: { color: colors.primary },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, marginTop: 7 },
  checkbox: { width: 21, height: 21, borderRadius: 7, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  toggleTitle: { color: colors.text, fontSize: 11, fontWeight: '800' },
  accountChoices: { gap: 7 },
  accountChoice: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, borderRadius: 12, padding: 11 },
  accountChoiceSelected: { borderColor: colors.primary, backgroundColor: '#F0EFFF' },
  accountChoiceName: { color: colors.text, fontSize: 11, fontWeight: '800' },
  accountChoiceNameSelected: { color: colors.primary },
  accountChoiceMeta: { color: colors.textSecondary, fontSize: 9, marginTop: 4 },
  helper: { color: colors.textLight, fontSize: 9, lineHeight: 14, marginTop: 6 },
  warning: { color: colors.danger, fontSize: 10, lineHeight: 15, marginTop: 9 },
  infoBox: { backgroundColor: '#EAE9FF', borderRadius: 15, padding: 14, marginTop: 20 },
  infoTitle: { color: colors.primaryDark, fontSize: 11, fontWeight: '800' },
  infoText: { color: '#5A55A4', fontSize: 10, lineHeight: 15, marginTop: 5 },
  saveButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 51, borderRadius: 15, backgroundColor: colors.primary, marginTop: 18 },
  saveButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  disabledButton: { opacity: 0.6 },
});

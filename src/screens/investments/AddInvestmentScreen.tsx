import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { addInvestment } from '@/src/services/firebase/investmentsService';
import { getAccounts } from '@/src/services/firebase/accountsService';
import { isValidDateKey, toDateKey } from '@/src/services/calculations/investmentGrowth';
import { searchMutualFundSchemes } from '@/src/services/marketData/investmentPrices';
import { useRouter } from 'expo-router';
import { ArrowLeft, Check, Landmark, Plus } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ASSET_CLASSES = [
  { value: 'fixed_deposit', label: 'Fixed Deposit', icon: '🏦' },
  { value: 'recurring_deposit', label: 'Recurring Deposit', icon: '🗓️' },
  { value: 'mutual_fund', label: 'Mutual Fund', icon: '📊' },
  { value: 'stock', label: 'Stock', icon: '📈' },
  { value: 'other', label: 'Other asset', icon: '💼' },
];

const parseAmountPaise = (input: string) => {
  const value = Number(input.replace(/,/g, '').trim());
  return input.trim() !== '' && Number.isFinite(value) && value >= 0
    ? Math.round(value * 100)
    : null;
};

const parseAmountOrZeroPaise = (input: string) => {
  if (!input.trim()) return 0;
  return parseAmountPaise(input);
};

export default function AddInvestmentScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { currentProfile } = useProfile();

  const [name, setName] = useState('');
  const [assetClass, setAssetClass] = useState('mutual_fund');
  const [startDate, setStartDate] = useState(toDateKey());
  const [annualRate, setAnnualRate] = useState('7');
  const [compoundingFrequency, setCompoundingFrequency] = useState('quarterly');
  const [tenureMonths, setTenureMonths] = useState('12');
  const [recurringAmount, setRecurringAmount] = useState('');
  const [contributionFrequency, setContributionFrequency] = useState('monthly');
  const [sourceAccountId, setSourceAccountId] = useState('none');
  const [accounts, setAccounts] = useState<any[]>([]);
  const [marketDataId, setMarketDataId] = useState('');
  const [schemeQuery, setSchemeQuery] = useState('');
  const [schemeResults, setSchemeResults] = useState<Array<{ schemeCode: number; schemeName: string }>>([]);
  const [searchingSchemes, setSearchingSchemes] = useState(false);
  const [provider, setProvider] = useState('');
  const [symbol, setSymbol] = useState('');
  const [investedAmount, setInvestedAmount] = useState('');
  const [currentValue, setCurrentValue] = useState('');
  const [units, setUnits] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    if (!currentProfile?.id) {
      setAccounts([]);
      return () => { mounted = false; };
    }
    getAccounts(currentProfile.id)
      .then((rows: any[]) => {
        if (mounted) setAccounts(rows.filter((item) => String(item.type || '').toLowerCase() === 'bank'));
      })
      .catch((error) => console.warn('Could not load bank accounts for RD source:', error));
    return () => { mounted = false; };
  }, [currentProfile?.id]);

  const lookupSchemes = async () => {
    const query = schemeQuery.trim() || name.trim();
    if (query.length < 2) {
      Alert.alert('Search mutual funds', 'Enter a fund name or AMC with at least two characters.');
      return;
    }
    setSearchingSchemes(true);
    try {
      setSchemeResults(await searchMutualFundSchemes(query));
    } catch (error) {
      Alert.alert('Could not search schemes', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSearchingSchemes(false);
    }
  };

  const submit = async () => {
    const isTermAssetClass = ['fixed_deposit', 'recurring_deposit'].includes(assetClass);
    const investedInPaise = parseAmountOrZeroPaise(investedAmount);
    // Term values are calculated from principal + dated cash flows, not a manual mark.
    const currentInPaise = isTermAssetClass
      ? investedInPaise
      : currentValue.trim()
        ? parseAmountPaise(currentValue)
        : investedInPaise;
    const recurringInPaise = parseAmountOrZeroPaise(recurringAmount);

    if (!currentProfile) return;

    if (!isValidDateKey(startDate)) {
      Alert.alert('Check the start date', 'Use a real calendar date in YYYY-MM-DD format.');
      return;
    }

    if (!name.trim()) {
      Alert.alert(
        'Investment name required',
        'Enter a name to identify this holding.',
      );
      return;
    }

    if (
      investedInPaise === null ||
      currentInPaise === null ||
      recurringInPaise === null ||
      (assetClass !== 'recurring_deposit' && investedInPaise <= 0) ||
      (assetClass === 'recurring_deposit' && investedInPaise === 0 && currentInPaise === 0 && recurringInPaise <= 0)
    ) {
      Alert.alert(
        'Check the amounts',
        assetClass === 'recurring_deposit'
          ? 'Enter an initial amount or a recurring installment greater than zero.'
          : 'Enter a positive invested amount and a valid current value.',
      );
      return;
    }

    const parsedUnits = units.trim() ? Number(units) : null;
    if (parsedUnits !== null && (!Number.isFinite(parsedUnits) || parsedUnits < 0)) {
      Alert.alert('Check units', 'Units or quantity must be a positive number.');
      return;
    }
    const parsedRate = Number(annualRate);
    if (['fixed_deposit', 'recurring_deposit'].includes(assetClass) && (!Number.isFinite(parsedRate) || parsedRate < 0 || parsedRate > 100)) {
      Alert.alert('Check the rate', 'Enter an annual interest rate between 0 and 100%.');
      return;
    }
    const parsedTenure = tenureMonths.trim() ? Number(tenureMonths) : null;
    if (parsedTenure !== null && (!Number.isInteger(parsedTenure) || parsedTenure < 1 || parsedTenure > 600)) {
      Alert.alert('Check the tenure', 'Tenure must be between 1 and 600 months, or leave it blank.');
      return;
    }
    if (assetClass === 'recurring_deposit' && recurringInPaise <= 0) {
      Alert.alert('RD installment required', 'Enter a positive recurring installment amount.');
      return;
    }

    setSaving(true);

    try {
      await addInvestment(currentProfile.id, {
        name: name.trim(),
        assetClass,
        provider: provider.trim() || null,
        symbol: symbol.trim().toUpperCase() || null,
        marketDataId: marketDataId.trim() || null,
        units: parsedUnits,
        notes: notes.trim() || null,
        startDate,
        annualInterestRatePercent: ['fixed_deposit', 'recurring_deposit'].includes(assetClass) ? parsedRate : null,
        compoundingFrequency: ['fixed_deposit', 'recurring_deposit'].includes(assetClass) ? compoundingFrequency : null,
        tenureMonths: parsedTenure,
        contributionFrequency: assetClass === 'recurring_deposit' ? contributionFrequency : null,
        recurringContributionAmountInPaise: assetClass === 'recurring_deposit' ? recurringInPaise : 0,
        recurringContributionSourceAccountId: assetClass === 'recurring_deposit' && sourceAccountId !== 'none' ? sourceAccountId : null,
        recurringContributionSourceAccountName: assetClass === 'recurring_deposit' && sourceAccountId !== 'none' ? (accounts.find((item) => item.id === sourceAccountId)?.name || 'Bank account') : null,
        investedAmountInPaise: investedInPaise,
        currentValueInPaise: isTermAssetClass ? investedInPaise : currentInPaise,
        currency: currentProfile.currency || 'INR',
      });

      router.back();
    } catch (error) {
      console.error('Could not create investment:', error);
      Alert.alert(
        'Could not add investment',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Math.max(insets.top + 6, 24),
            paddingBottom: Math.max(insets.bottom, 18) + 24,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <ArrowLeft size={18} color={colors.text} />
          <Text style={styles.backText}>Portfolio</Text>
        </TouchableOpacity>

        <View style={styles.headingIcon}>
          <Landmark color={colors.primary} size={25} />
        </View>

        <Text style={styles.title}>Add an investment</Text>
        <Text style={styles.subtitle}>
          Track investment cash flows separately, with automatic accrued-value or market-price estimates where configured.
        </Text>

        <Text style={styles.label}>START DATE (YYYY-MM-DD) *</Text>
        <TextInput
          value={startDate}
          onChangeText={setStartDate}
          placeholder="2026-10-29"
          placeholderTextColor={colors.textLight}
          style={styles.input}
          autoCapitalize="none"
        />
        <Text style={styles.helper}>Used as the anchor date for accruals and recurring RD installments.</Text>

        <Text style={styles.label}>ASSET CLASS</Text>
        <View style={styles.assetGrid}>
          {ASSET_CLASSES.map((item) => {
            const selected = assetClass === item.value;

            return (
              <TouchableOpacity
                key={item.value}
                onPress={() => setAssetClass(item.value)}
                activeOpacity={0.85}
                style={[
                  styles.assetOption,
                  selected && styles.assetOptionSelected,
                ]}
              >
                <Text style={styles.assetEmoji}>{item.icon}</Text>
                <Text
                  style={[
                    styles.assetLabel,
                    selected && styles.assetLabelSelected,
                  ]}
                >
                  {item.label}
                </Text>
                {selected ? (
                  <Check size={14} color={colors.primary} />
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.label}>INVESTMENT NAME *</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. HDFC Flexi Cap Fund"
          placeholderTextColor={colors.textLight}
          style={styles.input}
          maxLength={90}
        />

        <View style={styles.twoColumn}>
          <View style={styles.halfField}>
            <Text style={styles.label}>BANK / PROVIDER</Text>
            <TextInput
              value={provider}
              onChangeText={setProvider}
              placeholder="e.g. HDFC"
              placeholderTextColor={colors.textLight}
              style={styles.input}
            />
          </View>

          <View style={styles.halfField}>
            <Text style={styles.label}>FOLIO / DISPLAY SYMBOL</Text>
            <TextInput
              value={symbol}
              onChangeText={setSymbol}
              placeholder="Optional"
              placeholderTextColor={colors.textLight}
              style={styles.input}
              autoCapitalize="characters"
            />
          </View>
        </View>

        <View style={styles.twoColumn}>
          <View style={[styles.halfField, ['fixed_deposit', 'recurring_deposit'].includes(assetClass) && { flex: 1 }]}>
            <Text style={styles.label}>{assetClass === 'recurring_deposit' ? 'INITIAL DEPOSIT (₹)' : 'NET INVESTED / PRINCIPAL (₹) *'}</Text>
            <TextInput
              value={investedAmount}
              onChangeText={setInvestedAmount}
              placeholder={assetClass === 'recurring_deposit' ? 'Optional initial deposit' : '10000'}
              placeholderTextColor={colors.textLight}
              keyboardType="decimal-pad"
              style={styles.input}
            />
          </View>

          {!['fixed_deposit', 'recurring_deposit'].includes(assetClass) ? (
            <View style={styles.halfField}>
              <Text style={styles.label}>CURRENT VALUE (₹)</Text>
              <TextInput
                value={currentValue}
                onChangeText={setCurrentValue}
                placeholder={investedAmount || '10000'}
                placeholderTextColor={colors.textLight}
                keyboardType="decimal-pad"
                style={styles.input}
              />
            </View>
          ) : null}
        </View>

        <Text style={styles.helper}>
          {['fixed_deposit', 'recurring_deposit'].includes(assetClass)
            ? 'Current value and estimated interest are calculated automatically from the principal, start date, rate and dated contributions.'
            : 'Current value defaults to net invested when left blank. Amounts are stored in paise for accurate totals.'}
        </Text>

        {['fixed_deposit', 'recurring_deposit'].includes(assetClass) ? (
          <View style={styles.termPanel}>
            <Text style={styles.panelTitle}>Interest and term</Text>
            <View style={styles.twoColumn}>
              <View style={styles.halfField}>
                <Text style={styles.label}>ANNUAL RATE (%) *</Text>
                <TextInput
                  value={annualRate}
                  onChangeText={setAnnualRate}
                  placeholder="7.1"
                  placeholderTextColor={colors.textLight}
                  keyboardType="decimal-pad"
                  style={styles.input}
                />
              </View>
              <View style={styles.halfField}>
                <Text style={styles.label}>TENURE (MONTHS)</Text>
                <TextInput
                  value={tenureMonths}
                  onChangeText={setTenureMonths}
                  placeholder="12 (optional)"
                  placeholderTextColor={colors.textLight}
                  keyboardType="number-pad"
                  style={styles.input}
                />
              </View>
            </View>
            <Text style={styles.label}>COMPOUNDING FREQUENCY</Text>
            <View style={styles.choiceWrap}>
              {[['daily', 'Daily'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['half_yearly', 'Half-yearly'], ['annually', 'Annually']].map(([value, label]) => (
                <TouchableOpacity
                  key={value}
                  style={[styles.choiceChip, compoundingFrequency === value && styles.choiceChipSelected]}
                  onPress={() => setCompoundingFrequency(value)}
                >
                  <Text style={[styles.choiceText, compoundingFrequency === value && styles.choiceTextSelected]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.helper}>The app calculates estimated accrued value and interest for each elapsed day from dated ledger cash flows. Actual bank terms, taxes and premature-closure rules may differ.</Text>
          </View>
        ) : null}

        {assetClass === 'recurring_deposit' ? (
          <View style={styles.termPanel}>
            <Text style={styles.panelTitle}>Recurring installment</Text>
            <Text style={styles.label}>INSTALLMENT AMOUNT (₹) *</Text>
            <TextInput
              value={recurringAmount}
              onChangeText={setRecurringAmount}
              placeholder="e.g. 2000"
              placeholderTextColor={colors.textLight}
              keyboardType="decimal-pad"
              style={styles.input}
            />
            <Text style={styles.label}>ADD MONEY EVERY</Text>
            <View style={styles.choiceWrap}>
              {[['weekly', 'Weekly'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly']].map(([value, label]) => (
                <TouchableOpacity
                  key={value}
                  style={[styles.choiceChip, contributionFrequency === value && styles.choiceChipSelected]}
                  onPress={() => setContributionFrequency(value)}
                >
                  <Text style={[styles.choiceText, contributionFrequency === value && styles.choiceTextSelected]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.label}>SOURCE ACCOUNT</Text>
            <View style={styles.accountChoices}>
              <TouchableOpacity
                style={[styles.accountChoice, sourceAccountId === 'none' && styles.accountChoiceSelected]}
                onPress={() => setSourceAccountId('none')}
              >
                <Text style={[styles.accountChoiceName, sourceAccountId === 'none' && styles.accountChoiceNameSelected]}>No source · track only</Text>
                <Text style={styles.accountChoiceMeta}>Does not change a bank balance</Text>
              </TouchableOpacity>
              {accounts.map((account) => (
                <TouchableOpacity
                  key={account.id}
                  style={[styles.accountChoice, sourceAccountId === account.id && styles.accountChoiceSelected]}
                  onPress={() => setSourceAccountId(account.id)}
                >
                  <Text style={[styles.accountChoiceName, sourceAccountId === account.id && styles.accountChoiceNameSelected]}>{account.name || 'Bank account'}</Text>
                  <Text style={styles.accountChoiceMeta}>Available balance: ₹{Number(account.balance || 0).toLocaleString('en-IN')}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.helper}>Due installments are caught up when you open the app. A linked source updates only this app's tracked account balance; it does not trigger a real bank debit or mandate.</Text>
          </View>
        ) : null}

        {assetClass === 'mutual_fund' ? (
          <View style={styles.termPanel}>
            <Text style={styles.panelTitle}>Automatic NAV valuation</Text>
            <Text style={styles.helper}>Enter the MFAPI scheme code and the number of units held. The latest published NAV will be fetched daily when you open the portfolio.</Text>
            <Text style={styles.label}>MFAPI SCHEME CODE</Text>
            <TextInput
              value={marketDataId}
              onChangeText={setMarketDataId}
              placeholder="e.g. 125497"
              placeholderTextColor={colors.textLight}
              keyboardType="number-pad"
              style={styles.input}
            />
            <View style={styles.twoColumn}>
              <View style={[styles.halfField, { flex: 1.2 }]}>
                <TextInput
                  value={schemeQuery}
                  onChangeText={setSchemeQuery}
                  placeholder="Search scheme name"
                  placeholderTextColor={colors.textLight}
                  style={styles.input}
                />
              </View>
              <TouchableOpacity style={styles.searchButton} onPress={() => { void lookupSchemes(); }} disabled={searchingSchemes}>
                <Text style={styles.searchButtonText}>{searchingSchemes ? 'Searching…' : 'Find scheme'}</Text>
              </TouchableOpacity>
            </View>
            {schemeResults.map((scheme) => (
              <TouchableOpacity
                key={scheme.schemeCode}
                style={styles.schemeResult}
                onPress={() => {
                  setMarketDataId(String(scheme.schemeCode));
                  if (!name.trim()) setName(scheme.schemeName);
                  setSchemeResults([]);
                }}
              >
                <Text style={styles.schemeResultName}>{scheme.schemeName}</Text>
                <Text style={styles.schemeResultCode}>Code {scheme.schemeCode} · Tap to select</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {assetClass === 'stock' ? (
          <View style={styles.termPanel}>
            <Text style={styles.panelTitle}>Automatic stock valuation</Text>
            <Text style={styles.helper}>Enter the provider ticker, for example RELIANCE.BSE. Add an Alpha Vantage API key to your local environment to enable daily quotes. Units / quantity is the number of shares.</Text>
            <Text style={styles.label}>EXCHANGE TICKER</Text>
            <TextInput
              value={marketDataId}
              onChangeText={setMarketDataId}
              placeholder="e.g. RELIANCE.BSE"
              placeholderTextColor={colors.textLight}
              style={styles.input}
              autoCapitalize="characters"
            />
          </View>
        ) : null}

        <Text style={styles.label}>UNITS / QUANTITY (OPTIONAL)</Text>
        <TextInput
          value={units}
          onChangeText={setUnits}
          placeholder="e.g. 12.5 units or 10 shares"
          placeholderTextColor={colors.textLight}
          keyboardType="decimal-pad"
          style={styles.input}
        />

        <Text style={styles.label}>NOTES (OPTIONAL)</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Maturity date, folio details, etc."
          placeholderTextColor={colors.textLight}
          style={[styles.input, styles.notesInput]}
          multiline
          textAlignVertical="top"
        />

        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>
            Want to fund it from a bank account?
          </Text>
          <Text style={styles.infoText}>
            Create the holding here, then use “Transfer in” from the portfolio.
            That action debits the account and records both sides atomically.
          </Text>
        </View>

        <TouchableOpacity
          onPress={() => {
            void submit();
          }}
          disabled={saving}
          style={[styles.saveButton, saving && styles.buttonDisabled]}
          activeOpacity={0.85}
        >
          <Plus size={17} color="#FFFFFF" />
          <Text style={styles.saveButtonText}>
            {saving ? 'Saving investment…' : 'Create investment'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20 },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 22,
    alignSelf: 'flex-start',
  },
  backText: { color: colors.text, fontWeight: '700', fontSize: 12 },
  headingIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: '#EAE9FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 13,
  },
  title: {
    color: colors.text,
    fontSize: 25,
    letterSpacing: -0.6,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 7,
    marginBottom: 23,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.9,
    marginBottom: 8,
    marginTop: 13,
  },
  assetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  assetOption: {
    width: '48%',
    flexGrow: 1,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 11,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  assetOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: '#F0EFFF',
  },
  assetEmoji: { fontSize: 17 },
  assetLabel: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    flex: 1,
  },
  assetLabelSelected: { color: colors.primary },
  input: {
    height: 48,
    borderRadius: 13,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: 13,
    color: colors.text,
    fontSize: 12,
  },
  twoColumn: { flexDirection: 'row', gap: 10 },
  halfField: { flex: 1 },
  helper: {
    color: colors.textLight,
    fontSize: 9,
    lineHeight: 14,
    marginTop: 7,
  },
  notesInput: { height: 86, paddingTop: 12 },
  termPanel: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 14,
    marginTop: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  panelTitle: { color: colors.text, fontSize: 13, fontWeight: '800', marginBottom: 4 },
  choiceWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 7 },
  choiceChip: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  choiceChipSelected: { borderColor: colors.primary, backgroundColor: '#EAE9FF' },
  choiceText: { color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
  choiceTextSelected: { color: colors.primary },
  accountChoices: { gap: 7 },
  accountChoice: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, borderRadius: 12, padding: 11 },
  accountChoiceSelected: { borderColor: colors.primary, backgroundColor: '#F0EFFF' },
  accountChoiceName: { color: colors.text, fontSize: 11, fontWeight: '800' },
  accountChoiceNameSelected: { color: colors.primary },
  accountChoiceMeta: { color: colors.textSecondary, fontSize: 9, marginTop: 4 },
  searchButton: { alignItems: 'center', justifyContent: 'center', borderRadius: 12, paddingHorizontal: 14, backgroundColor: colors.primary },
  searchButtonText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  schemeResult: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 10, marginTop: 7, backgroundColor: colors.background },
  schemeResultName: { color: colors.text, fontSize: 10, fontWeight: '700' },
  schemeResultCode: { color: colors.primary, fontSize: 9, fontWeight: '700', marginTop: 4 },
  infoBox: {
    backgroundColor: '#EAE9FF',
    borderRadius: 15,
    padding: 14,
    marginTop: 20,
  },
  infoTitle: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: '800',
  },
  infoText: {
    color: '#5A55A4',
    fontSize: 10,
    lineHeight: 15,
    marginTop: 5,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 51,
    borderRadius: 15,
    backgroundColor: colors.primary,
    marginTop: 18,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  buttonDisabled: { opacity: 0.6 },
});
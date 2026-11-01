import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { useAuth } from '@/src/context/AuthContext';
import { addInvestment } from '@/src/services/firebase/investmentsService';
import { getAccounts } from '@/src/services/firebase/accountsService';
import { isValidDateKey, toDateKey } from '@/src/services/calculations/investmentGrowth';
import { fetchMutualFundHistoricalNav, fetchStockHistoricalPrice, searchMutualFundSchemes, searchStocks } from '@/src/services/marketData/investmentPrices';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Check, Landmark, Plus } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
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
  const params = useLocalSearchParams<{ fundingAccountId?: string | string[] }>();
  const routeFundingAccountId = Array.isArray(params.fundingAccountId)
    ? params.fundingAccountId[0]
    : params.fundingAccountId;
  const insets = useSafeAreaInsets();
  const { currentProfile } = useProfile();
  const { user } = useAuth();
  const fundingOperationIdRef = useRef<string | null>(null);

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
  const fundingAccount = accounts.find((account) => account.id === routeFundingAccountId);
  const isBankFundedCreation = Boolean(routeFundingAccountId);
  const [marketDataId, setMarketDataId] = useState('');
  const [schemeQuery, setSchemeQuery] = useState('');
  const [schemeResults, setSchemeResults] = useState<Array<{ schemeCode: number; schemeName: string }>>([]);
  const [searchingSchemes, setSearchingSchemes] = useState(false);
  const [stockQuery, setStockQuery] = useState('');
  const [stockResults, setStockResults] = useState<Array<{ symbol: string; name: string; region: string; currency: string; exchange: string; type: string }>>([]);
  const [searchingStocks, setSearchingStocks] = useState(false);
  const [historicalPriceLoading, setHistoricalPriceLoading] = useState(false);
  const [historicalPriceError, setHistoricalPriceError] = useState('');
  const [purchasePriceDate, setPurchasePriceDate] = useState('');
  const [purchasePriceLabel, setPurchasePriceLabel] = useState('');
  const [manualExecutionPrice, setManualExecutionPrice] = useState(false);
  const [provider, setProvider] = useState('');
  const [symbol, setSymbol] = useState('');
  const [investedAmount, setInvestedAmount] = useState('');
  const [currentValue, setCurrentValue] = useState('');
  const [units, setUnits] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [transactionCharges, setTransactionCharges] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const marketPurchasePreview = (() => {
    if (!['stock', 'mutual_fund'].includes(assetClass)) return null;
    const budget = Number(investedAmount.replace(/,/g, ''));
    const price = Number(purchasePrice);
    const fee = Number(transactionCharges.replace(/,/g, '')) || 0;
    if (!Number.isFinite(budget) || !Number.isFinite(price) || budget <= 0 || price <= 0) return null;
    const enteredQuantity = units.trim() ? Number(units) : null;
    const quantity = enteredQuantity !== null
      ? enteredQuantity
      : assetClass === 'stock'
        ? Math.floor(Math.max(0, budget - fee) / price)
        : Math.floor((Math.max(0, budget - fee) / price) * 1_000_000) / 1_000_000;
    if (!Number.isFinite(quantity) || quantity <= 0) return null;
    const tradeValue = quantity * price;
    return { quantity, tradeValue, totalCost: tradeValue + fee, unspent: Math.max(0, budget - tradeValue - fee) };
  })();

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

  useEffect(() => {
    if (assetClass !== 'stock' || !marketDataId || manualExecutionPrice || !isValidDateKey(startDate) || startDate > toDateKey()) {
      return;
    }
    let active = true;
    setHistoricalPriceLoading(true);
    setHistoricalPriceError('');
    setPurchasePrice('');
    setPurchasePriceDate('');
    fetchStockHistoricalPrice(marketDataId, startDate)
      .then((result) => {
        if (!active) return;
        setPurchasePrice(String(result.price));
        setPurchasePriceDate(result.date);
        setHistoricalPriceError('');
      })
      .catch((error) => {
        if (!active) return;
        setHistoricalPriceError(error instanceof Error ? error.message : 'Could not load the historical closing price.');
      })
      .finally(() => {
        if (active) setHistoricalPriceLoading(false);
      });
    return () => { active = false; };
  }, [assetClass, marketDataId, startDate, manualExecutionPrice]);

  useEffect(() => {
    if (assetClass !== 'mutual_fund' || !marketDataId || manualExecutionPrice || !isValidDateKey(startDate) || startDate > toDateKey()) {
      return;
    }
    let active = true;
    setHistoricalPriceLoading(true);
    setHistoricalPriceError('');
    setPurchasePrice('');
    setPurchasePriceDate('');
    setPurchasePriceLabel('');
    fetchMutualFundHistoricalNav(marketDataId, startDate)
      .then((result) => {
        if (!active) return;
        setPurchasePrice(String(result.price));
        setPurchasePriceDate(result.date);
        setPurchasePriceLabel(result.label);
        setHistoricalPriceError('');
      })
      .catch((error) => {
        if (!active) return;
        setHistoricalPriceError(error instanceof Error ? error.message : 'Could not load the historical mutual-fund NAV.');
      })
      .finally(() => {
        if (active) setHistoricalPriceLoading(false);
      });
    return () => { active = false; };
  }, [assetClass, marketDataId, startDate, manualExecutionPrice]);

  const lookupStocks = async () => {
    const query = stockQuery.trim();
    if (query.length < 2) {
      Alert.alert('Search stocks', 'Enter a company name or ticker with at least two characters.');
      return;
    }
    setSearchingStocks(true);
    setStockResults([]);
    try {
      const results = await searchStocks(query);
      setStockResults(results);
      if (!results.length) Alert.alert('No matching stocks', 'Try a different company name or ticker.');
    } catch (error) {
      Alert.alert('Could not search stocks', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSearchingStocks(false);
    }
  };

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
    const transactionChargesInPaise = parseAmountOrZeroPaise(transactionCharges);

    if (!currentProfile) return;

    if (!isValidDateKey(startDate) || startDate > toDateKey()) {
      Alert.alert('Check the investment date', 'Use a valid date that is not in the future (YYYY-MM-DD).');
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
      transactionChargesInPaise === null ||
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

    const isMarketAsset = ['stock', 'mutual_fund'].includes(assetClass);
    const parsedUnits = units.trim() ? Number(units) : null;
    const parsedPurchasePrice = Number(purchasePrice);
    if (parsedUnits !== null && (!Number.isFinite(parsedUnits) || parsedUnits <= 0)) {
      Alert.alert('Check units', 'Enter a quantity greater than zero, or leave it blank to calculate automatically.');
      return;
    }
    if (assetClass === 'stock' && parsedUnits !== null && !Number.isInteger(parsedUnits)) {
      Alert.alert('Whole shares required', 'Regular stock purchases must use a whole number of shares.');
      return;
    }
    if (isMarketAsset && (!Number.isFinite(parsedPurchasePrice) || parsedPurchasePrice <= 0)) {
      Alert.alert('Purchase price unavailable', assetClass === 'stock' ? 'Wait for the historical closing price to load, or enter the execution price from your broker contract note.' : 'Wait for the historical NAV to load, or enter the actual allotment NAV from your AMC statement.');
      return;
    }
    if (assetClass === 'mutual_fund' && manualExecutionPrice && purchasePriceDate && (!isValidDateKey(purchasePriceDate) || purchasePriceDate > toDateKey())) {
      Alert.alert('Check NAV date', 'Enter a valid NAV effective date no later than today.');
      return;
    }
    if (isMarketAsset && !marketDataId.trim()) {
      Alert.alert('Market data identifier required', assetClass === 'stock' ? 'Enter an exchange ticker such as RELIANCE.BSE so the stock can be valued automatically.' : 'Search and select the MFAPI scheme code so the fund NAV can be updated automatically.');
      return;
    }
    if (assetClass === 'mutual_fund' && !/^\d+$/.test(marketDataId.trim())) {
      Alert.alert('Invalid scheme code', 'Select a numeric MFAPI scheme code from the search results.');
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

    let fundingDebitInPaise = 0;
    if (isBankFundedCreation) {
      if (!currentProfile || !user) {
        Alert.alert('Sign in required', 'Sign in again before funding a new investment from a bank account.');
        return;
      }
      if (!fundingAccount) {
        Alert.alert('Funding account unavailable', 'The selected bank account could not be found. Return to Transfer In and choose an account again.');
        return;
      }
      if (investedInPaise === null || investedInPaise <= 0) {
        Alert.alert('Initial amount required', 'Enter the amount to transfer from your bank account into this new investment.');
        return;
      }
      if (!isMarketAsset && currentInPaise !== null && currentInPaise <= 0) {
        Alert.alert('Current value required', 'A newly funded investment must start with a positive value.');
        return;
      }
      fundingDebitInPaise = isMarketAsset
        ? (marketPurchasePreview ? Math.round(marketPurchasePreview.totalCost * 100) : 0)
        : investedInPaise;
      if (!Number.isSafeInteger(fundingDebitInPaise) || fundingDebitInPaise <= 0) {
        Alert.alert('Purchase amount unavailable', 'Complete the price/NAV lookup and enter a valid amount before funding this investment.');
        return;
      }
      const availableInPaise = Math.round(Number(fundingAccount.balance || 0) * 100);
      if (fundingDebitInPaise > availableInPaise) {
        Alert.alert('Insufficient bank balance', `Available: ₹${(availableInPaise / 100).toLocaleString('en-IN')}. Required: ₹${(fundingDebitInPaise / 100).toLocaleString('en-IN')}.`);
        return;
      }
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
        purchasePrice: isMarketAsset ? parsedPurchasePrice : null,
        purchasePriceDate: isMarketAsset ? (manualExecutionPrice ? (purchasePriceDate || startDate) : purchasePriceDate || null) : null,
        purchasePriceSource: assetClass === 'stock'
          ? (manualExecutionPrice ? 'broker_execution' : 'alpha_vantage_historical_close')
          : assetClass === 'mutual_fund'
            ? (manualExecutionPrice ? 'amc_allotment_statement' : 'mfapi_historical_nav')
            : null,
        transactionChargesInPaise: isMarketAsset ? transactionChargesInPaise : 0,
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
        ...(isBankFundedCreation ? {
          fundingAccountId: routeFundingAccountId,
          fundingUserId: user?.uid,
          fundingOperationId: fundingOperationIdRef.current || (fundingOperationIdRef.current = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`),
        } : {}),
        currency: currentProfile.currency || 'INR',
      });

      if (isBankFundedCreation) {
        Alert.alert(
          'Investment created and funded',
          `₹${(fundingDebitInPaise / 100).toLocaleString('en-IN')} was transferred from ${fundingAccount?.name || 'your bank account'} into ${name.trim()}. The bank debit and investment entry were saved together.`,
          [{ text: 'Done', onPress: () => router.replace('/(tabs)/investments') }],
        );
      } else {
        router.back();
      }
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
          Add a holding to your portfolio.
        </Text>

        {isBankFundedCreation ? (
          <View style={styles.infoBox}>
            <Text style={styles.infoTitle}>Funding from tracked bank account</Text>
            <Text style={styles.infoText}>
              {fundingAccount
                ? `${fundingAccount.name} · Available ₹${Number(fundingAccount.balance || 0).toLocaleString('en-IN')}`
                : 'Loading the selected bank account…'}
            </Text>
            <Text style={styles.infoText}>
              The amount will be deducted from this tracked account when you save. No real bank debit is initiated.
            </Text>
          </View>
        ) : null}

        <Text style={styles.label}>{['stock', 'mutual_fund'].includes(assetClass) ? 'PURCHASE / TRANSACTION DATE (YYYY-MM-DD) *' : 'START DATE (YYYY-MM-DD) *'}</Text>
        <TextInput
          value={startDate}
          onChangeText={setStartDate}
          placeholder="2026-10-29"
          placeholderTextColor={colors.textLight}
          style={styles.input}
          autoCapitalize="none"
        />
        <Text style={styles.helper}>{['stock', 'mutual_fund'].includes(assetClass) ? 'Used to find the historical price or NAV.' : 'Used to calculate interest and installments.'}</Text>

        <Text style={styles.label}>ASSET CLASS</Text>
        <View style={styles.assetGrid}>
          {ASSET_CLASSES.map((item) => {
            const selected = assetClass === item.value;

            return (
              <TouchableOpacity
                key={item.value}
                onPress={() => {
                  if (assetClass !== item.value) {
                    setMarketDataId('');
                    setSymbol('');
                    setName('');
                    setStockQuery('');
                    setStockResults([]);
                    setSchemeQuery('');
                    setSchemeResults([]);
                    setPurchasePrice('');
                    setPurchasePriceDate('');
                    setPurchasePriceLabel('');
                    setHistoricalPriceError('');
                    setManualExecutionPrice(false);
                  }
                  setAssetClass(item.value);
                }}
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

        {assetClass === 'stock' ? (
          <View style={styles.termPanel}>
            <Text style={styles.panelTitle}>Find a listed stock</Text>
            <Text style={styles.helper}>Search and select the correct exchange listing.</Text>
            <View style={styles.twoColumn}>
              <View style={[styles.halfField, { flex: 1.2 }]}>
                <TextInput
                  value={stockQuery}
                  onChangeText={(value) => {
                    setStockQuery(value);
                    setStockResults([]);
                    setMarketDataId('');
                    setSymbol('');
                    setName('');
                    setPurchasePrice('');
                    setPurchasePriceDate('');
                    setPurchasePriceLabel('');
                    setHistoricalPriceError('');
                  }}
                  placeholder="e.g. Reliance Industries"
                  placeholderTextColor={colors.textLight}
                  style={styles.input}
                  autoCapitalize="words"
                  returnKeyType="search"
                  onSubmitEditing={() => { void lookupStocks(); }}
                />
              </View>
              <TouchableOpacity style={styles.searchButton} onPress={() => { void lookupStocks(); }} disabled={searchingStocks}>
                <Text style={styles.searchButtonText}>{searchingStocks ? 'Searching…' : 'Search'}</Text>
              </TouchableOpacity>
            </View>
            {stockResults.map((stock) => (
              <TouchableOpacity
                key={stock.symbol}
                style={[styles.schemeResult, marketDataId === stock.symbol && styles.stockResultSelected]}
                onPress={() => {
                  setName(stock.name);
                  setStockQuery(stock.name);
                  setMarketDataId(stock.symbol);
                  setSymbol(stock.symbol);
                  setProvider(stock.exchange || stock.region);
                  setPurchasePrice('');
                  setPurchasePriceDate('');
                  setManualExecutionPrice(false);
                  setStockResults([]);
                }}
              >
                <Text style={styles.schemeResultName}>{stock.name}</Text>
                <Text style={styles.schemeResultCode}>{stock.symbol} · {stock.exchange || stock.region} · {stock.currency || 'Currency unavailable'}</Text>
              </TouchableOpacity>
            ))}
            {marketDataId ? (
              <View style={styles.selectedStock}>
                <Text style={styles.infoTitle}>Selected listing</Text>
                <Text style={styles.infoText}>{name} · {marketDataId}</Text>
              </View>
            ) : null}
          </View>
        ) : (
          <>
            {assetClass !== 'mutual_fund' ? (
              <>
                <Text style={styles.label}>INVESTMENT NAME *</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. SBI Fixed Deposit"
                  placeholderTextColor={colors.textLight}
                  style={styles.input}
                  maxLength={90}
                />
              </>
            ) : null}
          </>
        )}


        <View style={styles.twoColumn}>
          <View style={[styles.halfField, ['fixed_deposit', 'recurring_deposit'].includes(assetClass) && { flex: 1 }, ['stock', 'mutual_fund'].includes(assetClass) && { flex: 1 }]}>
            <Text style={styles.label}>{assetClass === 'recurring_deposit' ? `INITIAL DEPOSIT (₹)${isBankFundedCreation ? ' *' : ''}` : ['stock', 'mutual_fund'].includes(assetClass) ? 'PURCHASE BUDGET (₹) *' : 'NET INVESTED / PRINCIPAL (₹) *'}</Text>
            <TextInput
              value={investedAmount}
              onChangeText={setInvestedAmount}
              placeholder={assetClass === 'recurring_deposit' ? (isBankFundedCreation ? '5000' : 'Optional initial deposit') : '10000'}
              placeholderTextColor={colors.textLight}
              keyboardType="decimal-pad"
              style={styles.input}
            />
          </View>

          {!['fixed_deposit', 'recurring_deposit', 'stock', 'mutual_fund'].includes(assetClass) ? (
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
            ? 'Estimated value is calculated from your deposit, rate and dates.'
            : 'The purchase quantity is calculated automatically from the budget and historical price.'}
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
            <Text style={styles.helper}>Due installments are caught up when you open the app. A linked source updates only this app's tracked account balance; it does not trigger a real bank debit or mandate.</Text>
          </View>
        ) : null}

        {assetClass === 'mutual_fund' ? (
          <View style={styles.termPanel}>
            <Text style={styles.panelTitle}>Automatic historical NAV</Text>
            <Text style={styles.helper}>Search and select the exact scheme variant. Units are calculated using its historical NAV.</Text>
<View style={styles.twoColumn}>
              <View style={[styles.halfField, { flex: 1.2 }]}>
                <TextInput
                  value={schemeQuery}
                  onChangeText={(value) => {
                    setSchemeQuery(value);
                    setSchemeResults([]);
                  }}
                  placeholder="Search scheme name or AMC"
                  placeholderTextColor={colors.textLight}
                  style={styles.input}
                  returnKeyType="search"
                  onSubmitEditing={() => { void lookupSchemes(); }}
                />
              </View>
              <TouchableOpacity style={styles.searchButton} onPress={() => { void lookupSchemes(); }} disabled={searchingSchemes}>
                <Text style={styles.searchButtonText}>{searchingSchemes ? 'Searching…' : 'Find scheme'}</Text>
              </TouchableOpacity>
            </View>
            {schemeResults.map((scheme) => (
              <TouchableOpacity
                key={scheme.schemeCode}
                style={[styles.schemeResult, marketDataId === String(scheme.schemeCode) && styles.stockResultSelected]}
                onPress={() => {
                  setMarketDataId(String(scheme.schemeCode));
                  setName(scheme.schemeName);
                  setPurchasePrice('');
                  setPurchasePriceDate('');
                  setPurchasePriceLabel('');
                  setHistoricalPriceError('');
                  setManualExecutionPrice(false);
                  setSchemeResults([]);
                }}
              >
                <Text style={styles.schemeResultName}>{scheme.schemeName}</Text>
                <Text style={styles.schemeResultCode}>Scheme code {scheme.schemeCode} · Tap to select</Text>
              </TouchableOpacity>
            ))}
            {marketDataId ? (
              <View style={styles.selectedStock}>
                <Text style={styles.infoTitle}>Selected scheme</Text>
                <Text style={styles.infoText}>{name} · MFAPI {marketDataId}</Text>
              </View>
            ) : null}
            {marketDataId ? (
              manualExecutionPrice ? (
                <>
                  <Text style={styles.helper}>Enter the NAV and NAV date shown on your AMC statement or transaction confirmation.</Text>
                  <Text style={styles.label}>ACTUAL NAV DATE (YYYY-MM-DD)</Text>
                  <TextInput
                    value={purchasePriceDate || startDate}
                    onChangeText={setPurchasePriceDate}
                    placeholder={startDate}
                    placeholderTextColor={colors.textLight}
                    style={styles.input}
                    autoCapitalize="none"
                  />
                  <Text style={styles.label}>ACTUAL ALLOTMENT NAV (₹ PER UNIT)</Text>
                  <TextInput
                    value={purchasePrice}
                    onChangeText={setPurchasePrice}
                    placeholder="e.g. 100.1234"
                    placeholderTextColor={colors.textLight}
                    keyboardType="decimal-pad"
                    style={styles.input}
                  />
                </>
              ) : (
                <View style={styles.stockPriceCard}>
                  <Text style={styles.helper}>{historicalPriceLoading ? 'Fetching historical NAV…' : historicalPriceError ? 'Historical NAV could not be loaded.' : 'Historical NAV reference'}</Text>
                  <Text style={styles.stockPriceValue}>{historicalPriceLoading ? 'Loading…' : purchasePrice ? `₹${Number(purchasePrice).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 5 })}` : '—'}</Text>
                  {purchasePriceDate ? <Text style={styles.stockPriceDate}>NAV date: {purchasePriceDate}</Text> : null}
                  {purchasePriceLabel ? <Text style={styles.stockPriceDate}>{purchasePriceLabel}</Text> : null}
                  {historicalPriceError ? <Text style={styles.stockPriceError}>{historicalPriceError}</Text> : null}
                </View>
              )
            ) : null}
            {marketDataId ? (
              <TouchableOpacity
                style={styles.manualPriceToggle}
                onPress={() => {
                  setManualExecutionPrice((current) => !current);
                  setPurchasePrice('');
                  setPurchasePriceDate('');
                  setPurchasePriceLabel('');
                  setHistoricalPriceError('');
                }}
              >
                <Text style={styles.searchButtonText}>{manualExecutionPrice ? 'Use automatic historical NAV' : 'Enter actual AMC allotment NAV instead'}</Text>
              </TouchableOpacity>
            ) : null}
            <Text style={styles.helper}>For exact accounting, use the allotment NAV from your AMC statement.</Text>
          </View>
        ) : null}

        {assetClass === 'stock' ? (
          <View style={styles.termPanel}>
            <Text style={styles.panelTitle}>Historical purchase price</Text>
            {!marketDataId ? (
              <Text style={styles.helper}>Search for and select a stock above to load its historical closing price automatically.</Text>
            ) : manualExecutionPrice ? (
              <>
                <Text style={styles.helper}>Enter the exact execution price from your broker contract note.</Text>
                <Text style={styles.label}>BROKER EXECUTION PRICE (₹)</Text>
                <TextInput
                  value={purchasePrice}
                  onChangeText={setPurchasePrice}
                  placeholder="Enter actual execution price"
                  placeholderTextColor={colors.textLight}
                  keyboardType="decimal-pad"
                  style={styles.input}
                />
              </>
            ) : (
              <View style={styles.stockPriceCard}>
                <Text style={styles.helper}>{historicalPriceLoading ? 'Fetching historical closing price…' : historicalPriceError ? 'Historical price could not be loaded.' : 'Historical closing price for your selected date'}</Text>
                <Text style={styles.stockPriceValue}>{historicalPriceLoading ? 'Loading…' : purchasePrice ? `₹${Number(purchasePrice).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : '—'}</Text>
                {purchasePriceDate ? <Text style={styles.stockPriceDate}>Price date: {purchasePriceDate}{purchasePriceDate > startDate ? ` · next available session after ${startDate}` : purchasePriceDate < startDate ? ` · latest completed session before ${startDate}` : ''}</Text> : null}
                {historicalPriceError ? <Text style={styles.stockPriceError}>{historicalPriceError}</Text> : null}
              </View>
            )}
            {marketDataId ? (
              <TouchableOpacity
                style={styles.manualPriceToggle}
                onPress={() => {
                  setManualExecutionPrice((current) => !current);
                  if (!manualExecutionPrice) {
                    setPurchasePrice('');
                    setPurchasePriceDate(startDate);
                  } else {
                    setPurchasePrice('');
                    setPurchasePriceDate('');
                  }
                }}
              >
                <Text style={styles.searchButtonText}>{manualExecutionPrice ? 'Use automatic historical price' : 'Enter broker execution price instead'}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}



        {marketPurchasePreview ? (
          <View style={styles.infoBox}>
            <Text style={styles.infoTitle}>Purchase calculation</Text>
            <Text style={styles.infoText}>
              {marketPurchasePreview.quantity.toLocaleString('en-IN', { maximumFractionDigits: 6 })} {assetClass === 'stock' ? 'whole shares' : 'units'} · Trade value ₹{marketPurchasePreview.tradeValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })} · Estimated acquisition cost ₹{marketPurchasePreview.totalCost.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              {assetClass === 'stock' && marketPurchasePreview.unspent > 0 ? ` · Unused budget ₹${marketPurchasePreview.unspent.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : ''}
            </Text>
          </View>
        ) : null}


        {!isBankFundedCreation ? (
          <View style={styles.infoBox}>
            <Text style={styles.infoTitle}>
              Want to fund it from a bank account?
            </Text>
            <Text style={styles.infoText}>
              Open Transfer In, choose a bank account, and select “Create new investment” to create and fund a holding in one step.
            </Text>
          </View>
        ) : null}

        <TouchableOpacity
          onPress={() => {
            void submit();
          }}
          disabled={saving || (isBankFundedCreation && !fundingAccount)}
          style={[styles.saveButton, (saving || (isBankFundedCreation && !fundingAccount)) && styles.buttonDisabled]}
          activeOpacity={0.85}
        >
          <Plus size={17} color="#FFFFFF" />
          <Text style={styles.saveButtonText}>
            {saving ? 'Creating and funding…' : isBankFundedCreation ? 'Create & fund investment' : 'Create investment'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 20, paddingBottom: 32 },
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
    marginBottom: 18,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 10,
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
    height: 50,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: 13,
    color: colors.text,
    fontSize: 14,
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
    padding: 16,
    marginTop: 16,
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
  stockResultSelected: { borderColor: colors.primary, backgroundColor: '#F0EFFF' },
  selectedStock: { marginTop: 10, backgroundColor: '#EAE9FF', borderRadius: 12, padding: 11 },
  stockPriceCard: { marginTop: 10, backgroundColor: colors.background, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12 },
  stockPriceValue: { color: colors.text, fontSize: 23, fontWeight: '800', marginTop: 6 },
  stockPriceDate: { color: colors.textSecondary, fontSize: 9, marginTop: 5 },
  stockPriceError: { color: '#B42318', fontSize: 10, marginTop: 6 },
  manualPriceToggle: { alignSelf: 'flex-start', backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 10 },
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
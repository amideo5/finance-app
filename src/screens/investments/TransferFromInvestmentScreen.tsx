import { colors } from '@/src/constants/colors';
import { useAuth } from '@/src/context/AuthContext';
import { useProfile } from '@/src/context/ProfileContext';
import { getAccounts } from '@/src/services/firebase/accountsService';
import {
  getInvestmentPortfolio,
  transferFromInvestment,
} from '@/src/services/firebase/investmentsService';
import { isDateKey, toLocalDateKey } from '@/src/utils/validation';
import {
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from 'expo-router';
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowLeftRight,
  Banknote,
  Check,
  ShieldCheck,
  Wallet,
} from 'lucide-react-native';
import { useCallback, useState } from 'react';
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

const parsePaise = (input: string) => {
  const amount = Number(input.replace(/,/g, '').trim());

  return input.trim() && Number.isFinite(amount) && amount > 0
    ? Math.round(amount * 100)
    : null;
};

const money = (amount: number) =>
  `₹${Number(amount || 0).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  })}`;

export default function TransferFromInvestmentScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const params = useLocalSearchParams<{
    investmentId?: string | string[];
  }>();

  const routeInvestmentId = Array.isArray(params.investmentId)
    ? params.investmentId[0]
    : params.investmentId;

  const { currentProfile } = useProfile();
  const { user } = useAuth();

  const [investments, setInvestments] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [investmentId, setInvestmentId] = useState(
    routeInvestmentId || '',
  );
  const [accountId, setAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [transactionCharges, setTransactionCharges] = useState('');
  const [date, setDate] = useState(toLocalDateKey(new Date()));
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!currentProfile) return;

    setLoading(true);

    try {
      const [portfolio, allAccounts] = await Promise.all([
        getInvestmentPortfolio(currentProfile.id),
        getAccounts(currentProfile.id),
      ]);

      const bankAccounts = allAccounts.filter(
        (item: any) => String(item.type || '').toLowerCase() === 'bank',
      );

      setInvestments(portfolio.investments);
      setAccounts(bankAccounts);

      if (
        routeInvestmentId &&
        portfolio.investments.some(
          (item: any) => item.id === routeInvestmentId,
        )
      ) {
        setInvestmentId(routeInvestmentId);
      } else if (!investmentId && portfolio.investments.length) {
        setInvestmentId(portfolio.investments[0].id);
      }

      if (!accountId && bankAccounts.length) {
        setAccountId(bankAccounts[0].id);
      }
    } catch (error) {
      console.error('Investment withdrawal form load failed:', error);

      Alert.alert(
        'Could not load transfer options',
        'Check your connection and try again.',
      );
    } finally {
      setLoading(false);
    }
  }, [currentProfile, routeInvestmentId, investmentId, accountId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const selectedInvestment = investments.find(
    (item) => item.id === investmentId,
  );
  const selectedAccount = accounts.find(
    (item) => item.id === accountId,
  );
  const isMarketInvestment = ['stock', 'mutual_fund'].includes(selectedInvestment?.assetClass || '');
  const salePreview = (() => {
    if (!isMarketInvestment) return null;
    const target = Number(amount.replace(/,/g, '').trim());
    const price = Number(unitPrice);
    const heldUnits = Number(selectedInvestment?.units || 0);
    const charges = Number(transactionCharges.replace(/,/g, '')) || 0;
    if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(price) || price <= 0 || heldUnits <= 0) return null;
    const requestedUnits = selectedInvestment?.assetClass === 'stock'
      ? Math.floor(target / price)
      : Math.floor((target / price) * 1_000_000) / 1_000_000;
    if (requestedUnits <= 0 || requestedUnits > heldUnits || target > heldUnits * price + 0.01) return null;
    const grossProceeds = Math.round(requestedUnits * price * 100) / 100;
    const netProceeds = grossProceeds - charges;
    const costBasis = Number(selectedInvestment?.investedAmountInPaise || 0) / 100;
    const costBasisSold = heldUnits > 0 ? costBasis * requestedUnits / heldUnits : 0;
    return { quantity: requestedUnits, grossProceeds, netProceeds, costBasisSold, realizedGainLoss: netProceeds - costBasisSold };
  })();

  const availableValueInPaise = Number.isSafeInteger(
    selectedInvestment?.currentValueInPaise,
  )
    ? selectedInvestment.currentValueInPaise
    : Math.round(Number(selectedInvestment?.currentValue || 0) * 100);

  const submit = async () => {
    const amountInPaise = parsePaise(amount);

    if (!currentProfile || !user) {
      Alert.alert(
        'Sign in required',
        'Your account session is not available. Sign in again and retry.',
      );
      return;
    }

    if (!investmentId || !accountId) {
      Alert.alert(
        'Choose both accounts',
        'Select the investment to withdraw from and the destination bank account.',
      );
      return;
    }

    if (!isDateKey(date)) {
      Alert.alert(
        'Invalid date',
        'Enter a valid date in YYYY-MM-DD format.',
      );
      return;
    }

    if (amountInPaise === null) {
      Alert.alert(
        'Invalid amount',
        'Enter a withdrawal amount greater than zero.',
      );
      return;
    }

    if (isMarketInvestment && transactionCharges.trim() && parsePaise(transactionCharges) === null) {
      Alert.alert('Invalid charges', 'Enter valid transaction charges or leave the field blank.');
      return;
    }

    if (isMarketInvestment && (!Number.isFinite(Number(unitPrice)) || Number(unitPrice) <= 0)) {
      Alert.alert('Execution price required', selectedInvestment?.assetClass === 'stock' ? 'Enter the actual sale price per share.' : 'Enter the applicable redemption NAV.');
      return;
    }

    if (!isMarketInvestment && amountInPaise > availableValueInPaise) {
      Alert.alert(
        'Insufficient investment value',
        `This holding is currently worth ${money(
          availableValueInPaise / 100,
        )}. Enter a smaller amount or update its market value first.`,
      );
      return;
    }

    setSaving(true);

    try {
      await transferFromInvestment(currentProfile.id, user.uid, {
        investmentId,
        accountId,
        amountInPaise,
        unitPrice: isMarketInvestment ? Number(unitPrice) : null,
        transactionChargesInPaise: isMarketInvestment ? (parsePaise(transactionCharges) || 0) : 0,
        date,
        notes: notes.trim(),
        currency: currentProfile.currency || 'INR',
      });

      Alert.alert(
        'Withdrawal recorded',
        'The investment value was reduced, the bank balance was credited, and both ledgers were updated together.',
        [{ text: 'Done', onPress: () => router.back() }],
      );
    } catch (error) {
      console.error('Investment to bank transfer failed:', error);

      Alert.alert(
        error instanceof Error &&
          error.message.startsWith('Withdrawal cannot exceed')
          ? 'Insufficient investment value'
          : 'Transfer failed',
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
          <ArrowLeftRight size={24} color={colors.primary} />
        </View>

        <Text style={styles.title}>Transfer to bank</Text>
        <Text style={styles.subtitle}>
          Withdraw available value from a holding into a linked bank account.
          The holding, bank balance, finance ledger, and portfolio ledger are
          updated atomically.
        </Text>

        <View style={styles.flowCard}>
          <View style={styles.flowStep}>
            <View
              style={[
                styles.flowIcon,
                { backgroundColor: '#FFE7E7' },
              ]}
            >
              <Banknote size={18} color={colors.danger} />
            </View>

            <View style={styles.flowCopy}>
              <Text style={styles.flowLabel}>FROM INVESTMENT</Text>
              <Text style={styles.flowTitle}>
                {selectedInvestment?.name || 'Select an investment'}
              </Text>
              <Text style={styles.flowHint}>
                {selectedInvestment
                  ? `Available ${money(availableValueInPaise / 100)}`
                  : 'Portfolio holding'}
              </Text>
            </View>

            <ArrowDownRight size={18} color={colors.textLight} />
          </View>

          <View style={styles.flowLine} />

          <View style={styles.flowStep}>
            <View
              style={[
                styles.flowIcon,
                { backgroundColor: '#DFF8EC' },
              ]}
            >
              <Wallet size={18} color="#16875B" />
            </View>

            <View style={styles.flowCopy}>
              <Text style={styles.flowLabel}>TO BANK ACCOUNT</Text>
              <Text style={styles.flowTitle}>
                {selectedAccount?.name || 'Select a destination account'}
              </Text>
              <Text style={styles.flowHint}>
                {selectedAccount
                  ? `Balance ${money(Number(selectedAccount.balance || 0))}`
                  : 'Linked bank account'}
              </Text>
            </View>

            <Check size={17} color={colors.success} />
          </View>
        </View>

        <Text style={styles.label}>SOURCE INVESTMENT</Text>

        {investments.length ? (
          <View style={styles.optionList}>
            {investments.map((item) => {
              const selected = item.id === investmentId;

              const value = Number.isSafeInteger(item.currentValueInPaise)
                ? item.currentValueInPaise / 100
                : Number(item.currentValue || 0);

              return (
                <TouchableOpacity
                  key={item.id}
                  onPress={() => { if (item.id !== investmentId) setUnitPrice(''); setInvestmentId(item.id); }}
                  style={[
                    styles.option,
                    selected && styles.optionSelected,
                  ]}
                >
                  <View style={styles.optionCopy}>
                    <Text
                      style={[
                        styles.optionTitle,
                        selected && styles.selectedText,
                      ]}
                    >
                      {item.name}
                    </Text>
                    <Text style={styles.optionSubtitle}>
                      {item.assetClass?.replace(/_/g, ' ') || 'Other asset'} ·
                      {' '}Value {money(value)}
                    </Text>
                  </View>

                  {selected ? (
                    <Check size={17} color={colors.primary} />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          <View style={styles.emptyBox}>
            <Banknote size={22} color={colors.primary} />
            <Text style={styles.emptyText}>
              Add a holding before transferring money out of it.
            </Text>
            <TouchableOpacity
              style={styles.linkButton}
              onPress={() => router.push('/investments/add')}
            >
              <Text style={styles.linkText}>Create investment</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.label}>DESTINATION BANK ACCOUNT</Text>

        {accounts.length ? (
          <View style={styles.optionList}>
            {accounts.map((item) => {
              const selected = item.id === accountId;

              return (
                <TouchableOpacity
                  key={item.id}
                  onPress={() => setAccountId(item.id)}
                  style={[
                    styles.option,
                    selected && styles.optionSelected,
                  ]}
                >
                  <View style={styles.optionCopy}>
                    <Text
                      style={[
                        styles.optionTitle,
                        selected && styles.selectedText,
                      ]}
                    >
                      {item.name}
                    </Text>
                    <Text style={styles.optionSubtitle}>
                      Bank account · Current balance{' '}
                      {money(Number(item.balance || 0))}
                    </Text>
                  </View>

                  {selected ? (
                    <Check size={17} color={colors.primary} />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          <View style={styles.emptyBox}>
            <Wallet size={22} color={colors.primary} />
            <Text style={styles.emptyText}>No bank accounts found.</Text>
            <TouchableOpacity
              style={styles.linkButton}
              onPress={() => router.push('/accounts/add')}
            >
              <Text style={styles.linkText}>Add a bank account</Text>
            </TouchableOpacity>
          </View>
        )}

        {isMarketInvestment ? (
          <>
            <Text style={styles.label}>{selectedInvestment?.assetClass === 'stock' ? 'SALE PRICE (₹ PER SHARE)' : 'REDEMPTION NAV (₹ PER UNIT)'}</Text>
            <TextInput
              value={unitPrice}
              onChangeText={setUnitPrice}
              placeholder={selectedInvestment?.lastMarketPrice ? String(selectedInvestment.lastMarketPrice) : 'Enter execution price / NAV'}
              placeholderTextColor={colors.textLight}
              keyboardType="decimal-pad"
              style={styles.input}
            />
            <Text style={styles.optionSubtitle}>The number of shares/units sold and the proportional acquisition cost are calculated from the execution price.</Text>
          </>
        ) : null}

        <Text style={styles.label}>WITHDRAWAL / SALE PROCEEDS TARGET (₹)</Text>
        <View style={styles.amountField}>
          <Text style={styles.currency}>₹</Text>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="5000"
            placeholderTextColor={colors.textLight}
            keyboardType="decimal-pad"
            style={styles.amountInput}
          />
        </View>

        {isMarketInvestment ? (
          <>
            <Text style={styles.label}>BROKERAGE / REDEMPTION CHARGES (₹)</Text>
            <TextInput
              value={transactionCharges}
              onChangeText={setTransactionCharges}
              placeholder="0"
              placeholderTextColor={colors.textLight}
              keyboardType="decimal-pad"
              style={styles.input}
            />
            {salePreview ? (
              <View style={styles.previewBox}>
                <Text style={styles.optionSubtitle}>Estimated {selectedInvestment?.assetClass === 'stock' ? 'shares sold' : 'units redeemed'}: {salePreview.quantity.toLocaleString('en-IN', { maximumFractionDigits: 6 })}</Text>
                <Text style={styles.optionSubtitle}>Gross proceeds: {money(salePreview.grossProceeds)} · Bank credit after charges: {money(salePreview.netProceeds)}</Text>
                <Text style={[styles.optionSubtitle, { color: salePreview.realizedGainLoss >= 0 ? colors.success : colors.danger }]}>Estimated realized {salePreview.realizedGainLoss >= 0 ? 'gain' : 'loss'}: {money(Math.abs(salePreview.realizedGainLoss))}</Text>
              </View>
            ) : null}
          </>
        ) : null}

        <Text style={styles.label}>DATE (YYYY-MM-DD)</Text>
        <TextInput
          value={date}
          onChangeText={setDate}
          placeholder="2026-10-28"
          placeholderTextColor={colors.textLight}
          style={styles.input}
        />

        <Text style={styles.label}>NOTES (OPTIONAL)</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Redemption, partial withdrawal, maturity payout, etc."
          placeholderTextColor={colors.textLight}
          style={[styles.input, styles.notesInput]}
          multiline
          textAlignVertical="top"
        />

        <View style={styles.guaranteeBox}>
          <ShieldCheck size={18} color="#16875B" />
          <View style={styles.guaranteeCopy}>
            <Text style={styles.guaranteeTitle}>
              Both ledgers stay in sync
            </Text>
            <Text style={styles.guaranteeText}>
              The main finance history gets an Investment Withdrawal inflow,
              your portfolio ledger records a signed withdrawal, and the bank
              account balance increases. This internal transfer is excluded
              from income/expense reporting. If any write fails, all changes
              roll back.
            </Text>
          </View>
        </View>

        <TouchableOpacity
          onPress={() => {
            void submit();
          }}
          disabled={
            saving || loading || !accounts.length || !investments.length
          }
          style={[
            styles.submitButton,
            (saving || loading || !accounts.length || !investments.length) &&
              styles.disabled,
          ]}
        >
          <ArrowLeftRight size={17} color="#FFFFFF" />
          <Text style={styles.submitText}>
            {saving ? 'Recording withdrawal…' : 'Confirm withdrawal'}
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
    alignSelf: 'flex-start',
    marginBottom: 20,
  },
  backText: { color: colors.text, fontWeight: '700', fontSize: 12 },
  headingIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: '#EAE9FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    color: colors.text,
    fontSize: 25,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 6,
    marginBottom: 19,
  },
  flowCard: {
    backgroundColor: colors.card,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 10,
  },
  flowStep: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flowIcon: {
    width: 39,
    height: 39,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flowCopy: { flex: 1, gap: 4 },
  flowLabel: {
    color: colors.textLight,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1,
  },
  flowTitle: { color: colors.text, fontWeight: '800', fontSize: 11 },
  flowHint: {
    color: colors.textSecondary,
    fontSize: 9,
    textTransform: 'capitalize',
  },
  flowLine: {
    height: 22,
    marginLeft: 19,
    borderLeftWidth: 1,
    borderStyle: 'dashed',
    borderLeftColor: colors.border,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.9,
    marginTop: 15,
    marginBottom: 8,
  },
  optionList: { gap: 7 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 13,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionSelected: {
    borderColor: colors.primary,
    backgroundColor: '#F0EFFF',
  },
  optionCopy: { flex: 1, gap: 4 },
  optionTitle: { color: colors.text, fontSize: 11, fontWeight: '800' },
  optionSubtitle: {
    color: colors.textSecondary,
    fontSize: 9,
    textTransform: 'capitalize',
  },
  selectedText: { color: colors.primary },
  emptyBox: {
    alignItems: 'center',
    padding: 18,
    gap: 8,
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 10,
    textAlign: 'center',
  },
  linkButton: { marginTop: 4 },
  linkText: { color: colors.primary, fontWeight: '800', fontSize: 10 },
  amountField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 51,
    backgroundColor: colors.card,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
  },
  currency: { color: colors.textSecondary, fontSize: 19, fontWeight: '700' },
  amountInput: {
    flex: 1,
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
    paddingVertical: 0,
  },
  input: {
    height: 47,
    borderRadius: 13,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: 13,
    color: colors.text,
    fontSize: 11,
  },
  notesInput: { height: 76, paddingTop: 12 },
  guaranteeBox: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#E3F8EC',
    borderRadius: 14,
    padding: 13,
    marginTop: 18,
  },
  guaranteeCopy: { flex: 1, gap: 5 },
  guaranteeTitle: { color: '#13784F', fontSize: 11, fontWeight: '800' },
  guaranteeText: { color: '#3A8065', fontSize: 9, lineHeight: 14 },
  submitButton: {
    height: 51,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: colors.primary,
    marginTop: 17,
  },
  submitText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  disabled: { opacity: 0.5 },
  previewBox: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, marginTop: 10, gap: 4 },
});
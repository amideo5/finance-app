import { colors } from '@/src/constants/colors';
import { useAuth } from '@/src/context/AuthContext';
import { useProfile } from '@/src/context/ProfileContext';
import { getAccounts } from '@/src/services/firebase/accountsService';
import {
  getInvestmentPortfolio,
  transferToInvestment,
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

export default function TransferToInvestmentScreen() {
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
      console.error('Transfer form load failed:', error);
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
  const availableBalance = Number(selectedAccount?.balance || 0);

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
        'Select a source account and a destination investment.',
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
        'Enter a transfer amount greater than zero.',
      );
      return;
    }

    if (amountInPaise > Math.round(availableBalance * 100)) {
      Alert.alert(
        'Insufficient balance',
        `This account has ₹${availableBalance.toLocaleString('en-IN')} available. Choose a smaller amount or a different account.`,
      );
      return;
    }

    setSaving(true);

    try {
      await transferToInvestment(currentProfile.id, user.uid, {
        investmentId,
        accountId,
        amountInPaise,
        date,
        notes: notes.trim(),
        currency: currentProfile.currency || 'INR',
      });

      Alert.alert(
        'Transfer recorded',
        'The bank account was debited and both the finance expense and investment inflow were recorded together.',
        [{ text: 'Done', onPress: () => router.back() }],
      );
    } catch (error) {
      console.error('Bank to investment transfer failed:', error);

      Alert.alert(
        error instanceof Error &&
          error.message.startsWith('Insufficient balance')
          ? 'Insufficient balance'
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

        <Text style={styles.title}>Transfer to investment</Text>
        <Text style={styles.subtitle}>
          Move money from an account into a portfolio holding. The account
          debit and both ledger entries are saved in one Firestore transaction.
        </Text>

        <View style={styles.flowCard}>
          <View style={styles.flowStep}>
            <View
              style={[
                styles.flowIcon,
                { backgroundColor: '#FFE7E7' },
              ]}
            >
              <Wallet size={18} color={colors.danger} />
            </View>

            <View style={styles.flowCopy}>
              <Text style={styles.flowLabel}>FROM</Text>
              <Text style={styles.flowTitle}>
                {selectedAccount?.name || 'Select a source account'}
              </Text>
              <Text style={styles.flowHint}>
                {selectedAccount
                  ? `Available ₹${availableBalance.toLocaleString('en-IN')}`
                  : 'Linked bank account'}
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
              <Banknote size={18} color="#16875B" />
            </View>

            <View style={styles.flowCopy}>
              <Text style={styles.flowLabel}>TO PORTFOLIO</Text>
              <Text style={styles.flowTitle}>
                {selectedInvestment?.name || 'Select an investment'}
              </Text>
              <Text style={styles.flowHint}>
                {selectedInvestment?.assetClass?.replace(/_/g, ' ') ||
                  'Investment holding'}
              </Text>
            </View>

            <Check size={17} color={colors.success} />
          </View>
        </View>

        <Text style={styles.label}>SOURCE ACCOUNT</Text>

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
                      {String(item.type || 'Account').replace(/_/g, ' ')} ·
                      {' '}Available ₹
                      {Number(item.balance || 0).toLocaleString('en-IN')}
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

        <Text style={styles.label}>DESTINATION INVESTMENT</Text>

        {investments.length ? (
          <View style={styles.optionList}>
            {investments.map((item) => {
              const selected = item.id === investmentId;

              return (
                <TouchableOpacity
                  key={item.id}
                  onPress={() => setInvestmentId(item.id)}
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
                      {' '}Value ₹
                      {Number(item.currentValue || 0).toLocaleString('en-IN')}
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
              Add a holding before transferring money into it.
            </Text>
            <TouchableOpacity
              style={styles.linkButton}
              onPress={() => router.push('/investments/add')}
            >
              <Text style={styles.linkText}>Create investment</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.label}>TRANSFER AMOUNT (₹)</Text>
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
          placeholder="Monthly SIP, FD placement, etc."
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
              The main finance app receives an Investment Transfer expense and
              the selected holding receives an inflow. If any write fails,
              the full transfer is rolled back.
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
            {saving ? 'Recording transfer…' : 'Confirm transfer'}
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
});
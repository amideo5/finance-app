import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import {
  getInvestmentPortfolio,
  recordInvestmentActivity,
} from '@/src/services/firebase/investmentsService';
import { isDateKey, toLocalDateKey } from '@/src/utils/validation';
import {
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from 'expo-router';
import {
  ArrowLeft,
  Check,
  CircleDollarSign,
  TrendingUp,
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

const ACTIVITY_TYPES = [
  {
    value: 'contribution',
    label: 'Contribution',
    description: 'Add money without a bank link',
    icon: '＋',
  },
  {
    value: 'withdrawal',
    label: 'Withdrawal',
    description: 'Reduce the holding value',
    icon: '↗',
  },
  {
    value: 'interest',
    label: 'Interest',
    description: 'Add interest earned',
    icon: '₹',
  },
  {
    value: 'gain',
    label: 'Gain',
    description: 'Record a positive return',
    icon: '↗',
  },
  {
    value: 'loss',
    label: 'Loss',
    description: 'Record a value decrease',
    icon: '↘',
  },
  {
    value: 'market_value',
    label: 'Market value',
    description: 'Set the new total value',
    icon: '◉',
  },
];

const paise = (value: string) => {
  if (!value.trim()) return null;

  const amount = Number(value.replace(/,/g, '').trim());

  return Number.isFinite(amount) && amount >= 0
    ? Math.round(amount * 100)
    : null;
};

export default function InvestmentActivityScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const params = useLocalSearchParams<{
    investmentId?: string | string[];
  }>();

  const routeInvestmentId = Array.isArray(params.investmentId)
    ? params.investmentId[0]
    : params.investmentId;

  const { currentProfile } = useProfile();

  const [investments, setInvestments] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState(routeInvestmentId || '');
  const [type, setType] = useState('interest');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(toLocalDateKey(new Date()));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!currentProfile) return;

    try {
      const result = await getInvestmentPortfolio(currentProfile.id);

      setInvestments(result.investments);

      if (
        routeInvestmentId &&
        result.investments.some(
          (item: any) => item.id === routeInvestmentId,
        )
      ) {
        setSelectedId(routeInvestmentId);
      } else if (!selectedId && result.investments.length) {
        setSelectedId(result.investments[0].id);
      }
    } catch (error) {
      console.error('Could not load investments for activity:', error);
    }
  }, [currentProfile, routeInvestmentId, selectedId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const selected = investments.find((item) => item.id === selectedId);

  const submit = async () => {
    const amountInPaise = paise(amount);

    if (!currentProfile || !selectedId) {
      Alert.alert(
        'Choose an investment',
        'Select the holding you want to update.',
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

    if (
      amountInPaise === null ||
      (type !== 'market_value' && amountInPaise <= 0)
    ) {
      Alert.alert(
        'Check the amount',
        type === 'market_value'
          ? 'Enter the new total market value. Zero is allowed.'
          : 'Enter an amount greater than zero.',
      );
      return;
    }

    setSaving(true);

    try {
      await recordInvestmentActivity(currentProfile.id, selectedId, {
        type,
        amountInPaise,
        ...(type === 'market_value'
          ? { newValueInPaise: amountInPaise }
          : {}),
        date,
        notes: notes.trim(),
      });

      router.back();
    } catch (error) {
      console.error('Could not save investment activity:', error);

      Alert.alert(
        'Could not save activity',
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
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <View style={styles.headingIcon}>
          <TrendingUp size={24} color={colors.primary} />
        </View>

        <Text style={styles.title}>Record activity</Text>
        <Text style={styles.subtitle}>
          Keep additions, withdrawals, interest and market-value updates in
          the portfolio ledger. This form never edits daily transactions.
        </Text>

        <Text style={styles.label}>SELECT HOLDING</Text>

        {investments.length ? (
          <View style={styles.holdingsList}>
            {investments.map((item) => {
              const selectedItem = selectedId === item.id;

              return (
                <TouchableOpacity
                  key={item.id}
                  onPress={() => setSelectedId(item.id)}
                  style={[
                    styles.holdingOption,
                    selectedItem && styles.holdingSelected,
                  ]}
                >
                  <View style={styles.holdingCopy}>
                    <Text
                      style={[
                        styles.holdingName,
                        selectedItem && styles.selectedText,
                      ]}
                    >
                      {item.name}
                    </Text>

                    <Text style={styles.holdingValue}>
                      Current value ₹
                      {Number(item.currentValue || 0).toLocaleString(
                        'en-IN',
                      )}
                    </Text>
                  </View>

                  {selectedItem ? (
                    <Check size={17} color={colors.primary} />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        ) : (
          <View style={styles.noHoldings}>
            <Wallet size={23} color={colors.primary} />
            <Text style={styles.noHoldingsText}>
              Create an investment before recording an activity.
            </Text>
            <TouchableOpacity
              onPress={() => router.push('/investments/add')}
            >
              <Text style={styles.createLink}>Add an investment</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.label}>ACTIVITY TYPE</Text>

        <View style={styles.typeGrid}>
          {ACTIVITY_TYPES.map((item) => {
            const selectedTypeOption = type === item.value;

            return (
              <TouchableOpacity
                key={item.value}
                onPress={() => setType(item.value)}
                style={[
                  styles.typeOption,
                  selectedTypeOption && styles.typeSelected,
                ]}
              >
                <View
                  style={[
                    styles.typeGlyph,
                    selectedTypeOption && styles.typeGlyphSelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.typeGlyphText,
                      selectedTypeOption && styles.selectedText,
                    ]}
                  >
                    {item.icon}
                  </Text>
                </View>

                <View style={styles.typeCopy}>
                  <Text
                    style={[
                      styles.typeTitle,
                      selectedTypeOption && styles.selectedText,
                    ]}
                  >
                    {item.label}
                  </Text>
                  <Text style={styles.typeDescription}>
                    {item.description}
                  </Text>
                </View>

                {selectedTypeOption ? (
                  <Check size={15} color={colors.primary} />
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.label}>
          {type === 'market_value'
            ? 'NEW TOTAL MARKET VALUE (₹)'
            : type === 'interest'
              ? 'INTEREST AMOUNT (₹)'
              : type === 'gain'
                ? 'GAIN AMOUNT (₹)'
                : type === 'loss'
                  ? 'LOSS AMOUNT (₹)'
                  : type === 'withdrawal'
                    ? 'WITHDRAWAL AMOUNT (₹)'
                    : 'CONTRIBUTION AMOUNT (₹)'}
        </Text>

        <View style={styles.amountField}>
          <Text style={styles.currencySymbol}>₹</Text>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder={
              type === 'market_value'
                ? String(Math.round(Number(selected?.currentValue || 0)))
                : '1000'
            }
            placeholderTextColor={colors.textLight}
            keyboardType="decimal-pad"
            style={styles.amountInput}
          />
        </View>

        <Text style={styles.helper}>
          {type === 'market_value'
            ? 'This replaces the current value; invested capital is unchanged.'
            : type === 'interest' || type === 'gain'
              ? 'This increases current value without increasing invested capital.'
              : type === 'loss'
                ? 'This reduces current value without changing invested capital.'
                : type === 'withdrawal'
                  ? 'This reduces current value and net invested capital only. Use “Transfer out” if the money is also being credited to a linked bank account.'
                  : 'Manual contribution changes the portfolio only; use “Transfer in” or “Transfer out” when money should also move to or from a linked bank account.'}
        </Text>

        <Text style={styles.label}>DATE (YYYY-MM-DD)</Text>
        <TextInput
          value={date}
          onChangeText={setDate}
          placeholder="2026-10-28"
          placeholderTextColor={colors.textLight}
          style={styles.input}
          autoCapitalize="none"
        />

        <Text style={styles.label}>NOTES (OPTIONAL)</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Monthly interest, statement value, etc."
          placeholderTextColor={colors.textLight}
          style={[styles.input, styles.notesInput]}
          multiline
          textAlignVertical="top"
        />

        {selected ? (
          <View style={styles.selectedSummary}>
            <CircleDollarSign size={16} color={colors.primary} />
            <Text style={styles.summaryText}>
              Selected:{' '}
              <Text style={styles.summaryStrong}>{selected.name}</Text>
            </Text>
          </View>
        ) : null}

        <TouchableOpacity
          onPress={() => {
            void submit();
          }}
          disabled={saving || !investments.length}
          style={[
            styles.saveButton,
            (saving || !investments.length) && styles.disabled,
          ]}
        >
          <Check size={17} color="#FFFFFF" />
          <Text style={styles.saveText}>
            {saving ? 'Saving activity…' : 'Save to investment ledger'}
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
    marginBottom: 20,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 9,
    letterSpacing: 0.9,
    fontWeight: '800',
    marginTop: 14,
    marginBottom: 8,
  },
  holdingsList: { gap: 7 },
  holdingOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 13,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  holdingSelected: {
    borderColor: colors.primary,
    backgroundColor: '#F0EFFF',
  },
  holdingCopy: { flex: 1, gap: 4 },
  holdingName: { color: colors.text, fontSize: 11, fontWeight: '800' },
  holdingValue: { color: colors.textSecondary, fontSize: 9 },
  selectedText: { color: colors.primary },
  noHoldings: {
    alignItems: 'center',
    padding: 20,
    backgroundColor: colors.card,
    borderRadius: 16,
    gap: 9,
    borderWidth: 1,
    borderColor: colors.border,
  },
  noHoldingsText: {
    color: colors.textSecondary,
    fontSize: 10,
    textAlign: 'center',
  },
  createLink: { color: colors.primary, fontWeight: '800', fontSize: 11 },
  typeGrid: { gap: 7 },
  typeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeSelected: {
    backgroundColor: '#F0EFFF',
    borderColor: colors.primary,
  },
  typeGlyph: {
    width: 35,
    height: 35,
    borderRadius: 12,
    backgroundColor: '#F0F1F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeGlyphSelected: { backgroundColor: '#E1DFFF' },
  typeGlyphText: {
    color: colors.textSecondary,
    fontSize: 18,
    fontWeight: '700',
  },
  typeCopy: { flex: 1, gap: 4 },
  typeTitle: { color: colors.text, fontSize: 11, fontWeight: '800' },
  typeDescription: { color: colors.textSecondary, fontSize: 9 },
  amountField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 52,
  },
  currencySymbol: {
    color: colors.textSecondary,
    fontSize: 19,
    fontWeight: '700',
  },
  amountInput: {
    flex: 1,
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
    paddingVertical: 0,
  },
  helper: {
    color: colors.textLight,
    fontSize: 9,
    lineHeight: 14,
    marginTop: 7,
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
  selectedSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
    backgroundColor: '#EAE9FF',
    borderRadius: 13,
    padding: 12,
  },
  summaryText: { color: '#5A55A4', fontSize: 10 },
  summaryStrong: { fontWeight: '800', color: colors.primaryDark },
  saveButton: {
    height: 51,
    borderRadius: 15,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 18,
  },
  saveText: { color: '#FFFFFF', fontWeight: '800', fontSize: 11 },
  disabled: { opacity: 0.55 },
});
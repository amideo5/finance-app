import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { addInvestment } from '@/src/services/firebase/investmentsService';
import { useRouter } from 'expo-router';
import { ArrowLeft, Check, Landmark, Plus } from 'lucide-react-native';
import { useState } from 'react';
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
  return Number.isFinite(value) && value >= 0
    ? Math.round(value * 100)
    : null;
};

export default function AddInvestmentScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { currentProfile } = useProfile();

  const [name, setName] = useState('');
  const [assetClass, setAssetClass] = useState('mutual_fund');
  const [provider, setProvider] = useState('');
  const [symbol, setSymbol] = useState('');
  const [investedAmount, setInvestedAmount] = useState('');
  const [currentValue, setCurrentValue] = useState('');
  const [units, setUnits] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const investedInPaise = parseAmountPaise(investedAmount);
    const currentInPaise = currentValue.trim()
      ? parseAmountPaise(currentValue)
      : investedInPaise;

    if (!currentProfile) return;

    if (!name.trim()) {
      Alert.alert(
        'Investment name required',
        'Enter a name to identify this holding.',
      );
      return;
    }

    // if (
    //   investedInPaise === null ||
    //   currentInPaise === null ||
    //   (investedInPaise === 0 && currentInPaise === 0)
    // ) {
    //   Alert.alert(
    //     'Check the amounts',
    //     'Enter a valid invested amount or current value greater than zero.',
    //   );
    //   return;
    // }

    setSaving(true);

    try {
      await addInvestment(currentProfile.id, {
        name: name.trim(),
        assetClass,
        provider: provider.trim() || null,
        symbol: symbol.trim().toUpperCase() || null,
        units: units.trim() ? Number(units) : null,
        notes: notes.trim() || null,
        investedAmountInPaise: investedInPaise,
        currentValueInPaise: currentInPaise,
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
          Create a holding in your separate investment portfolio. This does
          not create a daily transaction.
        </Text>

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
            <Text style={styles.label}>SYMBOL / FOLIO</Text>
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
          <View style={styles.halfField}>
            <Text style={styles.label}>NET INVESTED (₹) *</Text>
            <TextInput
              value={investedAmount}
              onChangeText={setInvestedAmount}
              placeholder="10000"
              placeholderTextColor={colors.textLight}
              keyboardType="decimal-pad"
              style={styles.input}
            />
          </View>

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
        </View>

        <Text style={styles.helper}>
          Current value defaults to net invested when left blank. Amounts are
          stored in paise for accurate totals.
        </Text>

        <Text style={styles.label}>UNITS / QUANTITY (OPTIONAL)</Text>
        <TextInput
          value={units}
          onChangeText={setUnits}
          placeholder="e.g. 12.5"
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
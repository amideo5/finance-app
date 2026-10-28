import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, Check, CircleDollarSign, UserRound, UsersRound, BriefcaseBusiness } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProfile } from '@/src/context/ProfileContext';
import { colors } from '@/src/constants/colors';

const PROFILE_TYPES = [
  { label: 'Personal', value: 'personal', emoji: '👤', description: 'Your everyday money', icon: UserRound },
  { label: 'Household', value: 'household', emoji: '🏠', description: 'Shared home finances', icon: UsersRound },
  { label: 'Business', value: 'business', emoji: '💼', description: 'Work and business costs', icon: BriefcaseBusiness },
];

export default function CreateProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { createProfile } = useProfile();
  const [name, setName] = useState('');
  const [type, setType] = useState('personal');
  const [currency, setCurrency] = useState('INR');
  const [saving, setSaving] = useState(false);
  const chosenType = PROFILE_TYPES.find((item) => item.value === type) || PROFILE_TYPES[0];

  const onCreate = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      Alert.alert('Profile name required', 'Enter a name for this finance profile.');
      return;
    }
    const normalizedCurrency = currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
      Alert.alert('Currency code', 'Enter a 3-letter currency code, such as INR, USD, or EUR.');
      return;
    }
    try {
      setSaving(true);
      await createProfile({ name: trimmedName, type, emoji: chosenType.emoji, currency: normalizedCurrency });
      router.back();
    } catch (error) {
      console.error('Could not create finance profile:', error);
      Alert.alert('Could not create profile', 'Please check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'New profile', headerShown: false }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.container, { paddingTop: Math.max(insets.top + 12, 24), paddingBottom: Math.max(insets.bottom + 28, 36) }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft size={20} color={colors.text} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>

          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <CircleDollarSign size={28} color="#FFFFFF" />
            </View>
            <Text style={styles.eyebrow}>YOUR MONEY, ORGANIZED</Text>
            <Text style={styles.heading}>Create a finance profile</Text>
            <Text style={styles.description}>Keep accounts, transactions and budgets organized in a dedicated space.</Text>
            <View style={styles.previewPill}>
              <Text style={styles.previewEmoji}>{chosenType.emoji}</Text>
              <Text style={styles.previewText}>{name.trim() || chosenType.label}</Text>
              <Text style={styles.previewDot}>·</Text>
              <Text style={styles.previewText}>{currency.trim().toUpperCase() || 'INR'}</Text>
            </View>
          </View>

          <View style={styles.formCard}>
            <Text style={styles.sectionTitle}>Profile details</Text>
            <Text style={styles.label}>Profile name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. My finances"
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
              maxLength={48}
              autoFocus
              returnKeyType="next"
            />

            <Text style={styles.label}>Choose a profile type</Text>
            <View style={styles.types}>
              {PROFILE_TYPES.map((item) => {
                const selected = type === item.value;
                return (
                  <TouchableOpacity
                    key={item.value}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => setType(item.value)}
                    style={[styles.typeOption, selected && styles.typeSelected]}
                  >
                    <View style={[styles.typeIcon, selected && styles.typeIconSelected]}>
                      <Text style={styles.typeEmoji}>{item.emoji}</Text>
                    </View>
                    <Text style={[styles.typeText, selected && styles.typeTextSelected]}>{item.label}</Text>
                    <Text style={styles.typeDescription}>{item.description}</Text>
                    {selected ? <View style={styles.check}><Check size={12} color="#FFFFFF" /></View> : null}
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.label}>Base currency</Text>
            <View style={styles.currencyRow}>
              <View style={styles.currencyIcon}><CircleDollarSign size={20} color={colors.primary} /></View>
              <View style={styles.currencyCopy}>
                <Text style={styles.currencyTitle}>Currency code</Text>
                <Text style={styles.currencyHint}>Use a 3-letter code, such as INR or USD</Text>
              </View>
              <TextInput
                value={currency}
                onChangeText={setCurrency}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="INR"
                placeholderTextColor={colors.textSecondary}
                style={styles.currencyInput}
                maxLength={3}
                returnKeyType="done"
              />
            </View>
          </View>

          <TouchableOpacity
            accessibilityRole="button"
            disabled={saving}
            onPress={onCreate}
            style={[styles.createButton, saving && styles.disabled]}
          >
            {saving ? <ActivityIndicator color="#FFFFFF" /> : <Check size={19} color="#FFFFFF" />}
            <Text style={styles.createText}>{saving ? 'Creating profile…' : 'Create profile'}</Text>
          </TouchableOpacity>
          <Text style={styles.footerNote}>You can manage this profile and its finances separately.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { paddingHorizontal: 20, gap: 16 },
  backButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 8, paddingRight: 12 },
  backText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  hero: { backgroundColor: colors.primary, borderRadius: 26, padding: 22, overflow: 'hidden' },
  heroIcon: { width: 52, height: 52, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  eyebrow: { color: '#DCD9FF', fontSize: 10, fontWeight: '800', letterSpacing: 1.7, marginBottom: 8 },
  heading: { fontSize: 27, lineHeight: 33, fontWeight: '800', letterSpacing: -0.6, color: '#FFFFFF' },
  description: { fontSize: 14, color: '#EAE8FF', lineHeight: 21, marginTop: 9 },
  previewPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 18, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.15)' },
  previewEmoji: { fontSize: 14 },
  previewText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  previewDot: { color: '#DCD9FF' },
  formCard: { backgroundColor: colors.card, borderRadius: 22, padding: 18, borderWidth: 1, borderColor: colors.border },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginBottom: 6 },
  label: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 9, marginTop: 17 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 13, paddingHorizontal: 14, paddingVertical: 13, color: colors.text, fontSize: 16, backgroundColor: colors.background },
  types: { flexDirection: 'row', gap: 8 },
  typeOption: { flex: 1, minWidth: 0, alignItems: 'center', paddingHorizontal: 7, paddingVertical: 13, borderWidth: 1, borderColor: colors.border, borderRadius: 15, backgroundColor: colors.background, position: 'relative' },
  typeSelected: { borderColor: colors.primary, backgroundColor: colors.primary + '0D' },
  typeIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center', marginBottom: 9 },
  typeIconSelected: { backgroundColor: colors.primary + '18' },
  typeEmoji: { fontSize: 20 },
  typeText: { fontSize: 12, color: colors.text, fontWeight: '700', textAlign: 'center' },
  typeTextSelected: { color: colors.primary },
  typeDescription: { color: colors.textSecondary, fontSize: 9, lineHeight: 13, textAlign: 'center', marginTop: 5 },
  check: { position: 'absolute', top: 7, right: 7, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  currencyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 11, backgroundColor: colors.background },
  currencyIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.primary + '12', alignItems: 'center', justifyContent: 'center' },
  currencyCopy: { flex: 1 },
  currencyTitle: { color: colors.text, fontSize: 13, fontWeight: '700' },
  currencyHint: { color: colors.textSecondary, fontSize: 10, marginTop: 3, lineHeight: 14 },
  currencyInput: { width: 58, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 9, textAlign: 'center', color: colors.text, fontSize: 14, fontWeight: '800', backgroundColor: colors.card },
  createButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, backgroundColor: colors.primary, paddingVertical: 16, borderRadius: 15, shadowColor: colors.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 4 },
  createText: { color: '#FFFFFF', fontWeight: '800', fontSize: 16 },
  disabled: { opacity: 0.6 },
  footerNote: { color: colors.textSecondary, fontSize: 11, textAlign: 'center', lineHeight: 16, marginTop: -5 },
});

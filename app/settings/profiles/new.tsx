import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useProfile } from '@/src/context/ProfileContext';
import { colors } from '@/src/constants/colors';
import Card from '@/src/components/ui/Card';

const PROFILE_TYPES = [
  { label: 'Personal', value: 'personal', emoji: '👤' },
  { label: 'Household', value: 'household', emoji: '🏠' },
  { label: 'Business', value: 'business', emoji: '💼' },
];

export default function CreateProfileScreen() {
  const router = useRouter();
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
      <Stack.Screen options={{ title: 'New profile' }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.heading}>Create a finance profile</Text>
          <Text style={styles.description}>Each profile has its own accounts, transactions, and budgets.</Text>
          <Card>
            <Text style={styles.label}>Profile name</Text>
            <TextInput value={name} onChangeText={setName} placeholder="e.g. Household" placeholderTextColor={colors.textSecondary} style={styles.input} maxLength={48} autoFocus />
            <Text style={styles.label}>Profile type</Text>
            <View style={styles.types}>
              {PROFILE_TYPES.map((item) => (
                <TouchableOpacity key={item.value} onPress={() => setType(item.value)} style={[styles.typeOption, type === item.value && styles.typeSelected]}>
                  <Text style={styles.typeEmoji}>{item.emoji}</Text>
                  <Text style={[styles.typeText, type === item.value && styles.typeTextSelected]}>{item.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.label}>Currency</Text>
            <TextInput value={currency} onChangeText={setCurrency} autoCapitalize="characters" placeholder="INR" placeholderTextColor={colors.textSecondary} style={styles.input} maxLength={3} />
          </Card>
          <TouchableOpacity disabled={saving} onPress={onCreate} style={[styles.createButton, saving && styles.disabled]}>
            <Text style={styles.createText}>{saving ? 'Creating…' : 'Create profile'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { padding: 24, gap: 16 },
  heading: { fontSize: 24, fontWeight: '700', color: colors.text },
  description: { fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  label: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 8, marginTop: 8 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: colors.text, fontSize: 16 },
  types: { flexDirection: 'row', gap: 8 },
  typeOption: { flex: 1, alignItems: 'center', paddingVertical: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 10 },
  typeSelected: { borderColor: colors.primary, backgroundColor: colors.primary + '12' },
  typeEmoji: { fontSize: 22, marginBottom: 4 },
  typeText: { fontSize: 12, color: colors.textSecondary },
  typeTextSelected: { color: colors.primary, fontWeight: '700' },
  createButton: { backgroundColor: colors.primary, paddingVertical: 15, borderRadius: 12, alignItems: 'center' },
  createText: { color: colors.card, fontWeight: '700', fontSize: 16 },
  disabled: { opacity: 0.6 },
});

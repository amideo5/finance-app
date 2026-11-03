import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { db } from '@/src/firebaseConfig';
import { updateInvestmentDetails } from '@/src/services/firebase/investmentsService';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { ArrowLeft, Check } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function EditInvestmentScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ investmentId?: string | string[] }>();
  const investmentId = Array.isArray(params.investmentId) ? params.investmentId[0] : params.investmentId;
  const { currentProfile } = useProfile();
  const [name, setName] = useState('');
  const [provider, setProvider] = useState('');
  const [symbol, setSymbol] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!currentProfile || !investmentId) { setLoading(false); return; }
      try {
        const snapshot = await getDoc(doc(db, 'profiles', currentProfile.id, 'investments', investmentId));
        if (!snapshot.exists()) throw new Error('This investment could not be found.');
        const data = snapshot.data();
        if (!active) return;
        setName(String(data.name || ''));
        setProvider(String(data.provider || ''));
        setSymbol(String(data.symbol || data.marketDataId || ''));
        setNotes(String(data.notes || ''));
      } catch (error) {
        if (active) Alert.alert('Could not load investment', error instanceof Error ? error.message : 'Please try again.');
      } finally { if (active) setLoading(false); }
    };
    void load();
    return () => { active = false; };
  }, [currentProfile, investmentId]);

  const save = async () => {
    if (!currentProfile || !investmentId || !name.trim()) {
      Alert.alert('Investment name required', 'Enter a name for this holding.');
      return;
    }
    setSaving(true);
    try {
      await updateInvestmentDetails(currentProfile.id, investmentId, { name, provider, symbol, notes });
      router.back();
    } catch (error) {
      Alert.alert('Could not update investment', error instanceof Error ? error.message : 'Please try again.');
    } finally { setSaving(false); }
  };

  if (loading) return <View style={styles.loading}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <>
      <Stack.Screen options={{ title: 'Edit investment', headerShown: false }} />
      <ScrollView contentContainerStyle={[styles.container, { paddingTop: Math.max(insets.top + 8, 26), paddingBottom: Math.max(insets.bottom, 20) + 24 }]} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={styles.back} onPress={() => router.back()}><ArrowLeft size={18} color={colors.text} /><Text style={styles.backText}>Investment details</Text></TouchableOpacity>
        <View style={styles.hero}><Text style={styles.eyebrow}>PORTFOLIO ITEM</Text><Text style={styles.title}>Edit investment</Text><Text style={styles.subtitle}>Update identifying details without changing units, cost basis, valuation or ledger history.</Text></View>
        <View style={styles.form}>
          <Text style={styles.label}>Investment name</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Investment name" placeholderTextColor={colors.textSecondary} />
          <Text style={styles.label}>Provider / institution</Text>
          <TextInput style={styles.input} value={provider} onChangeText={setProvider} placeholder="Bank, AMC or broker" placeholderTextColor={colors.textSecondary} />
          <Text style={styles.label}>Symbol / reference code</Text>
          <TextInput style={styles.input} value={symbol} onChangeText={setSymbol} placeholder="Ticker or scheme code" placeholderTextColor={colors.textSecondary} autoCapitalize="characters" />
          <Text style={styles.label}>Notes</Text>
          <TextInput style={[styles.input, styles.notes]} value={notes} onChangeText={setNotes} placeholder="Optional notes" placeholderTextColor={colors.textSecondary} multiline textAlignVertical="top" />
          <Text style={styles.helper}>For interest rate, maturity, recurring schedules and market-data provider settings, use Configure growth on the investment details page.</Text>
          <TouchableOpacity style={[styles.saveButton, saving && styles.disabled]} onPress={() => void save()} disabled={saving}><Check size={18} color="#FFFFFF" /><Text style={styles.saveText}>{saving ? 'Saving…' : 'Save changes'}</Text></TouchableOpacity>
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  container: { flexGrow: 1, paddingHorizontal: 20, gap: 16, backgroundColor: colors.background },
  back: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingVertical: 8 },
  backText: { color: colors.text, fontWeight: '700', fontSize: 13 },
  hero: { backgroundColor: colors.primary, padding: 21, borderRadius: 22 },
  eyebrow: { color: '#DCD9FF', fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  title: { color: '#FFFFFF', fontSize: 25, fontWeight: '900', marginTop: 16 },
  subtitle: { color: '#E7E5FF', fontSize: 12, lineHeight: 18, marginTop: 7 },
  form: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 20, padding: 17 },
  label: { color: colors.text, fontSize: 12, fontWeight: '800', marginTop: 13, marginBottom: 8 },
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, color: colors.text, borderRadius: 12, paddingHorizontal: 13 },
  notes: { minHeight: 96, paddingTop: 12 },
  helper: { color: colors.textSecondary, fontSize: 10, lineHeight: 16, marginTop: 13 },
  saveButton: { backgroundColor: colors.primary, borderRadius: 13, minHeight: 49, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 20 },
  saveText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  disabled: { opacity: 0.6 },
});

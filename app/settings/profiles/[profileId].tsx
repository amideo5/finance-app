import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { useMemo, useState } from 'react';
import { ArrowLeft, Check, Trash2 } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const PROFILE_TYPES = [
  { value: 'personal', label: 'Personal', emoji: '👤' },
  { value: 'family', label: 'Family', emoji: '👨‍👩‍👧‍👦' },
  { value: 'business', label: 'Business', emoji: '💼' },
  { value: 'custom', label: 'Custom', emoji: '✨' },
];

export default function EditProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ profileId?: string | string[] }>();
  const profileId = Array.isArray(params.profileId) ? params.profileId[0] : params.profileId;
  const { profiles, currentProfile, updateProfile, deleteProfile } = useProfile();
  const profile = useMemo(() => profiles.find((item) => item.id === profileId), [profiles, profileId]);
  const [name, setName] = useState(profile?.name || '');
  const [type, setType] = useState(profile?.type || 'personal');
  const [emoji, setEmoji] = useState(profile?.emoji || '👤');
  const [currency, setCurrency] = useState(profile?.currency || 'INR');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);


  const save = async () => {
    const normalizedCurrency = currency.trim().toUpperCase();
    if (!profileId || !name.trim() || !/^[A-Z]{3}$/.test(normalizedCurrency)) {
      Alert.alert('Check profile details', 'Enter a profile name and a valid three-letter currency code.');
      return;
    }
    setSaving(true);
    try {
      await updateProfile(profileId, { name: name.trim(), type, emoji, currency: normalizedCurrency });
      router.back();
    } catch (error) {
      Alert.alert('Could not update profile', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    if (!profile || profiles.length <= 1) {
      Alert.alert('Keep one profile', 'At least one finance profile must remain on your account.');
      return;
    }
    Alert.alert(
      'Delete finance profile?',
      `“${profile.name}” and its contained finance data will be permanently deleted. Shared expenses, settlements, or bank-linked investment transfers must be resolved first. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete profile', style: 'destructive', onPress: async () => {
            setDeleting(true);
            try {
              await deleteProfile(profile.id);
              router.replace('/(tabs)/settings');
            } catch (error) {
              Alert.alert('Profile was not deleted', error instanceof Error ? error.message : 'Please resolve linked records and try again.');
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  };

  if (!profile) {
    return <View style={styles.center}><Text style={styles.title}>Profile not found</Text><TouchableOpacity onPress={() => router.back()}><Text style={styles.backText}>Go back</Text></TouchableOpacity></View>;
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Edit profile', headerShown: false }} />
      <ScrollView contentContainerStyle={[styles.container, { paddingTop: Math.max(insets.top + 10, 28), paddingBottom: Math.max(insets.bottom, 20) + 24 }]} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={styles.back} onPress={() => router.back()}><ArrowLeft size={18} color={colors.text} /><Text style={styles.backText}>Settings</Text></TouchableOpacity>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>PROFILE MANAGEMENT</Text>
          <Text style={styles.heroEmoji}>{emoji}</Text>
          <Text style={styles.heroTitle}>Edit finance profile</Text>
          <Text style={styles.heroSubtitle}>Update the space used to organize your accounts, transactions and portfolio.</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>Profile name</Text>
          <TextInput value={name} onChangeText={setName} style={styles.input} placeholder="Profile name" placeholderTextColor={colors.textSecondary} maxLength={48} />
          <Text style={styles.label}>Profile type</Text>
          <View style={styles.typeGrid}>
            {PROFILE_TYPES.map((item) => {
              const selected = item.value === type;
              return <TouchableOpacity key={item.value} onPress={() => { setType(item.value); setEmoji(item.emoji); }} style={[styles.typeOption, selected && styles.typeOptionSelected]}>
                <Text style={styles.typeEmoji}>{item.emoji}</Text><Text style={[styles.typeText, selected && styles.typeTextSelected]}>{item.label}</Text>
                {selected ? <Check size={14} color={colors.primary} /> : null}
              </TouchableOpacity>;
            })}
          </View>
          <Text style={styles.label}>Profile icon (emoji)</Text>
          <TextInput value={emoji} onChangeText={setEmoji} style={styles.input} maxLength={8} placeholder="👤" />
          <Text style={styles.label}>Base currency</Text>
          <TextInput value={currency} onChangeText={setCurrency} style={styles.input} autoCapitalize="characters" maxLength={3} placeholder="INR" />
          <Text style={styles.helper}>Currency codes must contain exactly three letters, such as INR, USD or EUR.</Text>
          <TouchableOpacity style={[styles.saveButton, saving && styles.disabled]} disabled={saving} onPress={() => void save()}>
            {saving ? <ActivityIndicator color="#FFFFFF" /> : <Check size={18} color="#FFFFFF" />}<Text style={styles.saveText}>{saving ? 'Saving…' : 'Save changes'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.dangerCard}>
          <View style={styles.dangerCopy}><Text style={styles.dangerTitle}>Delete this profile</Text><Text style={styles.dangerSubtitle}>Permanently remove this profile and its contained records. Linked shared activity is protected.</Text></View>
          <TouchableOpacity disabled={deleting || profiles.length <= 1} onPress={confirmDelete} style={[styles.deleteButton, (deleting || profiles.length <= 1) && styles.disabled]}>
            {deleting ? <ActivityIndicator color={colors.danger} /> : <Trash2 size={17} color={colors.danger} />}
          </TouchableOpacity>
        </View>
        {currentProfile?.id === profile.id ? <Text style={styles.activeNote}>This is your currently active profile.</Text> : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, gap: 16, backgroundColor: colors.background, flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.background },
  back: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingVertical: 8 },
  backText: { color: colors.text, fontWeight: '700', fontSize: 13 },
  hero: { backgroundColor: colors.primary, padding: 21, borderRadius: 22 },
  eyebrow: { color: '#DCD9FF', fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  heroEmoji: { fontSize: 35, marginTop: 18 },
  heroTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: '900', marginTop: 8 },
  heroSubtitle: { color: '#E7E5FF', fontSize: 12, lineHeight: 18, marginTop: 7 },
  form: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 20, padding: 17 },
  label: { color: colors.text, fontSize: 12, fontWeight: '800', marginTop: 14, marginBottom: 8 },
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, color: colors.text, borderRadius: 12, paddingHorizontal: 13 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  typeOption: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  typeOptionSelected: { backgroundColor: '#F0EFFF', borderColor: colors.primary },
  typeEmoji: { fontSize: 16 },
  typeText: { fontSize: 11, color: colors.textSecondary, fontWeight: '700' },
  typeTextSelected: { color: colors.primary },
  helper: { color: colors.textSecondary, fontSize: 10, marginTop: 7, lineHeight: 15 },
  saveButton: { backgroundColor: colors.primary, borderRadius: 13, minHeight: 49, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 20 },
  saveText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  disabled: { opacity: 0.55 },
  dangerCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 15, borderWidth: 1, borderColor: '#F3C9CE', borderRadius: 18, backgroundColor: '#FFF8F8' },
  dangerCopy: { flex: 1 },
  dangerTitle: { color: colors.danger, fontSize: 13, fontWeight: '800' },
  dangerSubtitle: { color: colors.textSecondary, fontSize: 10, lineHeight: 15, marginTop: 4 },
  deleteButton: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#FFE8EA', alignItems: 'center', justifyContent: 'center' },
  activeNote: { color: colors.textSecondary, textAlign: 'center', fontSize: 10 },
});

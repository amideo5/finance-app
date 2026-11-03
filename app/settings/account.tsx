import { colors } from '@/src/constants/colors';
import { useAuth } from '@/src/context/AuthContext';
import { Stack, useRouter } from 'expo-router';
import { ArrowLeft, Check, UserRound } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function AccountSettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, updateAccountProfile } = useAuth();
  const [name, setName] = useState(user?.displayName || '');
  const [saving, setSaving] = useState(false);


  const save = async () => {
    if (!name.trim()) {
      Alert.alert('Name required', 'Enter the name you want shown in your account.');
      return;
    }
    setSaving(true);
    try {
      await updateAccountProfile(name);
      Alert.alert('Account updated', 'Your account name has been updated.');
      router.back();
    } catch (error) {
      Alert.alert('Could not update account', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Account details', headerShown: false }} />
      <ScrollView contentContainerStyle={[styles.container, { paddingTop: Math.max(insets.top + 10, 28), paddingBottom: Math.max(insets.bottom, 20) + 24 }]} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={styles.back} onPress={() => router.back()}>
          <ArrowLeft size={18} color={colors.text} /><Text style={styles.backText}>Settings</Text>
        </TouchableOpacity>
        <View style={styles.hero}>
          <View style={styles.avatar}><UserRound size={24} color={colors.primary} /></View>
          <Text style={styles.title}>Your account</Text>
          <Text style={styles.subtitle}>Update the name shown on your account. Your sign-in email is managed by your authentication provider.</Text>
        </View>
        <View style={styles.form}>
          <Text style={styles.label}>DISPLAY NAME</Text>
          <TextInput value={name} onChangeText={setName} style={styles.input} placeholder="Your name" placeholderTextColor={colors.textSecondary} maxLength={80} autoCapitalize="words" />
          <Text style={styles.label}>SIGN-IN EMAIL</Text>
          <TextInput value={user?.email || ''} editable={false} style={[styles.input, styles.readOnly]} />
          <TouchableOpacity style={[styles.saveButton, saving && styles.disabled]} disabled={saving} onPress={() => void save()}>
            {saving ? <ActivityIndicator color="#FFFFFF" /> : <Check size={18} color="#FFFFFF" />}
            <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save changes'}</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.note}>Account deletion and sign-in email changes are not exposed here because they require authenticated re-verification and coordinated handling of linked finance records.</Text>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: colors.background, paddingHorizontal: 20, gap: 18 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingVertical: 8 },
  backText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  hero: { backgroundColor: colors.card, borderRadius: 22, padding: 21, borderWidth: 1, borderColor: colors.border, alignItems: 'flex-start' },
  avatar: { width: 50, height: 50, borderRadius: 17, backgroundColor: '#ECEBFF', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  title: { fontSize: 24, fontWeight: '800', color: colors.text },
  subtitle: { marginTop: 7, color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  form: { backgroundColor: colors.card, padding: 18, borderRadius: 18, borderWidth: 1, borderColor: colors.border },
  label: { marginTop: 8, marginBottom: 8, color: colors.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  input: { backgroundColor: colors.background, color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13 },
  readOnly: { opacity: 0.65 },
  saveButton: { backgroundColor: colors.primary, borderRadius: 13, minHeight: 49, marginTop: 20, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  saveText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  disabled: { opacity: 0.55 },
  note: { color: colors.textSecondary, fontSize: 10, lineHeight: 16, paddingHorizontal: 4 },
});

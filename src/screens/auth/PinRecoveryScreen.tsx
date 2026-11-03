import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/src/constants/colors';
import { useAuth } from '@/src/context/AuthContext';

interface PinRecoveryScreenProps {
  onCancel: () => void;
  onSuccess: () => void;
}

export default function PinRecoveryScreen({ onCancel, onSuccess }: PinRecoveryScreenProps) {
  const { recoverPinWithPassword } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleRecover = async () => {
    setError('');
    if (!password) {
      setError('Enter your account password to continue.');
      return;
    }
    setBusy(true);
    try {
      await recoverPinWithPassword(password);
      setPassword('');
      onSuccess();
    } catch (recoveryError) {
      const code = (recoveryError as { code?: string })?.code;
      setError(code === 'auth/invalid-credential' || code === 'auth/wrong-password'
        ? 'The account password is incorrect.'
        : recoveryError instanceof Error ? recoveryError.message : 'Unable to verify your account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.icon}>🔐</Text>
        <Text style={styles.title}>Recover app access</Text>
        <Text style={styles.subtitle}>Confirm your Firebase account password. After verification, you will be asked to create a new app PIN.</Text>
        <Text style={styles.label}>Account password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Enter your password"
          placeholderTextColor={colors.textLight}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={handleRecover}
          style={styles.input}
          editable={!busy}
        />
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <TouchableOpacity style={[styles.submitButton, busy && styles.disabled]} onPress={handleRecover} disabled={busy}>
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.submitText}>Verify and reset PIN</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelButton} onPress={onCancel} disabled={busy}>
          <Text style={styles.cancelText}>Back to PIN</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, justifyContent: 'center' },
  content: { paddingHorizontal: 26, width: '100%', maxWidth: 440, alignSelf: 'center' },
  icon: { textAlign: 'center', fontSize: 42, marginBottom: 18 },
  title: { color: colors.text, fontSize: 26, fontWeight: '800', textAlign: 'center', marginBottom: 10 },
  subtitle: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 28 },
  label: { color: colors.text, fontSize: 13, fontWeight: '700', marginBottom: 8 },
  input: { minHeight: 52, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 15, color: colors.text, fontSize: 16 },
  error: { color: colors.danger, fontSize: 13, marginTop: 12, lineHeight: 18 },
  submitButton: { minHeight: 50, borderRadius: 13, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  disabled: { opacity: 0.65 },
  submitText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  cancelButton: { alignItems: 'center', padding: 16, marginTop: 6 },
  cancelText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
});

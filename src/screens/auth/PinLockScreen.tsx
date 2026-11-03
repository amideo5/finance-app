import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/src/constants/colors';
import { useAuth } from '@/src/context/AuthContext';

interface PinLockScreenProps {
  mode: 'setup' | 'verify';
  onSuccess: () => void | Promise<void>;
  onCancel?: () => void;
  biometricEnabled?: boolean;
  onBiometricPress?: () => void | Promise<void>;
  onForgotPin?: () => void;
}

type KeyValue = number | 'empty' | 'delete';
const KEYS: KeyValue[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 'empty', 0, 'delete'];

export default function PinLockScreen({
  mode,
  onSuccess,
  onCancel,
  biometricEnabled = false,
  onBiometricPress,
  onForgotPin,
}: PinLockScreenProps) {
  const { setPin, verifyPin, getPinLockoutRemaining } = useAuth();
  const [pin, setLocalPin] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [step, setStep] = useState<'enter' | 'confirm'>('enter');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleNumberPress = async (num: string) => {
    if (busy || pin.length >= 6) return;
    const nextPin = pin + num;
    setLocalPin(nextPin);
    setError('');
    if (nextPin.length !== 6) return;

    setBusy(true);
    try {
      if (mode === 'setup') {
        if (step === 'enter') {
          setFirstPin(nextPin);
          setLocalPin('');
          setStep('confirm');
          return;
        }
        if (firstPin !== nextPin) {
          setError('PINs do not match. Please start again.');
          setFirstPin('');
          setLocalPin('');
          setStep('enter');
          return;
        }
        await setPin(nextPin);
        await onSuccess();
        return;
      }

      const isValid = await verifyPin(nextPin);
      if (isValid) {
        await onSuccess();
        return;
      }

      const lockoutRemaining = await getPinLockoutRemaining();
      setError(lockoutRemaining > 0
        ? `Too many attempts. Try again in ${Math.ceil(lockoutRemaining / 1000)} seconds.`
        : 'Incorrect PIN. Please try again.');
      setLocalPin('');
    } catch (verificationError) {
      console.error('PIN operation failed:', verificationError);
      setError('Unable to verify PIN. Please try again.');
      setLocalPin('');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = () => {
    if (busy) return;
    setLocalPin((current) => current.slice(0, -1));
    setError('');
  };

  return (
    <SafeAreaView style={styles.container}>
      {onCancel ? (
        <TouchableOpacity style={styles.cancelButton} onPress={onCancel} accessibilityRole="button">
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.lockIcon}>
            <Text style={styles.lockEmoji}>🔒</Text>
          </View>
          <Text style={styles.title}>
            {mode === 'setup' ? (step === 'enter' ? 'Set Your PIN' : 'Confirm Your PIN') : 'Unlock Finance App'}
          </Text>
          <Text style={styles.subtitle}>
            {mode === 'setup'
              ? 'Create a 6-digit PIN to protect your financial information.'
              : 'Enter your 6-digit PIN to continue.'}
          </Text>
        </View>

        <View style={styles.pinDisplay}>
          {Array.from({ length: 6 }, (_, index) => (
            <View key={index} style={[styles.pinDot, index < pin.length && styles.pinDotFilled]} />
          ))}
        </View>

        {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
        {busy ? <ActivityIndicator color={colors.primary} style={styles.activity} /> : null}

        <View style={styles.keypad}>
          {KEYS.map((key, index) => {
            if (key === 'empty') return <View key={`empty-${index}`} style={styles.keyButton} />;
            return (
              <TouchableOpacity
                key={String(key)}
                style={[styles.keyButton, busy && styles.keyButtonDisabled]}
                onPress={() => key === 'delete' ? handleDelete() : void handleNumberPress(String(key))}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={key === 'delete' ? 'Delete last digit' : `Digit ${key}`}
              >
                <Text style={styles.keyText}>{key === 'delete' ? '⌫' : key}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {mode === 'verify' && biometricEnabled && onBiometricPress ? (
          <TouchableOpacity style={styles.biometricButton} onPress={() => void onBiometricPress()} disabled={busy}>
            <Text style={styles.biometricText}>Use Face ID / fingerprint</Text>
          </TouchableOpacity>
        ) : null}
        {mode === 'verify' && onForgotPin ? (
          <TouchableOpacity style={styles.forgotButton} onPress={onForgotPin} disabled={busy}>
            <Text style={styles.forgotText}>Forgot PIN?</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  cancelButton: { alignSelf: 'flex-start', paddingHorizontal: 22, paddingTop: 10, paddingBottom: 4 },
  cancelText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
  header: { alignItems: 'center', marginBottom: 38 },
  lockIcon: { width: 66, height: 66, borderRadius: 22, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  lockEmoji: { fontSize: 29 },
  title: { fontSize: 27, fontWeight: '700', color: colors.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 21, maxWidth: 280 },
  pinDisplay: { flexDirection: 'row', justifyContent: 'center', marginBottom: 26 },
  pinDot: { width: 15, height: 15, borderRadius: 8, borderWidth: 2, borderColor: colors.border, marginHorizontal: 8 },
  pinDotFilled: { backgroundColor: colors.primary, borderColor: colors.primary },
  error: { color: colors.danger, fontSize: 13, textAlign: 'center', marginBottom: 16 },
  activity: { marginBottom: 12 },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', maxWidth: 320, alignSelf: 'center' },
  keyButton: { width: 78, height: 70, margin: 7, borderRadius: 35, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  keyButtonDisabled: { opacity: 0.6 },
  keyText: { fontSize: 26, fontWeight: '600', color: colors.text },
  biometricButton: { alignSelf: 'center', marginTop: 22, paddingVertical: 12, paddingHorizontal: 18 },
  biometricText: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  forgotButton: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 18 },
  forgotText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
});

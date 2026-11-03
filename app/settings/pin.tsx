import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { SafeAreaView } from 'react-native-safe-area-context';
import PinLockScreen from '@/src/screens/auth/PinLockScreen';
import { useAuth } from '@/src/context/AuthContext';
import { colors } from '@/src/constants/colors';

type PinFlow = 'settings' | 'verify-change' | 'verify-disable' | 'setup';

export default function PinSettingsScreen() {
  const router = useRouter();
  const {
    pinConfigured,
    biometricEnabled,
    setBiometricEnabled,
    removePin,
  } = useAuth();
  const [flow, setFlow] = useState<PinFlow>(pinConfigured ? 'settings' : 'setup');
  const [busy, setBusy] = useState(false);

  const enableBiometrics = async () => {
    try {
      setBusy(true);
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !isEnrolled) {
        Alert.alert('Biometrics unavailable', 'Set up Face ID or a fingerprint in your device settings first.');
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Confirm to enable biometric unlock',
        cancelLabel: 'Cancel',
        disableDeviceFallback: true,
      });
      if (result.success) {
        await setBiometricEnabled(true);
        Alert.alert('Biometric unlock enabled', 'You can now unlock Finance App using biometrics.');
      }
    } catch (error) {
      console.error('Unable to enable biometric unlock:', error);
      Alert.alert('Could not enable biometrics', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const disableBiometrics = async () => {
    try {
      await setBiometricEnabled(false);
    } catch (error) {
      Alert.alert('Unable to update setting', error instanceof Error ? error.message : 'Please try again.');
    }
  };

  const handleDisablePin = async () => {
    try {
      await removePin();
      Alert.alert('App lock disabled', 'Your Finance App will no longer ask for a PIN.');
      router.back();
    } catch (error) {
      Alert.alert('Unable to disable app lock', error instanceof Error ? error.message : 'Please try again.');
    }
  };

  if (flow === 'setup') {
    return (
      <PinLockScreen
        mode="setup"
        onCancel={pinConfigured ? () => setFlow('settings') : () => router.back()}
        onSuccess={() => {
          setFlow('settings');
          Alert.alert('PIN enabled', 'Your Finance App is now protected by your 6-digit PIN.');
        }}
      />
    );
  }

  if (flow === 'verify-change') {
    return (
      <PinLockScreen
        mode="verify"
        onCancel={() => setFlow('settings')}
        onSuccess={() => setFlow('setup')}
      />
    );
  }

  if (flow === 'verify-disable') {
    return (
      <PinLockScreen
        mode="verify"
        onCancel={() => setFlow('settings')}
        onSuccess={handleDisablePin}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>‹  Settings</Text>
        </TouchableOpacity>
        <Text style={styles.title}>App Security</Text>
        <Text style={styles.subtitle}>Protect access to your financial information on this device.</Text>

        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.textColumn}>
              <Text style={styles.rowTitle}>App PIN</Text>
              <Text style={styles.rowDescription}>A 6-digit PIN is required after opening the app or returning from the background.</Text>
            </View>
            <Text style={styles.enabledLabel}>Enabled</Text>
          </View>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.actionRow} onPress={() => setFlow('verify-change')}>
            <Text style={styles.actionText}>Change PIN</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.actionRow} onPress={() => setFlow('verify-disable')}>
            <Text style={styles.dangerText}>Disable app PIN</Text>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.textColumn}>
              <Text style={styles.rowTitle}>Biometric unlock</Text>
              <Text style={styles.rowDescription}>Use Face ID or fingerprint after enabling it on this device.</Text>
            </View>
            <Text style={biometricEnabled ? styles.enabledLabel : styles.disabledLabel}>
              {biometricEnabled ? 'Enabled' : 'Off'}
            </Text>
          </View>
          <View style={styles.divider} />
          <TouchableOpacity
            style={[styles.primaryButton, busy && styles.buttonDisabled]}
            disabled={busy}
            onPress={biometricEnabled ? disableBiometrics : enableBiometrics}
          >
            <Text style={styles.primaryButtonText}>
              {busy ? 'Please wait…' : biometricEnabled ? 'Turn off biometric unlock' : 'Enable biometric unlock'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.noteCard}>
          <Text style={styles.noteText}>After 5 incorrect PIN attempts, app unlock is paused for 60 seconds. Your Firebase account remains signed in.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { padding: 22, paddingBottom: 40 },
  backButton: { alignSelf: 'flex-start', paddingVertical: 8, marginBottom: 14 },
  backText: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  title: { color: colors.text, fontSize: 28, fontWeight: '800', marginBottom: 7 },
  subtitle: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, marginBottom: 22 },
  card: { backgroundColor: colors.card, borderRadius: 18, padding: 18, marginBottom: 16, borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  textColumn: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: 5 },
  rowDescription: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  enabledLabel: { color: colors.success, fontSize: 12, fontWeight: '800' },
  disabledLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 15 },
  actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 34 },
  actionText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  dangerText: { color: colors.danger, fontSize: 14, fontWeight: '700' },
  chevron: { color: colors.textSecondary, fontSize: 25, lineHeight: 25 },
  primaryButton: { backgroundColor: colors.primary, minHeight: 46, justifyContent: 'center', alignItems: 'center', borderRadius: 12 },
  buttonDisabled: { opacity: 0.55 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  noteCard: { backgroundColor: '#F0F2FF', borderRadius: 14, padding: 14 },
  noteText: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
});

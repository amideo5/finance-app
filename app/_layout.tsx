import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { AuthProvider, useAuth } from '@/src/context/AuthContext';
import { ProfileProvider } from '@/src/context/ProfileContext';
import PinLockScreen from '@/src/screens/auth/PinLockScreen';
import PinRecoveryScreen from '@/src/screens/auth/PinRecoveryScreen';
import * as LocalAuthentication from 'expo-local-authentication';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Modal, StyleSheet, View } from 'react-native';

function RootNavigation() {
  const {
    user,
    loading,
    pinConfigured,
    biometricEnabled,
    isAppUnlocked,
    lockApp,
    unlockApp,
  } = useAuth();
  const router = useRouter();
  const [showPinRecovery, setShowPinRecovery] = useState(false);
  // Keep all app screens covered while Firebase and secure lock settings hydrate.
  const isLocked = loading || Boolean(user && (!pinConfigured || !isAppUnlocked));

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/auth/login');
    } else {
      router.replace('/(tabs)');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user || !pinConfigured) return;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        lockApp();
      }
    });
    return () => subscription.remove();
  }, [user?.uid, pinConfigured, lockApp]);

  const handleBiometricUnlock = async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Finance App',
        cancelLabel: 'Use PIN',
        disableDeviceFallback: true,
      });
      if (result.success) unlockApp();
    } catch (error) {
      console.error('Biometric authentication failed:', error);
      Alert.alert('Biometric unlock unavailable', 'Please unlock using your app PIN.');
    }
  };

  return (
    <View style={styles.root}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="auth/login" />
        <Stack.Screen name="auth/signup" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="investments" />
        <Stack.Screen name="statement" options={{ presentation: 'card' }} />
        <Stack.Screen name="transactions/add-expense" options={{ presentation: 'modal' }} />
        <Stack.Screen name="+not-found" />
      </Stack>

      <Modal
        visible={isLocked}
        animationType="fade"
        presentationStyle="fullScreen"
        transparent={false}
        statusBarTranslucent
        onRequestClose={() => {
          // App lock cannot be dismissed with the Android back button.
        }}
      >
        <View style={styles.lockModal}>
          {loading ? (
            <ActivityIndicator size="large" color="#6157E8" />
          ) : showPinRecovery ? (
            <PinRecoveryScreen
              onCancel={() => setShowPinRecovery(false)}
              onSuccess={() => {
                setShowPinRecovery(false);
                router.replace('/settings/pin');
              }}
            />
          ) : !pinConfigured ? (
            <PinLockScreen
              mode="setup"
              onSuccess={unlockApp}
            />
          ) : (
            <PinLockScreen
              mode="verify"
              onSuccess={unlockApp}
              biometricEnabled={biometricEnabled}
              onBiometricPress={biometricEnabled ? handleBiometricUnlock : undefined}
              onForgotPin={user?.providerData.some((provider) => provider.providerId === 'password') ? () => setShowPinRecovery(true) : undefined}
            />
          )}
        </View>
      </Modal>
      <StatusBar style={isLocked ? 'dark' : 'auto'} />
    </View>
  );
}

export default function RootLayout() {
  useFrameworkReady();
  return (
    <AuthProvider>
      <ProfileProvider>
        <RootNavigation />
      </ProfileProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  lockModal: {
    flex: 1,
    backgroundColor: '#F5F6FC',
  },
});

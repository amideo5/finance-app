import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { AuthProvider, useAuth } from '@/src/context/AuthContext';
import { ProfileProvider } from '@/src/context/ProfileContext';
import React, { useEffect } from 'react';

function RootNavigation() {
  const { user, loading } = useAuth();
  const router = useRouter();

  // 🚀 Redirect based on auth status
  useEffect(() => {
    if (loading) return;

    if (!user) {
      router.replace('/auth/login'); // Logged out → go to login
    } else {
      router.replace('/(tabs)'); // Logged in → go to tabs
    }
  }, [user, loading]);

  return (
    <>
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

      <StatusBar style="auto" />
    </>
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
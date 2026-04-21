import React from 'react';
import { View } from 'react-native';
import PinLockScreen from '@/src/screens/auth/PinLockScreen'; // adjust path!!

export default function PinSettingsScreen() {
  return (
    <View style={{ flex: 1 }}>
      <PinLockScreen 
        mode="setup"
        onSuccess={() => {
          // after setting PIN, you can redirect anywhere
        }}
      />
    </View>
  );
}

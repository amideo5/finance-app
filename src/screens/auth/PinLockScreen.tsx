import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors } from '@/src/constants/colors';
import { useAuth } from '@/src/context/AuthContext';

interface PinLockScreenProps {
  mode: 'setup' | 'verify';
  onSuccess: () => void;
}

export default function PinLockScreen({ mode, onSuccess }: PinLockScreenProps) {
  const { setPin, verifyPin } = useAuth();
  const [pin, setLocalPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [step, setStep] = useState<'enter' | 'confirm'>('enter');
  const [error, setError] = useState('');

  const handleNumberPress = (num: string) => {
    if (pin.length >= 6) return;

    const newPin = pin + num;
    setLocalPin(newPin);

    if (mode === 'setup') {
      if (step === 'enter' && newPin.length === 6) {
        setConfirmPin('');
        setStep('confirm');
        setLocalPin('');
      } else if (step === 'confirm' && newPin.length === 6) {
        if (confirmPin === newPin) {
          setPin(newPin).then(() => {
            onSuccess();
          });
        } else {
          setError('PINs do not match');
          setLocalPin('');
          setConfirmPin('');
          setStep('enter');
        }
      }
      if (step === 'enter' && newPin.length === 6) {
        setConfirmPin(newPin);
      }
    } else {
      if (newPin.length === 6) {
        verifyPin(newPin).then((isValid) => {
          if (isValid) {
            onSuccess();
          } else {
            setError('Incorrect PIN');
            setLocalPin('');
          }
        });
      }
    }
  };

  const handleDelete = () => {
    setLocalPin(pin.slice(0, -1));
    setError('');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>
          {mode === 'setup'
            ? step === 'enter'
              ? 'Set Your PIN'
              : 'Confirm PIN'
            : 'Enter PIN'}
        </Text>
        <Text style={styles.subtitle}>
          {mode === 'setup'
            ? 'Create a 4-6 digit PIN to secure your app'
            : 'Enter your PIN to unlock'}
        </Text>
      </View>

      <View style={styles.pinDisplay}>
        {[...Array(6)].map((_, i) => (
          <View
            key={i}
            style={[
              styles.pinDot,
              i < pin.length && styles.pinDotFilled,
            ]}
          />
        ))}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.keypad}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, 'delete'].map((key, index) => {
          if (key === '') {
            return <View key={index} style={styles.keyButton} />;
          }

          return (
            <TouchableOpacity
              key={index}
              style={styles.keyButton}
              onPress={() => {
                if (key === 'delete') {
                  handleDelete();
                } else {
                  handleNumberPress(key.toString());
                }
              }}
            >
              <Text style={styles.keyText}>
                {key === 'delete' ? '⌫' : key}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 24,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  pinDisplay: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 48,
  },
  pinDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.border,
    marginHorizontal: 8,
  },
  pinDotFilled: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  error: {
    color: colors.danger,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
  },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    maxWidth: 320,
    alignSelf: 'center',
  },
  keyButton: {
    width: 80,
    height: 80,
    margin: 8,
    borderRadius: 40,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  keyText: {
    fontSize: 28,
    fontWeight: '600',
    color: colors.text,
  },
});

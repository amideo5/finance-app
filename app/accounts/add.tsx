import Button from '@/src/components/ui/Button';
import { ACCOUNT_TYPES } from '@/src/constants/categories';
import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { addAccount } from '@/src/services/firebase/accountsService';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function AddAccountScreen() {
  const router = useRouter();
  const { currentProfile } = useProfile();
  const [name, setName] = useState('');
  const [type, setType] = useState('cash');
  const [balance, setBalance] = useState('0');
  const [accountNumber, setAccountNumber] = useState('');
  const [loading, setLoading] = useState(false);

  const saveAccount = async () => {
    const initialBalance = Number(balance);
    if (!name.trim() || !Number.isFinite(initialBalance)) {
      Alert.alert('Check account details', 'Enter a name and a valid balance.');
      return;
    }
    if (!currentProfile) {
      Alert.alert('Profile unavailable', 'Select a profile before adding an account.');
      return;
    }

    setLoading(true);
    try {
      await addAccount(currentProfile.id, {
        name: name.trim(),
        type,
        balance: initialBalance,
        account_number: accountNumber.trim() || null,
        currency: currentProfile.currency || 'INR',
      });
      router.back();
    } catch (error) {
      console.error('Error creating account:', error);
      Alert.alert('Error', 'Could not save this account. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Add Account</Text>
      <Text style={styles.label}>Account name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Main bank" placeholderTextColor={colors.textSecondary} />

      <Text style={styles.label}>Account type</Text>
      <View style={styles.options}>
        {ACCOUNT_TYPES.map((accountType) => (
          <TouchableOpacity key={accountType.type} onPress={() => setType(accountType.type)} style={[styles.option, type === accountType.type && styles.selected]}>
            <Text style={styles.optionText}>{accountType.icon} {accountType.name}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Current balance</Text>
      <TextInput style={styles.input} value={balance} onChangeText={setBalance} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.textSecondary} />
      <Text style={styles.label}>Account number (optional)</Text>
      <TextInput style={styles.input} value={accountNumber} onChangeText={setAccountNumber} placeholder="Last few digits or label" placeholderTextColor={colors.textSecondary} />
      <Button title="Save Account" onPress={saveAccount} loading={loading} disabled={!name.trim()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, paddingTop: 56, backgroundColor: colors.background },
  title: { color: colors.text, fontSize: 26, fontWeight: '700', marginBottom: 24 },
  label: { color: colors.text, fontWeight: '600', marginBottom: 8, marginTop: 12 },
  input: { color: colors.text, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 10 },
  selected: { backgroundColor: colors.primary, borderColor: colors.primary },
  optionText: { color: colors.text },
});

import Button from '@/src/components/ui/Button';
import { ACCOUNT_TYPES } from '@/src/constants/categories';
import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { addAccount, deleteAccount, getAccounts, updateAccount } from '@/src/services/firebase/accountsService';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Check, CreditCard, Landmark, Wallet, Trash2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function AddAccountScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ accountId?: string | string[] }>();
  const accountId = Array.isArray(params.accountId) ? params.accountId[0] : params.accountId;
  const { currentProfile } = useProfile();
  const [name, setName] = useState('');
  const [type, setType] = useState('cash');
  const [balance, setBalance] = useState('0');
  const [accountNumber, setAccountNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(Boolean(accountId));
  const isEditing = Boolean(accountId);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!accountId || !currentProfile) { setInitialLoading(false); return; }
      try {
        const list = await getAccounts(currentProfile.id);
        const account = list.find((item) => item.id === accountId);
        if (!account) throw new Error('This account could not be found.');
        if (!active) return;
        setName(String(account.name || ''));
        setType(String(account.type || 'cash'));
        setBalance(String(account.balance ?? 0));
        setAccountNumber(String(account.account_number || ''));
      } catch (error) {
        if (active) Alert.alert('Could not load account', error instanceof Error ? error.message : 'Please try again.');
      } finally { if (active) setInitialLoading(false); }
    };
    void load();
    return () => { active = false; };
  }, [accountId, currentProfile]);

  const saveAccount = async () => {
    const initialBalance = Number(balance);
    if (!name.trim() || (!isEditing && !Number.isFinite(initialBalance))) {
      Alert.alert('Check account details', 'Enter a name and a valid balance.');
      return;
    }
    if (!isEditing && initialBalance < 0) {
      Alert.alert('Invalid balance', 'An account cannot start with a negative available balance. Enter zero or a positive amount.');
      return;
    }
    if (!currentProfile) {
      Alert.alert('Profile unavailable', 'Select a profile before adding an account.');
      return;
    }
    setLoading(true);
    try {
      if (isEditing && accountId) {
        await updateAccount(currentProfile.id, accountId, { name: name.trim(), type, account_number: accountNumber.trim() || null });
      } else {
        await addAccount(currentProfile.id, {
          name: name.trim(), type, balance: initialBalance,
          account_number: accountNumber.trim() || null, currency: currentProfile.currency || 'INR',
        });
      }
      router.back();
    } catch (error) {
      console.error('Error creating account:', error);
      Alert.alert('Error', error instanceof Error ? error.message : 'Could not save this account. Please try again.');
    } finally { setLoading(false); }
  };

  const confirmDelete = () => {
    if (!currentProfile || !accountId) return;
    Alert.alert('Delete account?', 'This removes the account only when no transactions or investment records reference it. Account balances are not edited here.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        setLoading(true);
        try { await deleteAccount(currentProfile.id, accountId); router.back(); }
        catch (error) { Alert.alert('Account was not deleted', error instanceof Error ? error.message : 'Please try again.'); }
        finally { setLoading(false); }
      } },
    ]);
  };

  if (initialLoading) return <View style={styles.loading}><ActivityIndicator color={colors.primary} size="large" /></View>;

  return (
    <>
      <Stack.Screen options={{ title: isEditing ? 'Edit account' : 'Add account', headerShown: false }} />
      <ScrollView style={styles.screen} contentContainerStyle={[
        styles.container,
        { paddingTop: Math.max(insets.top + 8, 24), paddingBottom: Math.max(insets.bottom, 16) + 28 },
      ]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.75}>
          <ArrowLeft size={18} color={colors.text} />
          <Text style={styles.backText}>Accounts</Text>
        </TouchableOpacity>

        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            {type === 'cash' ? <Wallet size={25} color={colors.primary} /> : <Landmark size={25} color={colors.primary} />}
          </View>
          <Text style={styles.title}>{isEditing ? 'Edit account' : 'Add an account'}</Text>
          <Text style={styles.subtitle}>{isEditing ? 'Update your account details.' : 'Keep your cash and bank balances organised in one place.'}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account details</Text>
          <View style={styles.card}>
            <Text style={styles.label}>ACCOUNT NAME</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Main bank account" placeholderTextColor={colors.textSecondary} returnKeyType="next" maxLength={50} />
            <Text style={styles.label}>ACCOUNT TYPE</Text>
            <View style={styles.options}>
              {ACCOUNT_TYPES.map((accountType) => {
                const selected = type === accountType.type;
                return (
                  <TouchableOpacity key={accountType.type} onPress={() => setType(accountType.type)} activeOpacity={0.8}
                    style={[styles.option, selected && styles.selected]} accessibilityRole="radio" accessibilityState={{ selected }}>
                    <Text style={styles.optionEmoji}>{accountType.icon}</Text>
                    <Text style={[styles.optionText, selected && styles.selectedOptionText]}>{accountType.name}</Text>
                    {selected ? <Check size={15} color={colors.primary} /> : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{isEditing ? 'Account information' : 'Starting balance'}</Text>
          <View style={styles.card}>
            {!isEditing ? <>
              <Text style={styles.label}>OPENING BALANCE</Text>
              <View style={styles.amountField}>
                <Text style={styles.currency}>₹</Text>
                <TextInput style={styles.amountInput} value={balance} onChangeText={setBalance} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.textSecondary} />
              </View>
              <Text style={styles.hint}>Enter the amount currently available in this account.</Text>
            </> : <>
              <View style={styles.balanceReadOnly}>
                <View style={styles.balanceIcon}><Wallet size={18} color={colors.primary} /></View>
                <View style={styles.balanceCopy}>
                  <Text style={styles.balanceCaption}>CURRENT BALANCE</Text>
                  <Text style={styles.balanceValue}>₹{Number(balance || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</Text>
                </View>
                <View style={styles.readOnlyBadge}><Text style={styles.readOnlyText}>Read only</Text></View>
              </View>
              <Text style={styles.hint}>Balance is calculated from the opening amount and linked transactions. Edit transactions to correct it.</Text>
            </>}
            <View style={styles.divider} />
            <Text style={styles.label}>ACCOUNT NUMBER <Text style={styles.optional}>(OPTIONAL)</Text></Text>
            <View style={styles.numberField}>
              <CreditCard size={17} color={colors.textSecondary} />
              <TextInput style={styles.numberInput} value={accountNumber} onChangeText={setAccountNumber} placeholder="Last few digits or a label" placeholderTextColor={colors.textSecondary} autoCapitalize="none" maxLength={30} />
            </View>
          </View>
        </View>

        <Button title={isEditing ? 'Save changes' : 'Save account'} onPress={saveAccount} loading={loading} disabled={!name.trim() || loading} style={styles.saveButton} />
        {isEditing ? <TouchableOpacity style={styles.deleteButton} onPress={confirmDelete} disabled={loading} activeOpacity={0.8}>
          <Trash2 size={17} color={colors.danger} /><Text style={styles.deleteText}>Delete account</Text>
        </TouchableOpacity> : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, paddingHorizontal: 20 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  backButton: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingVertical: 8, marginBottom: 18 },
  backText: { color: colors.text, fontWeight: '700', fontSize: 13 },
  hero: { marginBottom: 24 },
  heroIcon: { width: 54, height: 54, borderRadius: 18, backgroundColor: '#EAE9FF', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  title: { color: colors.text, fontSize: 27, fontWeight: '800', letterSpacing: -0.7 },
  subtitle: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 6, maxWidth: 300 },
  section: { marginBottom: 18 },
  sectionTitle: { color: colors.text, fontSize: 14, fontWeight: '800', marginBottom: 10 },
  card: { backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 16 },
  label: { color: colors.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 0.8, marginBottom: 8, marginTop: 4 },
  optional: { fontWeight: '600', letterSpacing: 0, fontSize: 9 },
  input: { color: colors.text, backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1, borderRadius: 13, paddingHorizontal: 14, paddingVertical: 13, fontSize: 14 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 13, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  selected: { backgroundColor: '#F0EFFF', borderColor: colors.primary },
  optionEmoji: { fontSize: 15 },
  optionText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  selectedOptionText: { color: colors.primary },
  amountField: { minHeight: 58, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 15 },
  currency: { color: colors.textSecondary, fontSize: 22, fontWeight: '700', marginRight: 8 },
  amountInput: { flex: 1, color: colors.text, fontSize: 24, fontWeight: '800', paddingVertical: 10 },
  hint: { color: colors.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 7 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 16 },
  numberField: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 13, paddingHorizontal: 13 },
  numberInput: { flex: 1, color: colors.text, fontSize: 13, paddingVertical: 11 },
  balanceReadOnly: { flexDirection: 'row', alignItems: 'center' },
  balanceIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#EAE9FF', alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  balanceCopy: { flex: 1 },
  balanceCaption: { color: colors.textSecondary, fontSize: 9, fontWeight: '800', letterSpacing: 0.7 },
  balanceValue: { color: colors.text, fontSize: 21, fontWeight: '800', marginTop: 3 },
  readOnlyBadge: { backgroundColor: colors.background, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  readOnlyText: { color: colors.textSecondary, fontSize: 9, fontWeight: '700' },
  saveButton: { marginTop: 5 },
  deleteButton: { minHeight: 48, borderRadius: 13, borderWidth: 1, borderColor: '#F1C7CB', backgroundColor: '#FFF5F5', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 13 },
  deleteText: { color: colors.danger, fontWeight: '800', fontSize: 13 },
});

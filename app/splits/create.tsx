import { useLocalSearchParams, useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { db } from '@/src/firebaseConfig';
import { getUserFriends } from '@/src/services/firebase/friendsService';
import { createSplit } from '@/src/services/firebase/splitService';
import { allocateEqualShares, validateCustomShares } from '@/src/utils/splitUtils';
import type { SplitParticipant } from '@/types/finance';

interface SourceExpense {
  id: string;
  amount: number;
  currency?: string;
  type: string;
  date: string;
  category?: string;
  notes?: string | null;
  kind?: string;
}

function rupeesToPaise(value: string, allowZero = false): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const paise = Math.round(Number(value) * 100);
  return Number.isSafeInteger(paise) && (allowZero ? paise >= 0 : paise > 0) ? paise : null;
}

const money = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

export default function CreateSplit() {
  const params = useLocalSearchParams<{ txId?: string | string[] }>();
  const routeTransactionId = Array.isArray(params.txId) ? params.txId[0] : params.txId;
  const { currentProfile } = useProfile();
  const router = useRouter();
  const userId = currentProfile?.userId;

  const [selectedTransactionId, setSelectedTransactionId] = useState(routeTransactionId || '');
  const [source, setSource] = useState<SourceExpense | null>(null);
  const [eligibleExpenses, setEligibleExpenses] = useState<SourceExpense[]>([]);
  const [friends, setFriends] = useState<any[]>([]);
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [includeCreator, setIncludeCreator] = useState(true);
  const [splitType, setSplitType] = useState<'equal' | 'custom'>('equal');
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!currentProfile) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        setSource(null);
        const friendRowsPromise = getUserFriends(currentProfile.userId);
        const transactionRowsPromise = selectedTransactionId
          ? getDoc(doc(db, 'profiles', currentProfile.id, 'transactions', selectedTransactionId)).then((snapshot) => snapshot.exists()
            ? [{ id: snapshot.id, ...snapshot.data() }]
            : [])
          : getDocs(collection(db, 'profiles', currentProfile.id, 'transactions')).then((snapshot) => snapshot.docs.map((transactionDoc) => ({
            id: transactionDoc.id,
            ...transactionDoc.data(),
          })));
        const [transactionRows, friendRows] = await Promise.all([transactionRowsPromise, friendRowsPromise]);
        if (!mounted) return;
        const eligible = transactionRows
          .filter((transaction: any) => transaction.type === 'expense' && !transaction.kind && transaction.currency === 'INR')
          .sort((a: any, b: any) => String(b.date || '').localeCompare(String(a.date || '')))
          .map((transaction: any) => ({ id: transaction.id, ...transaction } as SourceExpense));
        setEligibleExpenses(eligible);
        if (selectedTransactionId && eligible.length > 0) {
          setSource(eligible[0]);
          setTitle(eligible[0].category ? `${eligible[0].category} split` : 'Shared expense');
        }
        setFriends(friendRows);
      } catch (error) {
        console.error('Unable to load split source/friends', error);
        Alert.alert('Unable to load', 'Could not load the expense or your accepted friends.');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => { mounted = false; };
  }, [currentProfile, selectedTransactionId]);

  const totalAmountInPaise = source ? Math.round(Number(source.amount) * 100) : 0;
  const participantIds = useMemo(() => [
    ...(includeCreator && userId ? [userId] : []),
    ...selectedFriends,
  ], [includeCreator, selectedFriends, userId]);

  const friendNames = useMemo(() => new Map<string, string>(friends.map((friend) => [
    friend.friendId,
    friend.profileData?.name || friend.friendId,
  ])), [friends]);

  const toggleFriend = (id: string) => {
    setSelectedFriends((previous) => previous.includes(id)
      ? previous.filter((friendId) => friendId !== id)
      : [...previous, id]);
  };

  const allocations: SplitParticipant[] = useMemo(() => {
    if (!source || participantIds.length === 0 || totalAmountInPaise <= 0) return [];
    try {
      if (splitType === 'equal') return allocateEqualShares(totalAmountInPaise, participantIds);
      return participantIds.map((participantId) => ({
        userId: participantId,
        shareAmountInPaise: rupeesToPaise(customAmounts[participantId] ?? '', true) ?? 0,
      }));
    } catch {
      return [];
    }
  }, [customAmounts, participantIds, source, splitType, totalAmountInPaise]);

  const allocationTotal = allocations.reduce((sum, participant) => sum + participant.shareAmountInPaise, 0);
  const allocationValid = Boolean(source && allocations.length > 0 && allocationTotal === totalAmountInPaise
    && allocations.every((item) => Number.isSafeInteger(item.shareAmountInPaise))
    && (splitType === 'equal' || participantIds.every((id) => rupeesToPaise(customAmounts[id] ?? '', true) !== null)));

  const handleCreate = async () => {
    if (!currentProfile || !source || !userId || !selectedTransactionId) {
      Alert.alert('Expense required', 'Choose a valid expense from your active profile.');
      return;
    }
    if (participantIds.length === 0) {
      Alert.alert('Participants required', 'Include yourself or select at least one friend.');
      return;
    }
    if (!title.trim()) {
      Alert.alert('Title required', 'Enter a title for this shared expense.');
      return;
    }
    try {
      if (splitType === 'custom') validateCustomShares(totalAmountInPaise, allocations);
      else if (allocationTotal !== totalAmountInPaise) throw new Error('Shares do not add up to the source expense.');
      setSaving(true);
      await createSplit({
        sourceProfileId: currentProfile.id,
        sourceTransactionId: selectedTransactionId,
        title: title.trim(),
        description: description.trim() || undefined,
        type: splitType,
        participants: allocations.map((participant) => ({
          ...participant,
          displayName: participant.userId === userId ? currentProfile.name : friendNames.get(participant.userId),
        })),
      });
      Alert.alert('Split created', 'The expense is linked and your friends can now acknowledge repayment.');
      router.back();
    } catch (error) {
      console.error('Unable to create shared expense', error);
      Alert.alert('Could not create split', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <View style={styles.center}><Text>Loading eligible expense…</Text></View>;
  if (!source) return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={() => router.back()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
      <Text style={styles.title}>{selectedTransactionId ? 'Expense unavailable' : 'Choose an expense'}</Text>
      <Text style={styles.help}>Select an existing INR expense from your active profile. The original transaction will not be changed.</Text>
      {selectedTransactionId && <TouchableOpacity style={styles.button} onPress={() => setSelectedTransactionId('')}><Text style={styles.buttonText}>Choose a different expense</Text></TouchableOpacity>}
      {!selectedTransactionId && eligibleExpenses.map((expense) => (
        <TouchableOpacity key={expense.id} style={styles.card} onPress={() => setSelectedTransactionId(expense.id)}>
          <Text style={styles.choiceTitle}>{expense.category || 'Expense'} · {expense.date}</Text>
          <Text style={styles.shareAmount}>₹{Number(expense.amount).toFixed(2)}</Text>
          {expense.notes ? <Text style={styles.help}>{expense.notes}</Text> : null}
        </TouchableOpacity>
      ))}
      {!selectedTransactionId && eligibleExpenses.length === 0 && <Text style={styles.help}>No eligible INR expenses were found in this profile.</Text>}
    </ScrollView>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <TouchableOpacity onPress={() => router.back()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
      <Text style={styles.title}>Create shared expense</Text>
      <Text style={styles.subtitle}>Original payment by {currentProfile?.name || 'you'}</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Linked expense</Text>
        <Text style={styles.amount}>{money(totalAmountInPaise)}</Text>
        <Text style={styles.help}>{source.category || 'Expense'} · {source.date}</Text>
        <Text style={styles.note}>The original transaction stays unchanged. It will not be duplicated.</Text>
      </View>

      <Text style={styles.label}>Title</Text>
      <TextInput value={title} onChangeText={setTitle} style={styles.input} placeholder="Dinner, trip, groceries…" />
      <Text style={styles.label}>Description (optional)</Text>
      <TextInput value={description} onChangeText={setDescription} style={[styles.input, styles.multiline]} multiline placeholder="Add a note" />

      <Text style={styles.sectionTitle}>Allocation participants</Text>
      <TouchableOpacity style={styles.choice} onPress={() => setIncludeCreator((value) => !value)}>
        <Text style={[styles.checkbox, includeCreator && styles.checked]}>{includeCreator ? '✓' : ''}</Text>
        <View style={styles.choiceBody}>
          <Text style={styles.choiceTitle}>Include me in the expense allocation</Text>
          <Text style={styles.help}>{includeCreator ? 'Your share is included normally.' : 'Your allocation is zero; other shares cover the full expense.'}</Text>
        </View>
      </TouchableOpacity>
      {friends.map((friend) => {
        const active = selectedFriends.includes(friend.friendId);
        return (
          <TouchableOpacity key={friend.friendId} style={styles.choice} onPress={() => toggleFriend(friend.friendId)}>
            <Text style={[styles.checkbox, active && styles.checked]}>{active ? '✓' : ''}</Text>
            <Text style={styles.choiceTitle}>{friend.profileData?.name || friend.friendId}</Text>
          </TouchableOpacity>
        );
      })}
      {friends.length === 0 && <Text style={styles.help}>No accepted friends yet.</Text>}

      <Text style={styles.sectionTitle}>Share method</Text>
      <View style={styles.toggleRow}>
        {(['equal', 'custom'] as const).map((method) => (
          <TouchableOpacity key={method} style={[styles.toggle, splitType === method && styles.toggleActive]} onPress={() => setSplitType(method)}>
            <Text style={[styles.toggleText, splitType === method && styles.toggleTextActive]}>{method === 'equal' ? 'Equal split' : 'Custom shares'}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {allocations.map((participant) => (
        <View key={participant.userId} style={styles.shareRow}>
          <Text style={styles.choiceTitle}>{participant.userId === userId ? 'You (payer)' : friendNames.get(participant.userId) || participant.userId}</Text>
          {splitType === 'custom' ? (
            <TextInput
              value={customAmounts[participant.userId] ?? ''}
              onChangeText={(value) => setCustomAmounts((previous) => ({ ...previous, [participant.userId]: value }))}
              placeholder="₹0.00"
              keyboardType="decimal-pad"
              style={[styles.amountInput, customAmounts[participant.userId] !== undefined && rupeesToPaise(customAmounts[participant.userId], true) === null && styles.invalidInput]}
            />
          ) : <Text style={styles.shareAmount}>{money(participant.shareAmountInPaise)}</Text>}
        </View>
      ))}

      <View style={styles.review}>
        <Text style={styles.sectionTitle}>Review</Text>
        <Text style={styles.reviewLine}>Expense total: {money(totalAmountInPaise)}</Text>
        <Text style={styles.reviewLine}>Allocated total: {money(allocationTotal)}</Text>
        <Text style={[styles.reviewLine, allocationValid ? styles.valid : styles.invalid]}>
          {allocationValid ? 'Shares reconcile exactly' : 'Shares must equal the linked expense total'}
        </Text>
      </View>

      <TouchableOpacity disabled={!allocationValid || saving} style={[styles.button, (!allocationValid || saving) && styles.buttonDisabled]} onPress={() => void handleCreate()}>
        <Text style={styles.buttonText}>{saving ? 'Creating…' : 'Create split'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  back: { color: colors.primary, marginBottom: 18, fontWeight: '600' },
  title: { color: colors.text, fontSize: 25, fontWeight: '700' },
  subtitle: { color: colors.textSecondary, marginTop: 6, marginBottom: 18 },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: 18, marginBottom: 18 },
  label: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 7 },
  amount: { color: colors.text, fontSize: 30, fontWeight: '700', marginVertical: 4 },
  help: { color: colors.textSecondary, fontSize: 13, marginTop: 3 },
  note: { color: colors.textSecondary, fontSize: 12, marginTop: 12 },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, marginBottom: 14, color: colors.text },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '700', marginTop: 12, marginBottom: 10 },
  choice: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  choiceBody: { flex: 1 },
  checkbox: { borderWidth: 1, borderColor: colors.border, width: 22, height: 22, borderRadius: 6, textAlign: 'center', color: '#fff', overflow: 'hidden' },
  checked: { backgroundColor: colors.primary, borderColor: colors.primary },
  choiceTitle: { color: colors.text, fontWeight: '500', flex: 1 },
  toggleRow: { flexDirection: 'row', gap: 8 },
  toggle: { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12, alignItems: 'center' },
  toggleActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  toggleText: { color: colors.textSecondary, fontWeight: '600' },
  toggleTextActive: { color: '#fff' },
  shareRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 10 },
  shareAmount: { color: colors.text, fontWeight: '700' },
  amountInput: { minWidth: 110, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 8, textAlign: 'right', color: colors.text },
  invalidInput: { borderColor: colors.expense },
  review: { backgroundColor: colors.card, borderRadius: 12, padding: 16, marginTop: 18 },
  reviewLine: { color: colors.text, marginTop: 5 },
  valid: { color: colors.income, fontWeight: '600' },
  invalid: { color: colors.expense, fontWeight: '600' },
  button: { marginTop: 20, padding: 16, borderRadius: 12, backgroundColor: colors.primary },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { textAlign: 'center', color: '#fff', fontWeight: '700' },
});

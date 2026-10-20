import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { acceptRepayment, cancelRepayment, cancelSplit, getSplit, getSplitSettlements, rejectRepayment, requestRepayment } from '@/src/services/firebase/splitService';
import type { SharedExpenseSplit, SplitSettlement } from '@/types/finance';

const money = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
const paiseInput = (value: string) => /^\d+(?:\.\d{1,2})?$/.test(value.trim()) ? Math.round(Number(value) * 100) : 0;

export default function SplitDetail() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const splitId = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const { currentProfile } = useProfile();
  const [split, setSplit] = useState<SharedExpenseSplit | null>(null);
  const [settlements, setSettlements] = useState<SplitSettlement[]>([]);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!splitId) return;
    setLoading(true);
    try {
      const [currentSplit, history] = await Promise.all([getSplit(splitId), getSplitSettlements(splitId)]);
      setSplit(currentSplit);
      setSettlements(history.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))));
    } catch (error) {
      console.error('Unable to load split details', error);
      Alert.alert('Unable to load', 'Could not load this split.');
    } finally {
      setLoading(false);
    }
  }, [splitId]);

  useEffect(() => {
    // Async Firestore refresh is applied after the effect returns.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const act = async (action: () => Promise<unknown>, successMessage: string, afterRefresh?: () => void | Promise<void>) => {
    setBusy(true);
    try {
      await action();
      await refresh();
      await afterRefresh?.();
      Alert.alert('Updated', successMessage);
    } catch (error) {
      Alert.alert('Unable to update', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <View style={styles.center}><Text>Loading split…</Text></View>;
  if (!split || !currentProfile) return <View style={styles.center}><Text>Split not found or unavailable.</Text></View>;
  const userId = currentProfile.userId;
  const isCreditor = userId === split.paidByUserId;
  const myObligations = split.obligations.filter((obligation) => obligation.fromUserId === userId);
  const outstanding = myObligations.reduce((sum, obligation) => sum + obligation.amountInPaise - obligation.acceptedAmountInPaise, 0);
  const pendingForMe = settlements.filter((item) => item.status === 'pending' && item.toUserId === userId);
  const ownPending = settlements.filter((item) => item.status === 'pending' && item.fromUserId === userId);

  const submitAcknowledgment = () => {
    const amountInPaise = paiseInput(amount);
    if (amountInPaise <= 0) {
      Alert.alert('Invalid amount', 'Enter a positive amount in rupees.');
      return;
    }
    const storageKey = `split-repayment:${split.id}:${userId}`;
    void act(async () => {
      const storedValue = await AsyncStorage.getItem(storageKey);
      let idempotencyKey: string;
      if (storedValue) {
        const stored = JSON.parse(storedValue) as { key: string; amountInPaise: number };
        if (stored.amountInPaise !== amountInPaise) throw new Error('Retry the previous repayment amount first; its result may still be pending.');
        idempotencyKey = stored.key;
      } else {
        idempotencyKey = `${userId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await AsyncStorage.setItem(storageKey, JSON.stringify({ key: idempotencyKey, amountInPaise }));
      }
      await requestRepayment({ splitId: split.id, amountInPaise, senderProfileId: currentProfile.id, idempotencyKey });
    }, 'Repayment acknowledgment sent to the creditor.', async () => {
      await AsyncStorage.removeItem(storageKey);
      setAmount('');
    });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.spacer} />
      <TouchableOpacity onPress={() => router.back()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
      <Text style={styles.title}>{split.title}</Text>
      {split.description ? <Text style={styles.sub}>{split.description}</Text> : null}
      <View style={styles.hero}>
        <Text style={styles.label}>Original expense</Text>
        <Text style={styles.amount}>{money(split.totalAmountInPaise)}</Text>
        <Text style={styles.sub}>Paid by {split.createdBy === userId ? 'you' : 'the original payer'} · {split.sourceDate}</Text>
        {/* <Text style={styles.status}>{split.status.replaceAll('_', ' ')}</Text> */}
      </View>
      {isCreditor && split.status !== 'cancelled' && split.finalizationStatus !== 'complete' && (
        <TouchableOpacity disabled={busy} style={styles.secondaryButton} onPress={() => Alert.alert(
          'Cancel shared expense?',
          'This is only allowed before any repayment is accepted or allocations are finalized.',
          [
            { text: 'Keep split', style: 'cancel' },
            { text: 'Cancel split', style: 'destructive', onPress: () => void act(() => cancelSplit(split.id), 'Split cancelled and its source expense released.') },
          ],
        )}>
          <Text style={styles.danger}>Cancel split</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.heading}>Allocation</Text>
      {split.participants.map((participant) => {
        const obligation = split.obligations.find((item) => item.fromUserId === participant.userId && item.toUserId === split.paidByUserId);
        return (
          <View key={participant.userId} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.person}>{participant.displayName || (participant.userId === split.paidByUserId ? 'Payer' : participant.userId)}</Text>
              {/* {obligation ? (
                <Text style={styles.sub}>Accepted {money(obligation.acceptedAmountInPaise)} · pending {money(obligation.pendingAmountInPaise)} · outstanding {money(obligation.amountInPaise - obligation.acceptedAmountInPaise)}</Text>
              ) : <Text style={styles.sub}>{participant.userId === split.paidByUserId ? 'Original payer · no self-repayment' : 'No repayment obligation'}</Text>} */}
            </View>
            <Text style={styles.value}>{money(participant.shareAmountInPaise)}</Text>
          </View>
        );
      })}
      {!split.participants.some((participant) => participant.userId === split.paidByUserId) && (
        <View style={styles.notice}><Text style={styles.sub}>The payer is excluded from allocation and has zero consumption share.</Text></View>
      )}

      {myObligations.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.heading}>Your outstanding obligation in this split</Text>
          <Text style={styles.amount}>{money(outstanding)}</Text>
        </View>
      )}
      {/* {!isCreditor && outstanding > 0 && (
        <View style={styles.card}>
          <Text style={styles.heading}>Acknowledge a repayment</Text>
          <Text style={styles.sub}>This is a user-reported payment. It affects the balance only after the creditor accepts.</Text>
          <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="Amount in rupees" style={styles.input} />
          <TouchableOpacity disabled={busy} style={styles.button} onPress={submitAcknowledgment}>
            <Text style={styles.buttonText}>Send acknowledgment</Text>
          </TouchableOpacity>
        </View>
      )} */}

      {/* {pendingForMe.length > 0 && <>
        <Text style={styles.heading}>Awaiting your decision</Text>
        {pendingForMe.map((settlement) => (
          <View key={settlement.id} style={styles.card}>
            <Text style={styles.person}>{settlement.fromUserId} acknowledges {money(settlement.amountInPaise)}</Text>
            <View style={styles.actions}>
              <TouchableOpacity disabled={busy} style={styles.buttonSmall} onPress={() => void act(() => acceptRepayment({ splitId: split.id, settlementId: settlement.id, recipientProfileId: currentProfile.id }), 'Repayment accepted and recorded.') }><Text style={styles.buttonText}>Accept</Text></TouchableOpacity>
              <TouchableOpacity disabled={busy} style={styles.secondaryButton} onPress={() => void act(() => rejectRepayment({ splitId: split.id, settlementId: settlement.id }), 'Acknowledgment rejected.') }><Text style={styles.secondaryText}>Reject</Text></TouchableOpacity>
            </View>
          </View>
        ))}
      </>}

      {ownPending.map((settlement) => (
        <View key={settlement.id} style={styles.card}>
          <Text style={styles.sub}>Pending acknowledgment: {money(settlement.amountInPaise)}</Text>
          <TouchableOpacity disabled={busy} onPress={() => void act(() => cancelRepayment({ splitId: split.id, settlementId: settlement.id }), 'Acknowledgment cancelled.')}><Text style={styles.danger}>Cancel acknowledgment</Text></TouchableOpacity>
        </View>
      ))} */}

      {/* <Text style={styles.heading}>Payment history</Text>
      {settlements.length === 0 ? <Text style={styles.sub}>No repayment acknowledgments yet.</Text> : settlements.map((settlement) => (
        <View key={settlement.id} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.person}>{settlement.fromUserId} → {settlement.toUserId}</Text>
            <Text style={styles.sub}>{settlement.status}</Text>
          </View>
          <Text style={styles.value}>{money(settlement.amountInPaise)}</Text>
        </View>
      ))} */}
      {split.finalizationStatus === 'complete' && <Text style={styles.complete}>Final participant expense allocations are recorded.</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingBottom: 44 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  back: { color: colors.primary, marginBottom: 16, fontWeight: '600' },
  title: { color: colors.text, fontSize: 25, fontWeight: '700' },
  sub: { color: colors.textSecondary, marginTop: 4 },
  hero: { backgroundColor: colors.card, padding: 18, borderRadius: 14, marginVertical: 18 },
  label: { color: colors.textSecondary },
  amount: { color: colors.text, fontSize: 28, fontWeight: '700', marginVertical: 5 },
  status: { textTransform: 'capitalize', color: colors.primary, marginTop: 8, fontWeight: '600' },
  heading: { color: colors.text, fontWeight: '700', fontSize: 17, marginTop: 18, marginBottom: 9 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  person: { color: colors.text, fontWeight: '600' },
  value: { color: colors.text, fontWeight: '700' },
  card: { backgroundColor: colors.card, padding: 16, borderRadius: 12, marginTop: 12 },
  notice: { backgroundColor: colors.card, padding: 12, borderRadius: 10, marginTop: 12 },
  input: { borderColor: colors.border, borderWidth: 1, borderRadius: 8, padding: 12, marginTop: 12, color: colors.text },
  button: { backgroundColor: colors.primary, padding: 13, borderRadius: 9, marginTop: 12 },
  buttonSmall: { backgroundColor: colors.primary, padding: 10, borderRadius: 8, flex: 1, alignItems: 'center' },
  buttonText: { color: '#fff', textAlign: 'center', fontWeight: '700' },
  secondaryButton: { borderColor: colors.border, borderWidth: 1, padding: 10, borderRadius: 8, flex: 1, alignItems: 'center' },
  secondaryText: { color: colors.text },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  danger: { color: colors.expense, fontWeight: '600', paddingTop: 10 },
  complete: { color: colors.income, fontWeight: '700', marginTop: 18 },
  spacer: {
    height: 50, // React Native uses density-independent pixels (dp), do not use '50px' strings
  },
});

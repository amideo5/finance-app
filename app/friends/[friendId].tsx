import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { getUserSplitLedger } from '@/src/services/firebase/splitService';
import type { SharedExpenseSplit } from '@/types/finance';

export default function FriendLedger() {
  const params = useLocalSearchParams<{ friendId?: string | string[] }>();
  const friendId = Array.isArray(params.friendId) ? params.friendId[0] : params.friendId;
  const router = useRouter();
  const { currentProfile } = useProfile();
  const [splits, setSplits] = useState<SharedExpenseSplit[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentProfile?.userId || !friendId) return;
    setLoading(true);
    try {
      const { splits: rows } = await getUserSplitLedger(currentProfile.userId);
      setSplits(rows.filter((split) => split.participantIds.includes(friendId)
        || split.createdBy === friendId
        || split.paidByUserId === friendId));
    } catch (error) {
      console.error('Unable to load friend split ledger', error);
    } finally {
      setLoading(false);
    }
  }, [currentProfile, friendId]);

  useEffect(() => {
    // Async Firestore load is applied after the effect returns.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity onPress={() => router.back()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
      <Text style={styles.title}>Shared expenses</Text>
      <Text style={styles.subtitle}>Split statuses reflect direct repayments and accepted friend-level net settlements.</Text>
      {loading ? <Text style={styles.muted}>Loading…</Text> : splits.length === 0 ? <Text style={styles.muted}>No shared expenses with this friend.</Text> : splits.map((split) => (
        <TouchableOpacity key={split.id} style={styles.card} onPress={() => router.push(`/splits/${split.id}`)}>
          <Text style={styles.name}>{split.title || 'Shared expense'}</Text>
          <Text style={styles.muted}>{(split.settlementDisplayStatus || split.status).replaceAll('_', ' ')}</Text>
          <Text style={styles.amount}>₹{(split.totalAmountInPaise / 100).toFixed(2)}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingBottom: 40 },
  back: { color: colors.primary, marginBottom: 18 },
  title: { color: colors.text, fontSize: 24, fontWeight: '700' },
  subtitle: { color: colors.textSecondary, marginTop: 6, marginBottom: 18 },
  muted: { color: colors.textSecondary, marginTop: 4 },
  card: { backgroundColor: colors.card, borderRadius: 12, padding: 16, marginBottom: 10 },
  name: { color: colors.text, fontWeight: '700' },
  amount: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 10 },
});

import { Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { useRouter } from 'expo-router';
import type { SharedExpenseSplit } from '@/types/finance';

export default function SplitCard({ split }: { split: SharedExpenseSplit }) {
  const { currentProfile } = useProfile();
  const router = useRouter();

  const userId = currentProfile?.userId;
  const amountToReceive = split.obligations
    .filter((obligation) => obligation.toUserId === userId)
    .reduce((sum, obligation) => sum + obligation.amountInPaise - obligation.acceptedAmountInPaise, 0);
  const amountToPay = split.obligations
    .filter((obligation) => obligation.fromUserId === userId)
    .reduce((sum, obligation) => sum + obligation.amountInPaise - obligation.acceptedAmountInPaise, 0);

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/splits/${split.id}`)}
    >
      <Text style={styles.amount}>{split.title} · ₹{(split.totalAmountInPaise / 100).toFixed(2)}</Text>
      {amountToReceive > 0 && <Text style={styles.green}>To receive ₹{(amountToReceive / 100).toFixed(2)}</Text>}
      {amountToPay > 0 && <Text style={styles.red}>You owe ₹{(amountToPay / 100).toFixed(2)}</Text>}

      <Text style={styles.sub}>
        {split.participants.length} participants · {split.status.replaceAll('_', ' ')}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  amount: { fontSize: 18, fontWeight: '700' },

  green: { color: '#16a34a', marginTop: 4 },
  red: { color: '#dc2626', marginTop: 4 },

  sub: { color: colors.textSecondary, marginTop: 4 },
});
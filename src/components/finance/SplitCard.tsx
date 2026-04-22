import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { useRouter } from 'expo-router';

export default function SplitCard({ split }: any) {
  const { currentProfile } = useProfile();
  const router = useRouter();

  const me = split.participants.find(
    (p: any) => p.userId === currentProfile?.userId
  );

  const others = split.participants.filter(
    (p: any) => p.userId !== currentProfile?.userId
  );

  const isYouPaid = me?.paid;

  const totalOwed = others.reduce(
    (sum: number, p: any) => (!p.paid ? sum + p.amount : sum),
    0
  );

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/splits/${split.id}`)}
    >
      <Text style={styles.amount}>₹{split.totalAmount}</Text>

      {isYouPaid ? (
        <Text style={styles.green}>You lent ₹{totalOwed}</Text>
      ) : (
        <Text style={styles.red}>You owe ₹{me?.amount}</Text>
      )}

      <Text style={styles.sub}>
        {split.participants.length} people
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
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '@/src/constants/colors';
import { useEffect, useState } from 'react';
import { db } from '@/src/firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import { useProfile } from '@/src/context/ProfileContext';

export default function TransactionDetail() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { currentProfile } = useProfile();

  const [transaction, setTransaction] = useState<any>(null);

  useEffect(() => {
    const load = async () => {
      if (!currentProfile?.id) return;

      const ref = doc(
        db,
        'profiles',
        currentProfile.id,
        'transactions',
        id as string
      );

      const snap = await getDoc(ref);
      if (snap.exists()) setTransaction(snap.data());
    };

    load();
  }, [id, currentProfile]);

  if (!transaction) return null;

  return (
    <View style={styles.container}>
      <View style={{ height: 40 }} />
      <TouchableOpacity onPress={() => router.back()}>
        <Text style={styles.back}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.amount}>₹{transaction.amount}</Text>
      <Text style={styles.meta}>{transaction.category}</Text>
      <Text style={styles.meta}>
        {new Date(transaction.date).toDateString()}
      </Text>

      {transaction.type === 'expense' && transaction.currency === 'INR' && !transaction.kind && (
        <TouchableOpacity
          style={styles.btn}
          onPress={() => router.push(`/splits/create?txId=${id}`)}
        >
          <Text style={styles.btnText}>Split with friends</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: colors.background },
  back: { color: colors.primary, marginBottom: 12 },

  amount: { fontSize: 32, fontWeight: '700', color: colors.text },
  meta: { color: colors.textSecondary, marginTop: 4 },

  btn: {
    marginTop: 32,
    backgroundColor: colors.primary,
    padding: 16,
    borderRadius: 12,
  },
  btnText: { color: '#fff', textAlign: 'center', fontWeight: '600' },
});
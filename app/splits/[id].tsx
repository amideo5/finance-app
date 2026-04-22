import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useEffect, useState } from 'react';
import { db } from '@/src/firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import { useProfile } from '@/src/context/ProfileContext';
import { colors } from '@/src/constants/colors';
import { markSplitPaid } from '@/src/services/firebase/splitService';

export default function SplitDetail() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { currentProfile } = useProfile();

  const [split, setSplit] = useState<any>(null);

  useEffect(() => {
    const load = async () => {
      const snap = await getDoc(doc(db, 'splits', id as string));
      if (snap.exists()) setSplit({ id: snap.id, ...snap.data() });
    };
    load();
  }, [id]);

  if (!split) return null;

  const me = split.participants.find(
    (p: any) => p.userId === currentProfile?.userId
  );

  const handlePay = async () => {
    const updated = split.participants.map((p: any) =>
      p.userId === currentProfile?.userId ? { ...p, paid: true } : p
    );

    await markSplitPaid(split.id, updated);
    router.back();
  };

  return (
    <View style={styles.container}>
      <View style={{ height: 40 }} />
      <TouchableOpacity onPress={() => router.back()}>
        <Text style={styles.back}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Split Details</Text>
      <Text style={styles.amount}>₹{split.totalAmount}</Text>

      {split.participants.map((p: any) => (
        <View key={p.userId} style={styles.row}>
          <Text>{p.userId}</Text>
          <Text>₹{p.amount}</Text>
          <Text>{p.paid ? 'Paid' : 'Pending'}</Text>
        </View>
      ))}

      {!me?.paid && (
        <TouchableOpacity style={styles.btn} onPress={handlePay}>
          <Text style={styles.btnText}>Mark as Paid</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: colors.background },
  back: { color: colors.primary, marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  amount: { fontSize: 28, marginVertical: 16 },

  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },

  btn: {
    marginTop: 20,
    backgroundColor: colors.primary,
    padding: 14,
    borderRadius: 10,
  },
  btnText: { color: '#fff', textAlign: 'center' },
});
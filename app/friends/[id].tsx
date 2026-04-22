import { useLocalSearchParams, useRouter } from 'expo-router';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useProfile } from '@/src/context/ProfileContext';
import { getUserSplits } from '@/src/services/firebase/splitService';
import { useEffect, useState } from 'react';
import { colors } from '@/src/constants/colors';

export default function FriendLedger() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { currentProfile } = useProfile();

  const [splits, setSplits] = useState<any[]>([]);

  useEffect(() => {
    const load = async () => {
      const data = await getUserSplits(currentProfile!.userId);

      const filtered = data.filter(s =>
        s.participantIds.includes(id)
      );

      setSplits(filtered);
    };

    load();
  }, []);

  return (
    <View style={styles.container}>
      <View style={{ height: 40 }} />
      <TouchableOpacity onPress={() => router.back()}>
        <Text style={styles.back}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Ledger</Text>

      {splits.map((s) => (
        <View key={s.id} style={styles.card}>
          <Text>₹{s.totalAmount}</Text>
          <Text>{s.type}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24 },

  back: { color: colors.primary },

  title: { fontSize: 22, marginVertical: 16 },

  card: {
    backgroundColor: colors.card,
    padding: 14,
    borderRadius: 10,
    marginBottom: 10,
  },
});
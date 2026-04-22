import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ScrollView,
} from 'react-native';
import React, { useEffect, useState } from 'react';
import { useProfile } from '@/src/context/ProfileContext';
import { createSplit } from '@/src/services/firebase/splitService';
import { colors } from '@/src/constants/colors';
import { getUserFriends } from '@/src/services/firebase/friendsService';

export default function CreateSplit() {
  const { txId, amount } = useLocalSearchParams();
  const { currentProfile } = useProfile();
  const router = useRouter();

  const totalAmount = Number(amount);

  const [friends, setFriends] = useState<any[]>([]);
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [splitType, setSplitType] = useState<'equal' | 'amount'>('equal');
  const [amounts, setAmounts] = useState<any>({});

  // 🔥 Load friends
  useEffect(() => {
    const load = async () => {
      if (!currentProfile?.userId) return;
      const data = await getUserFriends(currentProfile.userId);
      setFriends(data);
    };
    load();
  }, [currentProfile]);

  // 🔥 Name map
  const friendMap = Object.fromEntries(
    friends.map((f) => [
      f.friendId,
      f.profileData?.name || f.friendId,
    ])
  );

  const getName = (id: string) => {
    if (id === currentProfile?.userId) return 'You';
    return friendMap[id] || id;
  };

  const toggleFriend = (id: string) => {
    if (selectedFriends.includes(id)) {
      setSelectedFriends(selectedFriends.filter((f) => f !== id));
    } else {
      setSelectedFriends([...selectedFriends, id]);
    }
  };

  const handleCreate = async () => {
    if (!currentProfile?.userId) return;

    const users = [currentProfile.userId, ...selectedFriends];

    let participants: any[] = [];

    if (splitType === 'equal') {
      const per = totalAmount / users.length;

      participants = users.map((u) => ({
        userId: u,
        amount: per,
        paid: u === currentProfile.userId,
      }));
    } else {
      const total = Object.values(amounts).reduce(
        (a: any, b: any) => a + b,
        0
      );

      if (total !== totalAmount) {
        alert('Amounts must match total');
        return;
      }

      participants = users.map((u) => ({
        userId: u,
        amount: amounts[u] || 0,
        paid: u === currentProfile.userId,
      }));
    }

    await createSplit({
      transactionId: txId,
      createdBy: currentProfile.userId,
      totalAmount,
      type: splitType,
      participants,
    });

    router.back();
  };

  return (
    <View style={styles.container}>
      {/* 🔙 BACK */}
      <View style={{ height: 40 }} />
      <TouchableOpacity onPress={() => router.back()}>
        <Text style={styles.back}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Create Split</Text>
      <Text style={styles.amount}>₹{totalAmount}</Text>

      {/* 👥 CONTEXT */}
      <Text style={styles.subtitle}>
        You + {selectedFriends.length} friend
        {selectedFriends.length !== 1 && 's'}
      </Text>

      {/* 🔘 TYPE */}
      <View style={styles.toggle}>
        {['equal', 'amount'].map((type) => (
          <TouchableOpacity
            key={type}
            style={[
              styles.toggleBtn,
              splitType === type && styles.toggleActive,
            ]}
            onPress={() => setSplitType(type as any)}
          >
            <Text
              style={
                splitType === type
                  ? styles.toggleTextActive
                  : styles.toggleText
              }
            >
              {type.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 👥 FRIEND SELECT */}
      <Text style={styles.section}>Select Friends</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {friends.map((f) => {
          const isSelected = selectedFriends.includes(f.friendId);

          return (
            <TouchableOpacity
              key={f.friendId}
              style={[
                styles.friendChip,
                isSelected && styles.friendChipActive,
              ]}
              onPress={() => toggleFriend(f.friendId)}
            >
              <Text
                style={[
                  styles.friendText,
                  isSelected && styles.friendTextActive,
                ]}
              >
                {f.profileData?.name || f.friendId}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* 💰 CUSTOM AMOUNT */}
      {splitType === 'amount' &&
        selectedFriends.map((id) => (
          <TextInput
            key={id}
            placeholder={`Amount for ${getName(id)}`}
            style={styles.input}
            keyboardType="numeric"
            onChangeText={(val) =>
              setAmounts({ ...amounts, [id]: Number(val) })
            }
          />
        ))}

      {/* 🔥 LIVE PREVIEW */}
      <View style={styles.preview}>
        <Text style={styles.previewTitle}>Preview</Text>

        <Text>You paid ₹{totalAmount}</Text>

        {(() => {
          const users = [currentProfile!.userId, ...selectedFriends];

          if (splitType === 'equal') {
            const per = totalAmount / users.length;

            return selectedFriends.map((id) => (
              <Text key={id}>
                {getName(id)} owes ₹{per.toFixed(0)}
              </Text>
            ));
          }

          return selectedFriends.map((id) => (
            <Text key={id}>
              {getName(id)} owes ₹{amounts[id] || 0}
            </Text>
          ));
        })()}
      </View>

      {/* 🚀 CREATE */}
      <TouchableOpacity style={styles.btn} onPress={handleCreate}>
        <Text style={styles.btnText}>Create Split</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: colors.background },

  back: { color: colors.primary, marginBottom: 12 },

  title: { fontSize: 22, fontWeight: '700' },
  amount: { fontSize: 28, fontWeight: '700', marginVertical: 8 },

  subtitle: {
    color: colors.textSecondary,
    marginBottom: 12,
  },

  toggle: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
  },
  toggleBtn: {
    flex: 1,
    padding: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  toggleActive: {
    backgroundColor: colors.primary,
  },
  toggleText: {
    color: colors.textSecondary,
  },
  toggleTextActive: {
    color: '#fff',
    fontWeight: '600',
  },

  section: { marginBottom: 8, fontWeight: '600' },

  friendChip: {
    padding: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
  },
  friendChipActive: {
    backgroundColor: colors.primary,
  },
  friendText: { color: colors.text },
  friendTextActive: { color: '#fff' },

  input: {
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },

  preview: {
    backgroundColor: colors.card,
    padding: 16,
    borderRadius: 12,
    marginTop: 16,
  },
  previewTitle: {
    fontWeight: '700',
    marginBottom: 8,
  },

  btn: {
    marginTop: 24,
    backgroundColor: colors.primary,
    padding: 16,
    borderRadius: 12,
  },
  btnText: { color: '#fff', textAlign: 'center' },
});
// app/friends/[friendId].tsx

import { useLocalSearchParams } from "expo-router";
import { useProfile } from "@/src/context/ProfileContext";
import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, TextInput, Alert } from "react-native";
import { getUserSplits } from "@/src/services/firebase/splitService";
import { calculateNetBalances } from "@/src/utils/splitUtils";
import { collection, addDoc } from "firebase/firestore";
import { db } from "@/src/firebaseConfig";

export default function FriendSettlementScreen() {
  const { friendId } = useLocalSearchParams();
  const { currentProfile } = useProfile();

  const [splits, setSplits] = useState<any[]>([]);
  const [balance, setBalance] = useState(0);
  const [amount, setAmount] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const data = await getUserSplits(currentProfile!.userId);
    setSplits(data);

    const balances = calculateNetBalances(data);

    const friendBalance = balances[friendId as string] || 0;
    setBalance(friendBalance);
  };

  // ✅ FULL SETTLE
  const handleSettleFull = async () => {
    if (balance === 0) return;

    await addDoc(collection(db, "splits"), {
      description: "Settlement",
      amount: Math.abs(balance),
      participants: [
        {
          userId: balance < 0 ? currentProfile!.userId : friendId,
          amount: Math.abs(balance),
          paid: true,
        },
        {
          userId: balance < 0 ? friendId : currentProfile!.userId,
          amount: 0,
          paid: false,
        },
      ],
      createdAt: new Date(),
    });

    Alert.alert("Done", "Settled بالكامل");
    loadData();
  };

  // ✅ PARTIAL PAYMENT
  const handlePartial = async () => {
    const value = parseFloat(amount);
    if (!value || value <= 0) {
      Alert.alert("Invalid amount");
      return;
    }

    await addDoc(collection(db, "splits"), {
      description: "Partial settlement",
      amount: value,
      participants: [
        {
          userId: balance < 0 ? currentProfile!.userId : friendId,
          amount: value,
          paid: true,
        },
        {
          userId: balance < 0 ? friendId : currentProfile!.userId,
          amount: 0,
          paid: false,
        },
      ],
      createdAt: new Date(),
    });

    setAmount("");
    loadData();
  };

  return (
    <View style={{ padding: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: "700" }}>
        {balance > 0
          ? `You get ₹${balance.toFixed(2)}`
          : balance < 0
          ? `You owe ₹${Math.abs(balance).toFixed(2)}`
          : "All settled 🎉"}
      </Text>

      {/* ✅ FULL SETTLE */}
      {balance !== 0 && (
        <TouchableOpacity
          onPress={handleSettleFull}
          style={{
            backgroundColor: "#16a34a",
            padding: 12,
            borderRadius: 8,
            marginTop: 16,
          }}
        >
          <Text style={{ color: "#fff", textAlign: "center" }}>
            Settle Full
          </Text>
        </TouchableOpacity>
      )}

      {/* ✅ PARTIAL */}
      <TextInput
        placeholder="Enter amount"
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
        style={{
          borderWidth: 1,
          marginTop: 20,
          padding: 10,
          borderRadius: 8,
        }}
      />

      <TouchableOpacity
        onPress={handlePartial}
        style={{
          backgroundColor: "#2563eb",
          padding: 12,
          borderRadius: 8,
          marginTop: 10,
        }}
      >
        <Text style={{ color: "#fff", textAlign: "center" }}>
          Pay Partial
        </Text>
      </TouchableOpacity>
    </View>
  );
}
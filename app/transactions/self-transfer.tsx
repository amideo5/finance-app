import { useProfile } from "@/src/context/ProfileContext";
import { db } from "@/src/firebaseConfig";
import { useRouter } from "expo-router";
import {
  collection,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

type Account = {
  id: string;
  name?: string;
  balance?: number;
  currency?: string;
};

export default function SelfTransferScreen() {
  const router = useRouter();
  const { currentProfile } = useProfile();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amountText, setAmountText] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadAccounts = async () => {
      if (!currentProfile) {
        setLoadingAccounts(false);
        return;
      }

      try {
        const snapshot = await getDocs(
          collection(db, "profiles", currentProfile.id, "accounts")
        );
        const loaded = snapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as Account[];

        setAccounts(loaded);
      } catch (error) {
        console.error("Failed to load accounts:", error);
        Alert.alert("Error", "Could not load your accounts.");
      } finally {
        setLoadingAccounts(false);
      }
    };

    void loadAccounts();
  }, [currentProfile]);

  const amount = Number(amountText);

  const saveTransfer = async () => {
    if (!currentProfile) {
      Alert.alert("No profile", "Please select a profile first.");
      return;
    }

    if (!fromId || !toId) {
      Alert.alert("Choose accounts", "Select both a source and destination account.");
      return;
    }

    if (fromId === toId) {
      Alert.alert("Invalid transfer", "Source and destination must be different accounts.");
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert("Invalid amount", "Enter an amount greater than zero.");
      return;
    }

    if (!date.trim()) {
      Alert.alert("Missing date", "Enter a transfer date.");
      return;
    }

    const profileId = currentProfile.id;
    const fromRef = doc(db, "profiles", profileId, "accounts", fromId);
    const toRef = doc(db, "profiles", profileId, "accounts", toId);
    const transactionsRef = collection(
      db,
      "profiles",
      profileId,
      "transactions"
    );
    const outgoingRef = doc(transactionsRef);
    const incomingRef = doc(transactionsRef);
    const transferId = outgoingRef.id;

    setSaving(true);

    try {
      await runTransaction(db, async (firestoreTransaction) => {
        const [fromSnapshot, toSnapshot] = await Promise.all([
          firestoreTransaction.get(fromRef),
          firestoreTransaction.get(toRef),
        ]);

        if (!fromSnapshot.exists() || !toSnapshot.exists()) {
          throw new Error("One of the selected accounts no longer exists.");
        }

        const fromBalance = Number(fromSnapshot.data().balance || 0);
        const toBalance = Number(toSnapshot.data().balance || 0);

        if (fromBalance < amount) {
          throw new Error("The source account does not have enough balance.");
        }

        firestoreTransaction.update(fromRef, {
          balance: fromBalance - amount,
          updatedAt: serverTimestamp(),
        });

        firestoreTransaction.update(toRef, {
          balance: toBalance + amount,
          updatedAt: serverTimestamp(),
        });

        const fromName =
            accounts.find((a) => a.id === fromId)?.name || "Source account";

        const toName =
        accounts.find((a) => a.id === toId)?.name || "Destination account";

        const transferLabel = `Transfer: ${fromName} → ${toName}`;

        const common = {
            kind: "self-transfer",
            transferId,
            amount,
            date,
            note: note.trim(),
            category: "Transfer",
            title: transferLabel,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            };

        // Outgoing side: source account records the transfer as an expense.
        firestoreTransaction.set(outgoingRef, {
          ...common,
          type: "expense",
          accountId: fromId,
          transferDirection: "out",
          title: `Transfer to ${accounts.find((a) => a.id === toId)?.name || "account"}`,
        });

        // Incoming side: destination account records the transfer as income.
        firestoreTransaction.set(incomingRef, {
          ...common,
          type: "income",
          accountId: toId,
          transferDirection: "in",
          title: `Transfer from ${accounts.find((a) => a.id === fromId)?.name || "account"}`,
        });
      });

      Alert.alert("Transfer saved", "Your account balances have been updated.", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (error) {
      console.error("Self-transfer failed:", error);
      Alert.alert(
        "Transfer failed",
        error instanceof Error ? error.message : "Could not save the transfer."
      );
    } finally {
      setSaving(false);
    }
  };

  const renderAccountPicker = (
    label: string,
    selectedId: string,
    onSelect: (id: string) => void
  ) => (
    <View style={styles.section}>
      <Text style={styles.label}>{label}</Text>
      {accounts.map((account) => {
        const selected = selectedId === account.id;
        return (
          <TouchableOpacity
            key={account.id}
            style={[styles.accountOption, selected && styles.selectedOption]}
            onPress={() => onSelect(account.id)}
          >
            <View>
              <Text style={styles.accountName}>
                {account.name || "Unnamed account"}
              </Text>
              <Text style={styles.accountBalance}>
                Balance: {Number(account.balance || 0).toLocaleString()}
              </Text>
            </View>
            <Text style={styles.radio}>{selected ? "●" : "○"}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  if (loadingAccounts) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.muted}>Loading accounts…</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Transfer between my accounts</Text>
        <Text style={styles.muted}>
          Move money between accounts you own. This is not income or spending.
        </Text>

        {renderAccountPicker("From account", fromId, setFromId)}
        {renderAccountPicker("To account", toId, setToId)}

        <View style={styles.section}>
          <Text style={styles.label}>Amount</Text>
          <TextInput
            style={styles.input}
            value={amountText}
            onChangeText={setAmountText}
            placeholder="0.00"
            keyboardType="decimal-pad"
          />

          <Text style={styles.label}>Date (YYYY-MM-DD)</Text>
          <TextInput
            style={styles.input}
            value={date}
            onChangeText={setDate}
            placeholder="2026-10-24"
          />

          <Text style={styles.label}>Note (optional)</Text>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNote}
            placeholder="e.g. Move savings to current account"
          />
        </View>

        <TouchableOpacity
          style={[styles.saveButton, saving && styles.disabledButton]}
          onPress={saveTransfer}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveButtonText}>Save transfer</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.cancelButton} onPress={() => router.back()}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  heading: { fontSize: 22, fontWeight: "700", marginBottom: 8, color: "#111" },
  muted: { color: "#666", marginBottom: 16 },
  section: { marginTop: 18 },
  label: { fontSize: 14, fontWeight: "600", color: "#333", marginBottom: 8 },
  accountOption: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  selectedOption: { borderColor: "#2563eb", backgroundColor: "#eff6ff" },
  accountName: { fontWeight: "600", color: "#111" },
  accountBalance: { color: "#666", marginTop: 4, fontSize: 12 },
  radio: { fontSize: 18, color: "#2563eb" },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    color: "#111",
  },
  saveButton: {
    backgroundColor: "#2563eb",
    padding: 15,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 20,
  },
  disabledButton: { opacity: 0.6 },
  saveButtonText: { color: "#fff", fontWeight: "700" },
  cancelButton: { padding: 14, alignItems: "center" },
  cancelText: { color: "#555", fontWeight: "600" },
});
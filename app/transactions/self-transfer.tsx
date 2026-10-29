import { useProfile } from "@/src/context/ProfileContext";
import { db } from "@/src/firebaseConfig";
import { useRouter } from "expo-router";
import { colors } from "@/src/constants/colors";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowLeft, ArrowLeftRight, CalendarDays, CheckCircle2, FileText, Wallet } from "lucide-react-native";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Account = {
  id: string;
  name?: string;
  balance?: number;
  currency?: string;
};

export default function SelfTransferScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
          balanceInPaise: Math.round((fromBalance - amount) * 100),
          updatedAt: serverTimestamp(),
        });

        firestoreTransaction.update(toRef, {
          balance: toBalance + amount,
          balanceInPaise: Math.round((toBalance + amount) * 100),
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
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 18) + 20 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={[styles.header, { paddingTop: Math.max(insets.top + 8, 20) }]}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Go back" style={styles.backButton} onPress={() => router.back()}>
            <ArrowLeft size={20} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headingCopy}>
            <Text style={styles.eyebrow}>MOVE MONEY BETWEEN YOUR OWN ACCOUNTS</Text>
            <Text style={styles.heading}>Self transfer</Text>
          </View>
        </View>

        <LinearGradient colors={["#29265E", "#5146D8", "#6C63F5"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.heroCard}>
          <View style={styles.heroIcon}><ArrowLeftRight color="#FFFFFF" size={22} /></View>
          <Text style={styles.heroTitle}>A move, not an expense</Text>
          <Text style={styles.heroCopy}>Transfer between accounts you own. Your statement can track the movement without treating it as new income or spending.</Text>
          <View style={styles.heroPill}><CheckCircle2 size={14} color="#C9FFE5" /><Text style={styles.heroPillText}>Balances update together</Text></View>
        </LinearGradient>

        <View style={styles.formCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIcon}><Wallet size={18} color={colors.primary} /></View>
            <View style={styles.sectionHeadingCopy}>
              <Text style={styles.sectionTitle}>Transfer route</Text>
              <Text style={styles.sectionSubtitle}>Choose where money leaves and arrives</Text>
            </View>
          </View>
          {renderAccountPicker("From account", fromId, setFromId)}
          <View style={styles.routeConnector}>
            <View style={styles.routeLine} />
            <View style={styles.routeConnectorIcon}><ArrowLeftRight size={16} color={colors.primary} /></View>
            <View style={styles.routeLine} />
          </View>
          {renderAccountPicker("To account", toId, setToId)}
        </View>

        <View style={styles.formCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionIcon}><FileText size={18} color={colors.primary} /></View>
            <View style={styles.sectionHeadingCopy}>
              <Text style={styles.sectionTitle}>Transfer details</Text>
              <Text style={styles.sectionSubtitle}>Amount, date and an optional note</Text>
            </View>
          </View>

          <Text style={styles.label}>Amount</Text>
          <View style={styles.amountInputWrap}>
            <Text style={styles.amountCurrency}>₹</Text>
            <TextInput
              style={styles.amountInput}
              value={amountText}
              onChangeText={setAmountText}
              placeholder="0.00"
              placeholderTextColor="#A0A3B6"
              keyboardType="decimal-pad"
            />
          </View>

          <Text style={styles.label}>Transfer date</Text>
          <View style={styles.inputWrap}>
            <CalendarDays size={17} color={colors.textLight} />
            <TextInput
              style={styles.input}
              value={date}
              onChangeText={setDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#A0A3B6"
            />
          </View>
          <Text style={styles.helperText}>Use YYYY-MM-DD, for example 2026-10-27.</Text>

          <Text style={styles.label}>Note <Text style={styles.optionalLabel}>(optional)</Text></Text>
          <TextInput
            style={styles.noteInput}
            value={note}
            onChangeText={setNote}
            placeholder="e.g. Move savings to current account"
            placeholderTextColor="#A0A3B6"
            multiline
            textAlignVertical="top"
          />
        </View>

        <View style={styles.infoCard}>
          <CheckCircle2 size={18} color="#16875B" />
          <Text style={styles.infoText}>The transfer will be recorded on both accounts so the money leaving one account matches the money arriving in the other.</Text>
        </View>

        <TouchableOpacity
          style={[styles.saveButton, saving && styles.disabledButton]}
          onPress={saveTransfer}
          disabled={saving}
          activeOpacity={0.86}
        >
          {saving ? <ActivityIndicator color="#FFFFFF" /> : <><ArrowLeftRight size={18} color="#FFFFFF" /><Text style={styles.saveButtonText}>Confirm transfer</Text></>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelButton} onPress={() => router.back()} disabled={saving}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 18, paddingTop: 0, paddingBottom: 38 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, gap: 10 },
  muted: { color: colors.textSecondary, fontSize: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingTop: 20, paddingBottom: 21 },
  backButton: { width: 42, height: 42, borderRadius: 15, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  headingCopy: { flex: 1 },
  eyebrow: { color: colors.primary, fontSize: 8, letterSpacing: 1.1, fontWeight: '800', marginBottom: 5 },
  heading: { fontSize: 26, lineHeight: 31, fontWeight: '800', color: colors.text, letterSpacing: -0.7 },
  heroCard: { padding: 20, borderRadius: 24, marginBottom: 18, overflow: 'hidden', shadowColor: '#3932A3', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.18, shadowRadius: 16, elevation: 5 },
  heroIcon: { width: 42, height: 42, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center', marginBottom: 15 },
  heroTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  heroCopy: { color: '#E1DFFF', fontSize: 11, lineHeight: 18, marginTop: 8 },
  heroPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.13)', paddingVertical: 8, paddingHorizontal: 11, borderRadius: 13, marginTop: 15 },
  heroPillText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  formCard: { backgroundColor: colors.card, borderRadius: 22, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 15 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 18 },
  sectionIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ECEBFF' },
  sectionHeadingCopy: { flex: 1, gap: 3 },
  sectionTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  sectionSubtitle: { color: colors.textSecondary, fontSize: 10 },
  section: { marginTop: 3 },
  label: { fontSize: 12, fontWeight: '800', color: colors.text, marginBottom: 8, marginTop: 7 },
  accountOption: { borderWidth: 1, borderColor: colors.border, borderRadius: 15, padding: 13, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.card },
  selectedOption: { borderColor: colors.primary, backgroundColor: '#F2F1FF' },
  accountName: { fontWeight: '800', color: colors.text, fontSize: 12 },
  accountBalance: { color: colors.textSecondary, marginTop: 5, fontSize: 10 },
  radio: { fontSize: 18, color: colors.primary, fontWeight: '800' },
  routeConnector: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 15, marginTop: -1, marginBottom: 6 },
  routeLine: { flex: 1, height: 1, backgroundColor: colors.border },
  routeConnectorIcon: { width: 30, height: 30, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ECEBFF' },
  amountInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 58, paddingHorizontal: 15, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  amountCurrency: { color: colors.primary, fontSize: 22, fontWeight: '800' },
  amountInput: { flex: 1, fontSize: 22, fontWeight: '800', color: colors.text, paddingVertical: 0 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13, minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  input: { flex: 1, paddingVertical: 12, color: colors.text, fontSize: 12 },
  helperText: { color: colors.textLight, fontSize: 10, marginTop: 6, marginBottom: 5 },
  optionalLabel: { fontSize: 11, color: colors.textLight, fontWeight: '500' },
  noteInput: { minHeight: 88, borderWidth: 1, borderColor: colors.border, borderRadius: 15, padding: 13, color: colors.text, backgroundColor: colors.background, fontSize: 12 },
  infoCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#EAF8F1', padding: 13, borderRadius: 15, marginBottom: 16 },
  infoText: { flex: 1, color: '#256B50', fontSize: 10, lineHeight: 16 },
  saveButton: { backgroundColor: colors.primary, minHeight: 52, paddingHorizontal: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9, marginTop: 2, shadowColor: colors.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 3 },
  disabledButton: { opacity: 0.6 },
  saveButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  cancelButton: { padding: 15, alignItems: 'center' },
  cancelText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
});
import Button from '@/src/components/ui/Button';
import Input from '@/src/components/ui/Input';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/src/constants/categories';
import { colors } from '@/src/constants/colors';
import { useAuth } from '@/src/context/AuthContext';
import { useProfile } from '@/src/context/ProfileContext';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import {
    db
} from '@/src/firebaseConfig';

import { addTransaction } from '@/src/services/firebase/transactionsService';
import { isDateKey, parsePositiveAmount, toLocalDateKey } from '@/src/utils/validation';
import { collection, getDocs } from 'firebase/firestore';

export default function AddExpenseScreen() {
  const router = useRouter();
  const { currentProfile } = useProfile();
  const { user } = useAuth();

  const [amount, setAmount] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<any>(null); // Now stores full category object
  const [transactionType, setTransactionType] = useState<'expense' | 'income'>('expense');
  const [selectedPaymentMode, setSelectedPaymentMode] = useState('cash');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(toLocalDateKey(new Date()));
  const [loading, setLoading] = useState(false);

  const expenseCategories = EXPENSE_CATEGORIES;
  const incomeCategories = INCOME_CATEGORIES;
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);

  // Determine which categories to show based on transaction type
  const displayCategories = transactionType === 'expense' ? expenseCategories : incomeCategories;

  // -------------------------------------------------------
  // LOAD CATEGORIES (Using hardcoded constants)
  // -------------------------------------------------------

  // Categories are already loaded from constants, no need to fetch from Firebase


  // -------------------------------------------------------
  // LOAD ACCOUNTS (Firebase)
  // -------------------------------------------------------
  const loadAccounts = useCallback(async () => {
    if (!currentProfile) return;

    try {
      const accountsRef = collection(db, "profiles", currentProfile.id, "accounts");
      const snapshot = await getDocs(accountsRef);

      const result: any[] = [];
      snapshot.forEach((doc) => result.push({ id: doc.id, ...doc.data() }));

      setAccounts(result);
    } catch (e) {
      console.log("Account Load Error:", e);
    }
  }, [currentProfile]);

  useEffect(() => {
    if (currentProfile) {
      // Async account loading synchronizes the selected profile with Firestore.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadAccounts();
    }
  }, [currentProfile, loadAccounts]);


  // -------------------------------------------------------
  // SUBMIT TRANSACTION (Firebase)
  // -------------------------------------------------------
  const handleSubmit = async () => {
    const parsedAmount = parsePositiveAmount(amount);
    if (!parsedAmount || !selectedCategory || !currentProfile || !user) {
      Alert.alert('Check transaction details', 'Enter a positive amount and choose a category.');
      return;
    }
    if (!isDateKey(date)) {
      Alert.alert('Invalid date', 'Enter a valid date in YYYY-MM-DD format.');
      return;
    }

    setLoading(true);

    try {
      await addTransaction(currentProfile.id, {
        profileId: currentProfile.id,
        userId: user.uid,
        type: transactionType,
        amount: parsedAmount,
        categoryId: selectedCategory.id,
        category: selectedCategory.name,
        categoryIcon: selectedCategory.icon,
        paymentMode: selectedPaymentMode,
        accountId: selectedAccount,
        notes: notes.trim() || null,
        date,
        currency: currentProfile.currency || 'INR',
      });

      router.back();
    } catch (error) {
      console.error('Transaction Error:', error);
      Alert.alert('Error', 'Could not save the transaction. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------
  // UI
  // -------------------------------------------------------
  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => {
        loadAccounts();
      }} />}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backButton}>Cancel</Text>
        </TouchableOpacity>

        <Text style={styles.title}>{transactionType === 'expense' ? 'Add Expense' : 'Add Income'}</Text>

        <View style={{ width: 60 }} />
      </View>

      <View style={styles.form}>
        {/* TRANSACTION TYPE SELECTOR */}
        <Text style={styles.label}>Type</Text>
        <View style={styles.typeSelector}>
          <TouchableOpacity
            style={[
              styles.typeButton,
              transactionType === 'expense' && styles.typeButtonSelected,
            ]}
            onPress={() => {
              setTransactionType('expense');
              setSelectedCategory(null);
            }}
          >
            <Text
              style={[
                styles.typeButtonText,
                transactionType === 'expense' && styles.typeButtonTextSelected,
              ]}
            >
              Expense
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.typeButton,
              transactionType === 'income' && styles.typeButtonSelected,
            ]}
            onPress={() => {
              setTransactionType('income');
              setSelectedCategory(null);
            }}
          >
            <Text
              style={[
                styles.typeButtonText,
                transactionType === 'income' && styles.typeButtonTextSelected,
              ]}
            >
              Income
            </Text>
          </TouchableOpacity>
        </View>

        <Input
          label="Amount"
          placeholder="0.00"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          style={styles.amountInput}
        />

        {/* CATEGORY */}
        <Text style={styles.label}>Category</Text>
        <View style={styles.categoryGrid}>
          {displayCategories.map((cat) => (
            <TouchableOpacity
              key={cat.name}
              style={[
                styles.categoryItem,
                selectedCategory?.name === cat.name && styles.categoryItemSelected,
              ]}
              onPress={() => setSelectedCategory(cat)}
            >
              <Text style={styles.categoryIcon}>{cat.icon}</Text>
              <Text style={styles.categoryName}>{cat.name}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* PAYMENT MODE */}
        <Text style={styles.label}>Payment Mode</Text>
        <View style={styles.paymentModes}>
          {["cash", "upi", "card", "wallet", "bank"].map((mode) => (
            <TouchableOpacity
              key={mode}
              style={[
                styles.paymentMode,
                selectedPaymentMode === mode && styles.paymentModeSelected,
              ]}
              onPress={() => setSelectedPaymentMode(mode)}
            >
              <Text
                style={[
                  styles.paymentModeText,
                  selectedPaymentMode === mode && styles.paymentModeTextSelected,
                ]}
              >
                {mode.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ACCOUNTS */}
        {accounts.length > 0 && (
          <>
            <Text style={styles.label}>Account</Text>
            <View style={styles.accounts}>
              {accounts.map((account) => (
                <TouchableOpacity
                  key={account.id}
                  style={[
                    styles.accountItem,
                    selectedAccount === account.id && styles.accountItemSelected,
                  ]}
                  onPress={() => setSelectedAccount(account.id)}
                >
                  <Text style={styles.accountName}>{account.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* DATE */}
        <Input
          label="Date"
          value={date}
          onChangeText={setDate}
          placeholder="YYYY-MM-DD"
        />

        {/* NOTES */}
        <Input
          label="Notes (Optional)"
          placeholder="Add notes"
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={3}
        />

        <Button
          title="Add Expense"
          onPress={handleSubmit}
          loading={loading}
          disabled={!amount || !selectedCategory}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 24,
    paddingTop: 48,
  },
  backButton: {
    fontSize: 16,
    color: colors.primary,
    width: 60,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  form: {
    padding: 24,
  },
  amountInput: {
    fontSize: 32,
    fontWeight: '700',
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
    marginTop: 8,
  },
  typeSelector: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  typeButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  typeButtonSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  typeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  typeButtonTextSelected: {
    color: colors.card,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 24,
    gap: 8,
  },
  categoryItem: {
    width: '31%',
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.card,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  categoryItemSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '10',
  },
  categoryIcon: {
    fontSize: 32,
    marginBottom: 4,
  },
  categoryName: {
    fontSize: 12,
    color: colors.text,
    textAlign: 'center',
  },
  paymentModes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 24,
    gap: 8,
  },
  paymentMode: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  paymentModeSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  paymentModeText: {
    fontSize: 14,
    color: colors.text,
  },
  paymentModeTextSelected: {
    color: colors.card,
  },
  accounts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 24,
    gap: 8,
  },
  accountItem: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  accountItemSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  accountName: {
    fontSize: 14,
    color: colors.text,
  },
});

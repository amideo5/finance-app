import Button from '@/src/components/ui/Button';
import Input from '@/src/components/ui/Input';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/src/constants/categories';
import { colors } from '@/src/constants/colors';
import { useAuth } from '@/src/context/AuthContext';
import { useProfile } from '@/src/context/ProfileContext';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, CalendarDays, Check, ChevronDown, Search, X } from 'lucide-react-native';
import { Calendar } from 'react-native-calendars';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
    db
} from '@/src/firebaseConfig';

import { addTransaction } from '@/src/services/firebase/transactionsService';
import { getOrCreateCashAccount } from '@/src/services/firebase/accountsService';
import { isDateKey, parsePositiveAmount, toLocalDateKey } from '@/src/utils/validation';
import { collection, getDocs } from 'firebase/firestore';

export default function AddExpenseScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { currentProfile } = useProfile();
  const { user } = useAuth();

  const [amount, setAmount] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<any>(null); // Now stores full category object
  const [transactionType, setTransactionType] = useState<'expense' | 'income'>('expense');
  const [selectedPaymentMode, setSelectedPaymentMode] = useState('cash');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(toLocalDateKey(new Date()));
  const [loading, setLoading] = useState(false);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState('');

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
      let cash = result.find((account) => account.type === 'cash' && String(account.name || '').toLowerCase() === 'cash')
        || result.find((account) => account.type === 'cash');
      if (!cash) {
        cash = await getOrCreateCashAccount(currentProfile.id, currentProfile.currency || 'INR');
        result.push(cash);
      }
      setAccounts(result);
      if (selectedPaymentMode === 'cash') setSelectedAccount(cash.id);
    } catch (e) {
      console.log("Account Load Error:", e);
    }
  }, [currentProfile, selectedPaymentMode]);

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
    const accountForPayment = selectedPaymentMode === 'cash'
      ? accounts.find((account) => account.type === 'cash' && String(account.name || '').toLowerCase() === 'cash')
        || accounts.find((account) => account.type === 'cash')
      : accounts.find((account) => account.id === selectedAccount);
    if (!accountForPayment) {
      Alert.alert('Choose an account', selectedPaymentMode === 'cash'
        ? 'Create or select the dedicated Cash account first.'
        : 'Select the bank, card, or wallet account used for this transaction.');
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
        accountId: accountForPayment.id,
        notes: notes.trim() || null,
        date,
        currency: currentProfile.currency || 'INR',
      });

      router.back();
    } catch (error) {
      console.error('Transaction Error:', error);
      const message = error instanceof Error ? error.message : 'Could not save the transaction. Please try again.';
      Alert.alert(message.startsWith('Insufficient balance') ? 'Insufficient balance' : 'Error', message);
    } finally {
      setLoading(false);
    }
  };

  // -------------------------------------------------------
  // UI
  // -------------------------------------------------------
  const filteredCategories = displayCategories.filter((category) =>
    category.name.toLowerCase().includes(categoryQuery.trim().toLowerCase())
  );
  const formattedDate = (() => {
    const parsed = new Date(`${date}T12:00:00`);
    return Number.isNaN(parsed.getTime())
      ? date
      : parsed.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  })();
  const availableAccounts = accounts.filter((account) => selectedPaymentMode === 'cash'
    ? account.type === 'cash'
    : account.type !== 'cash');

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 18) + 24 }]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { void loadAccounts(); }} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.header, { paddingTop: Math.max(insets.top + 8, 28) }]}>
          <TouchableOpacity style={styles.cancelButton} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Cancel and go back">
            <ArrowLeft size={18} color={colors.text} />
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>New transaction</Text>
            <Text style={styles.headerSubtitle}>Capture it now, understand it later.</Text>
          </View>
        </View>

        <View style={styles.form}>
          <Text style={styles.sectionLabel}>TRANSACTION TYPE</Text>
          <View style={styles.typeSelector}>
            <TouchableOpacity
              activeOpacity={0.85}
              style={[styles.typeOption, transactionType === 'expense' && styles.expenseTypeSelected]}
              onPress={() => {
                setTransactionType('expense');
                setSelectedCategory(null);
                setCategoryQuery('');
              }}
            >
              <View style={[styles.typeIcon, styles.expenseTypeIcon]}><Text style={styles.typeEmoji}>↗</Text></View>
              <View style={styles.typeCopy}>
                <Text style={[styles.typeTitle, transactionType === 'expense' && styles.expenseText]}>Expense</Text>
                <Text style={styles.typeDescription}>Money going out</Text>
              </View>
              {transactionType === 'expense' ? <Check size={18} color={colors.expense} /> : null}
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.85}
              style={[styles.typeOption, transactionType === 'income' && styles.incomeTypeSelected]}
              onPress={() => {
                setTransactionType('income');
                setSelectedCategory(null);
                setCategoryQuery('');
              }}
            >
              <View style={[styles.typeIcon, styles.incomeTypeIcon]}><Text style={styles.typeEmoji}>↙</Text></View>
              <View style={styles.typeCopy}>
                <Text style={[styles.typeTitle, transactionType === 'income' && styles.incomeText]}>Income</Text>
                <Text style={styles.typeDescription}>Money coming in</Text>
              </View>
              {transactionType === 'income' ? <Check size={18} color={colors.income} /> : null}
            </TouchableOpacity>
          </View>

          <LinearGradient
            colors={transactionType === 'expense' ? ['#29265E', '#5146D8'] : ['#075E48', '#119A73']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.amountCard}
          >
            <View style={styles.amountCardHeader}>
              <Text style={styles.amountCardLabel}>AMOUNT</Text>
              <View style={styles.currencyPill}><Text style={styles.currencyPillText}>{currentProfile?.currency || 'INR'} · ₹</Text></View>
            </View>
            <View style={styles.amountEntryRow}>
              <Text style={styles.amountSymbol}>₹</Text>
              <TextInput
                style={styles.amountInput}
                value={amount}
                onChangeText={setAmount}
                placeholder="0.00"
                placeholderTextColor="rgba(255,255,255,0.58)"
                keyboardType="decimal-pad"
                accessibilityLabel="Transaction amount"
                returnKeyType="done"
              />
            </View>
            <Text style={styles.amountHint}>Enter the total {transactionType === 'expense' ? 'spent' : 'received'}.</Text>
          </LinearGradient>

          <View style={styles.sectionHeadingRow}>
            <View>
              <Text style={styles.fieldTitle}>Category</Text>
              <Text style={styles.fieldSubtitle}>Choose what best describes this {transactionType}.</Text>
            </View>
            <Text style={styles.categoryCount}>{filteredCategories.length} types</Text>
          </View>
          <View style={styles.categorySearch}>
            <Search size={17} color={colors.textLight} />
            <TextInput
              style={styles.categorySearchInput}
              value={categoryQuery}
              onChangeText={setCategoryQuery}
              placeholder="Find a category"
              placeholderTextColor={colors.textLight}
              accessibilityLabel="Search categories"
              returnKeyType="search"
            />
            {categoryQuery.length > 0 ? <TouchableOpacity onPress={() => setCategoryQuery('')} accessibilityLabel="Clear category search"><X size={16} color={colors.textSecondary} /></TouchableOpacity> : null}
          </View>
          <View style={styles.categoryGrid}>
            {filteredCategories.map((cat) => {
              const selected = selectedCategory?.id === cat.id;
              return (
                <TouchableOpacity
                  key={cat.id}
                  activeOpacity={0.82}
                  style={[styles.categoryItem, selected && styles.categoryItemSelected, selected && { borderColor: cat.color || colors.primary }]}
                  onPress={() => setSelectedCategory(cat)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Select ${cat.name} category`}
                >
                  <View style={[styles.categoryIconWrap, { backgroundColor: `${cat.color || colors.primary}18` }]}>
                    <Text style={styles.categoryIcon}>{cat.icon}</Text>
                  </View>
                  <Text numberOfLines={2} style={[styles.categoryName, selected && styles.categoryNameSelected]}>{cat.name}</Text>
                  {selected ? <View style={[styles.categoryCheck, { backgroundColor: cat.color || colors.primary }]}><Check size={10} color="#FFFFFF" /></View> : null}
                </TouchableOpacity>
              );
            })}
          </View>
          {filteredCategories.length === 0 ? <Text style={styles.noCategories}>No categories match “{categoryQuery}”.</Text> : null}

          <View style={styles.sectionHeadingRow}>
            <View>
              <Text style={styles.fieldTitle}>Paid with</Text>
              <Text style={styles.fieldSubtitle}>Choose the method used for this transaction.</Text>
            </View>
          </View>
          <View style={styles.paymentModes}>
            {[
              { value: 'cash', label: 'Cash', icon: '💵' },
              { value: 'upi', label: 'UPI', icon: '📲' },
              { value: 'card', label: 'Card', icon: '💳' },
              { value: 'bank', label: 'Bank', icon: '🏦' },
              { value: 'wallet', label: 'Wallet', icon: '👛' },
            ].map((mode) => {
              const selected = selectedPaymentMode === mode.value;
              return (
                <TouchableOpacity
                  key={mode.value}
                  activeOpacity={0.82}
                  style={[styles.paymentMode, selected && styles.paymentModeSelected]}
                  onPress={() => {
                    setSelectedPaymentMode(mode.value);
                    if (mode.value !== 'cash') setSelectedAccount(null);
                    else {
                      const cash = accounts.find((account) => account.type === 'cash' && String(account.name || '').toLowerCase() === 'cash')
                        || accounts.find((account) => account.type === 'cash');
                      setSelectedAccount(cash?.id ?? null);
                    }
                  }}
                >
                  <Text style={styles.paymentModeEmoji}>{mode.icon}</Text>
                  <Text style={[styles.paymentModeText, selected && styles.paymentModeTextSelected]}>{mode.label}</Text>
                  {selected ? <Check size={13} color={colors.primary} /> : null}
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.sectionHeadingRow}>
            <View>
              <Text style={styles.fieldTitle}>{selectedPaymentMode === 'cash' ? 'Cash account' : 'Account'}</Text>
              <Text style={styles.fieldSubtitle}>Keep this transaction linked to the right balance.</Text>
            </View>
          </View>
          {availableAccounts.length > 0 ? (
            <View style={styles.accounts}>
              {availableAccounts.map((account) => {
                const selected = selectedAccount === account.id || (selectedPaymentMode === 'cash' && account.id === selectedAccount);
                return (
                  <TouchableOpacity
                    key={account.id}
                    activeOpacity={0.82}
                    style={[styles.accountItem, selected && styles.accountItemSelected]}
                    onPress={() => setSelectedAccount(account.id)}
                    disabled={selectedPaymentMode === 'cash'}
                  >
                    <View style={[styles.accountDot, selected && styles.accountDotSelected]} />
                    <Text style={[styles.accountName, selected && styles.accountNameSelected]}>{account.name}</Text>
                    {selected ? <Check size={15} color={colors.primary} /> : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <View style={styles.accountEmpty}>
              <Text style={styles.accountEmptyText}>{accounts.length === 0 ? 'No accounts found yet.' : `No ${selectedPaymentMode === 'cash' ? 'cash' : 'non-cash'} account available for this method.`}</Text>
              <TouchableOpacity onPress={() => router.push('/accounts/add')} style={styles.addAccountLink}>
                <Text style={styles.addAccountLinkText}>Add account</Text>
                <ChevronDown size={14} color={colors.primary} />
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.sectionHeadingRow}>
            <View>
              <Text style={styles.fieldTitle}>Date</Text>
              <Text style={styles.fieldSubtitle}>When did this transaction happen?</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.datePickerButton}
            activeOpacity={0.82}
            onPress={() => setDatePickerVisible(true)}
            accessibilityRole="button"
            accessibilityLabel={`Choose transaction date, currently ${formattedDate}`}
          >
            <View style={styles.dateIconWrap}><CalendarDays size={20} color={colors.primary} /></View>
            <View style={styles.datePickerCopy}>
              <Text style={styles.datePickerValue}>{formattedDate}</Text>
              <Text style={styles.datePickerHint}>{date}</Text>
            </View>
            <ChevronDown size={18} color={colors.textSecondary} />
          </TouchableOpacity>

          <Input
            label="Notes (optional)"
            placeholder="Add a note, merchant, or reminder…"
            value={notes}
            onChangeText={setNotes}
            multiline
            numberOfLines={3}
            containerStyle={styles.notesContainer}
            style={styles.notesInput}
          />

          <Button
            title={loading ? 'Saving…' : `Save ${transactionType}`}
            onPress={handleSubmit}
            loading={loading}
            disabled={!amount || !selectedCategory}
            size="large"
            style={styles.submitButton}
          />
          <Text style={styles.footerHint}>Your transaction will be added to the selected profile.</Text>
        </View>
      </ScrollView>

      <Modal
        visible={datePickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setDatePickerVisible(false)}
      >
        <View style={[styles.dateModalBackdrop, { paddingTop: insets.top + 12, paddingBottom: Math.max(insets.bottom, 12) + 12 }]}>
          <View style={styles.dateModalCard}>
            <View style={styles.dateModalHeader}>
              <View>
                <Text style={styles.dateModalTitle}>Choose date</Text>
                <Text style={styles.dateModalSubtitle}>{formattedDate}</Text>
              </View>
              <TouchableOpacity onPress={() => setDatePickerVisible(false)} style={styles.closeDateModal} accessibilityLabel="Close date picker"><X size={19} color={colors.textSecondary} /></TouchableOpacity>
            </View>
            <Calendar
              current={date}
              onDayPress={(day) => {
                setDate(day.dateString);
                setDatePickerVisible(false);
              }}
              markedDates={{ [date]: { selected: true, selectedColor: colors.primary } }}
              enableSwipeMonths
              theme={{
                calendarBackground: colors.card,
                backgroundColor: colors.card,
                todayTextColor: colors.primary,
                arrowColor: colors.primary,
                monthTextColor: colors.text,
                textSectionTitleColor: colors.textSecondary,
                dayTextColor: colors.text,
                textDisabledColor: colors.textLight,
                selectedDayBackgroundColor: colors.primary,
                selectedDayTextColor: '#FFFFFF',
                textDayFontWeight: '600',
                textMonthFontWeight: '800',
              }}
            />
            <TouchableOpacity style={styles.todayButton} onPress={() => { setDate(toLocalDateKey(new Date())); setDatePickerVisible(false); }}>
              <Text style={styles.todayButtonText}>Use today</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: 28 },
  header: { paddingHorizontal: 20, paddingBottom: 20, gap: 14 },
  cancelButton: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 7, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  cancelButtonText: { fontSize: 12, color: colors.text, fontWeight: '700' },
  headerTitleWrap: { gap: 4 },
  headerTitle: { fontSize: 29, lineHeight: 34, color: colors.text, fontWeight: '800', letterSpacing: -0.8 },
  headerSubtitle: { color: colors.textSecondary, fontSize: 12 },
  form: { paddingHorizontal: 18, paddingBottom: 22 },
  sectionLabel: { fontSize: 10, letterSpacing: 1.35, color: colors.textSecondary, fontWeight: '800', marginBottom: 10, marginTop: 2 },
  typeSelector: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  typeOption: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, backgroundColor: colors.card, borderRadius: 18, borderWidth: 1.5, borderColor: colors.border },
  expenseTypeSelected: { borderColor: colors.expense, backgroundColor: '#FFF5F5' },
  incomeTypeSelected: { borderColor: colors.income, backgroundColor: '#F0FDF7' },
  typeIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  expenseTypeIcon: { backgroundColor: '#FFE4E6' },
  incomeTypeIcon: { backgroundColor: '#D1FAE5' },
  typeEmoji: { fontSize: 21, fontWeight: '800', color: colors.text },
  typeCopy: { flex: 1, minWidth: 0 },
  typeTitle: { fontSize: 13, fontWeight: '800', color: colors.text },
  typeDescription: { fontSize: 9, color: colors.textSecondary, marginTop: 3 },
  expenseText: { color: colors.expense },
  incomeText: { color: colors.income },
  amountCard: { borderRadius: 24, paddingHorizontal: 20, paddingVertical: 18, marginBottom: 26, shadowColor: '#3932A3', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.16, shadowRadius: 14, elevation: 4 },
  amountCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amountCardLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: '#E0DDFF' },
  currencyPill: { paddingVertical: 5, paddingHorizontal: 9, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.14)' },
  currencyPillText: { fontSize: 10, color: '#FFFFFF', fontWeight: '700' },
  amountEntryRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  amountSymbol: { color: '#FFFFFF', fontSize: 31, fontWeight: '700', marginRight: 8 },
  amountInput: { flex: 1, minWidth: 0, color: '#FFFFFF', fontSize: 36, fontWeight: '800', paddingVertical: 4 },
  amountHint: { color: '#DAD8FF', fontSize: 11, marginTop: 6 },
  sectionHeadingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 11, marginTop: 2 },
  fieldTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  fieldSubtitle: { fontSize: 11, lineHeight: 16, color: colors.textSecondary, marginTop: 3 },
  categoryCount: { fontSize: 10, fontWeight: '800', color: colors.primary, backgroundColor: '#EAE9FF', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6 },
  categorySearch: { minHeight: 43, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, marginBottom: 13 },
  categorySearchInput: { flex: 1, minWidth: 0, paddingVertical: 9, fontSize: 12, color: colors.text },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 9, marginBottom: 26 },
  categoryItem: { width: '31.5%', minHeight: 100, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 5, borderRadius: 17, backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border, position: 'relative' },
  categoryItemSelected: { backgroundColor: '#F7F6FF', borderWidth: 1.5 },
  categoryIconWrap: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginBottom: 7 },
  categoryIcon: { fontSize: 23 },
  categoryName: { fontSize: 10, lineHeight: 13, fontWeight: '700', color: colors.textSecondary, textAlign: 'center' },
  categoryNameSelected: { color: colors.text, fontWeight: '800' },
  categoryCheck: { position: 'absolute', top: 6, right: 6, width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  noCategories: { color: colors.textSecondary, fontSize: 12, paddingVertical: 12, marginBottom: 18 },
  paymentModes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 25 },
  paymentMode: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 13, paddingVertical: 10, paddingHorizontal: 11, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  paymentModeSelected: { borderColor: colors.primary, backgroundColor: '#F0EFFF' },
  paymentModeEmoji: { fontSize: 15 },
  paymentModeText: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
  paymentModeTextSelected: { color: colors.primary, fontWeight: '800' },
  accounts: { gap: 8, marginBottom: 26 },
  accountItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, paddingHorizontal: 13, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  accountItemSelected: { borderColor: colors.primary, backgroundColor: '#F7F6FF' },
  accountDot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: colors.textLight },
  accountDotSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  accountName: { flex: 1, fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  accountNameSelected: { color: colors.text },
  accountEmpty: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: 13, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, marginBottom: 26 },
  accountEmptyText: { flex: 1, color: colors.textSecondary, fontSize: 11, lineHeight: 16 },
  addAccountLink: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  addAccountLinkText: { color: colors.primary, fontWeight: '800', fontSize: 11 },
  datePickerButton: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 17, marginBottom: 20 },
  dateIconWrap: { width: 43, height: 43, borderRadius: 14, backgroundColor: '#EAE9FF', alignItems: 'center', justifyContent: 'center' },
  datePickerCopy: { flex: 1 },
  datePickerValue: { fontSize: 13, fontWeight: '800', color: colors.text },
  datePickerHint: { fontSize: 10, color: colors.textSecondary, marginTop: 4 },
  notesContainer: { marginTop: 2, marginBottom: 18 },
  notesInput: { minHeight: 85, textAlignVertical: 'top' },
  submitButton: { borderRadius: 17, paddingVertical: 17 },
  footerHint: { fontSize: 10, color: colors.textSecondary, textAlign: 'center', marginTop: 12, lineHeight: 16 },
  dateModalBackdrop: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 12, backgroundColor: 'rgba(20,22,50,0.45)' },
  dateModalCard: { backgroundColor: colors.card, borderRadius: 25, padding: 17, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  dateModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  dateModalTitle: { fontSize: 19, color: colors.text, fontWeight: '800' },
  dateModalSubtitle: { fontSize: 11, color: colors.textSecondary, marginTop: 4 },
  closeDateModal: { width: 35, height: 35, borderRadius: 12, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  todayButton: { alignSelf: 'flex-end', marginTop: 12, backgroundColor: colors.primary, borderRadius: 13, paddingVertical: 11, paddingHorizontal: 17 },
  todayButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
});

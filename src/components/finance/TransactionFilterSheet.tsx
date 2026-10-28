import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
} from '@/src/constants/categories';
import { colors } from '@/src/constants/colors';
import { toLocalDateKey } from '@/src/utils/validation';
import {
  CalendarDays,
  Check,
  ChevronDown,
  RotateCcw,
  Search,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  visible: boolean;
  onClose: () => void;
  onApply: (filters: any) => void;
}

type TransactionType = 'all' | 'income' | 'expense';

export default function TransactionFilterSheet({
  visible,
  onClose,
  onApply,
}: Props) {
  const insets = useSafeAreaInsets();
  const [type, setType] = useState<TransactionType>('all');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');

  const categories = useMemo(() => {
    const allCategories = type === 'income'
      ? INCOME_CATEGORIES
      : type === 'expense'
        ? EXPENSE_CATEGORIES
        : [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES];
    const keyword = categorySearch.trim().toLowerCase();
    return keyword
      ? allCategories.filter((category) => category.name.toLowerCase().includes(keyword))
      : allCategories;
  }, [type, categorySearch]);

  const draftFilterCount = [
    type !== 'all',
    selectedCategories.length > 0,
    Boolean(startDate || endDate),
  ].filter(Boolean).length;

  const toggleCategory = (category: string) => {
    setSelectedCategories((previous) => previous.includes(category)
      ? previous.filter((item) => item !== category)
      : [...previous, category]);
  };

  const handleDayPress = (day: { dateString: string }) => {
    if (!startDate || (startDate && endDate)) {
      setStartDate(day.dateString);
      setEndDate(null);
    } else if (day.dateString < startDate) {
      setStartDate(day.dateString);
    } else {
      setEndDate(day.dateString);
    }
  };

  const markedDates = useMemo(() => {
    if (!startDate) return {};
    const marked: Record<string, any> = {
      [startDate]: {
        startingDay: true,
        endingDay: !endDate,
        color: colors.primary,
        textColor: '#FFFFFF',
      },
    };

    if (endDate) {
      const cursor = new Date(`${startDate}T12:00:00`);
      const end = new Date(`${endDate}T12:00:00`);
      while (cursor <= end) {
        const key = toLocalDateKey(cursor);
        marked[key] = { color: colors.primary, textColor: '#FFFFFF' };
        cursor.setDate(cursor.getDate() + 1);
      }
      marked[startDate] = { startingDay: true, color: colors.primary, textColor: '#FFFFFF' };
      marked[endDate] = { endingDay: true, color: colors.primary, textColor: '#FFFFFF' };
    }
    return marked;
  }, [startDate, endDate]);

  const applyPreset = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    setStartDate(toLocalDateKey(start));
    setEndDate(toLocalDateKey(end));
  };

  const resetDraft = () => {
    setType('all');
    setSelectedCategories([]);
    setStartDate(null);
    setEndDate(null);
    setShowCalendar(false);
    setCategorySearch('');
  };

  const dateRangeLabel = startDate || endDate
    ? `${startDate || 'Any date'}  –  ${endDate || 'Choose end date'}`
    : 'All dates';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <SlidersHorizontal size={19} color={colors.primary} />
            </View>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>REFINE YOUR ACTIVITY</Text>
              <Text style={styles.title}>Filters</Text>
              <Text style={styles.subtitle}>Choose what you want to see.</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close filters">
              <X size={19} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Transaction type</Text>
              <Text style={styles.sectionHint}>Select one</Text>
            </View>
            <View style={styles.typeRow}>
              {([
                { label: 'All activity', value: 'all', Icon: SlidersHorizontal },
                { label: 'Income', value: 'income', Icon: TrendingUp },
                { label: 'Expense', value: 'expense', Icon: TrendingDown },
              ] as { label: string; value: TransactionType; Icon: typeof SlidersHorizontal }[]).map(({ label, value, Icon }) => {
                const selected = type === value;
                return (
                  <TouchableOpacity
                    key={value}
                    onPress={() => {
                      setType(value);
                      setSelectedCategories([]);
                      setCategorySearch('');
                    }}
                    style={[styles.typeOption, selected && styles.typeOptionSelected]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <Icon size={17} color={selected ? '#FFFFFF' : colors.textSecondary} />
                    <Text style={[styles.typeOptionText, selected && styles.typeOptionTextSelected]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionTitle}>Categories</Text>
                <Text style={styles.sectionHint}>Choose one or more</Text>
              </View>
              {selectedCategories.length > 0 ? (
                <View style={styles.countBadge}>
                  <Text style={styles.countBadgeText}>{selectedCategories.length} selected</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.searchBox}>
              <Search size={17} color={colors.textLight} />
              <TextInput
                value={categorySearch}
                onChangeText={setCategorySearch}
                placeholder="Find a category"
                placeholderTextColor={colors.textLight}
                style={styles.searchInput}
                autoCorrect={false}
                returnKeyType="search"
              />
              {categorySearch.length > 0 ? (
                <TouchableOpacity onPress={() => setCategorySearch('')} accessibilityLabel="Clear category search">
                  <X size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              ) : null}
            </View>

            {categories.length > 0 ? (
              <View style={styles.grid}>
                {categories.map((category) => {
                  const selected = selectedCategories.includes(category.name);
                  return (
                    <TouchableOpacity
                      key={category.name}
                      onPress={() => toggleCategory(category.name)}
                      style={[styles.categoryCard, selected && styles.categoryCardSelected]}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <View style={[styles.categoryIconWrap, selected && styles.categoryIconWrapSelected]}>
                        <Text style={styles.categoryIcon}>{category.icon}</Text>
                      </View>
                      <Text numberOfLines={2} style={[styles.categoryName, selected && styles.categoryNameSelected]}>{category.name}</Text>
                      {selected ? (
                        <View style={styles.categoryCheck}>
                          <Check size={11} color="#FFFFFF" strokeWidth={3} />
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : (
              <View style={styles.noCategories}>
                <Text style={styles.noCategoriesText}>No categories match “{categorySearch}”.</Text>
              </View>
            )}

            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionTitle}>Date range</Text>
                <Text style={styles.sectionHint}>Narrow results to a period</Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.dateCard, (startDate || endDate) && styles.dateCardActive]}
              onPress={() => setShowCalendar((visible) => !visible)}
              accessibilityRole="button"
              accessibilityLabel="Choose a custom date range"
            >
              <View style={styles.dateIconWrap}>
                <CalendarDays size={19} color={colors.primary} />
              </View>
              <View style={styles.dateCopy}>
                <Text style={styles.dateCardLabel}>Custom period</Text>
                <Text style={styles.dateCardValue}>{dateRangeLabel}</Text>
              </View>
              <ChevronDown size={19} color={colors.textSecondary} style={showCalendar ? styles.chevronOpen : undefined} />
            </TouchableOpacity>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presetRow}>
              <TouchableOpacity style={styles.presetChip} onPress={() => applyPreset(7)}>
                <Text style={styles.presetText}>Past week</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.presetChip} onPress={() => applyPreset(30)}>
                <Text style={styles.presetText}>Past month</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.presetChip} onPress={() => applyPreset(180)}>
                <Text style={styles.presetText}>Past 6 months</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.presetChip} onPress={() => { setStartDate(null); setEndDate(null); }}>
                <Text style={styles.presetText}>Any time</Text>
              </TouchableOpacity>
            </ScrollView>

            {showCalendar ? (
              <View style={styles.calendarCard}>
                <View style={styles.calendarIntro}>
                  <Text style={styles.calendarIntroTitle}>Choose your dates</Text>
                  <Text style={styles.calendarIntroHint}>{endDate ? 'Date range selected' : startDate ? 'Now choose an end date' : 'Tap a start date, then an end date'}</Text>
                </View>
                <Calendar
                  markingType="period"
                  markedDates={markedDates}
                  onDayPress={handleDayPress}
                  theme={{
                    todayTextColor: colors.primary,
                    arrowColor: colors.primary,
                    selectedDayBackgroundColor: colors.primary,
                    textDayFontWeight: '600',
                    textMonthFontWeight: '800',
                    textMonthFontSize: 15,
                    monthTextColor: colors.text,
                    textSectionTitleColor: colors.textSecondary,
                  }}
                />
              </View>
            ) : null}

            {draftFilterCount > 0 ? (
              <View style={styles.selectionSummary}>
                <Check size={16} color={colors.success} />
                <Text style={styles.selectionSummaryText}>
                  {draftFilterCount} filter {draftFilterCount === 1 ? 'group' : 'groups'} configured
                  {selectedCategories.length ? ` · ${selectedCategories.length} ${selectedCategories.length === 1 ? 'category' : 'categories'}` : ''}
                </Text>
              </View>
            ) : (
              <View style={styles.selectionSummary}>
                <SlidersHorizontal size={15} color={colors.textLight} />
                <Text style={styles.selectionSummaryMuted}>No filters selected — all transactions will be shown.</Text>
              </View>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.resetButton} onPress={resetDraft} accessibilityRole="button">
              <RotateCcw size={15} color={colors.textSecondary} />
              <Text style={styles.resetText}>Reset</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.applyButton}
              onPress={() => {
                onApply({ type, categories: selectedCategories, startDate, endDate });
                onClose();
              }}
              accessibilityRole="button"
            >
              <SlidersHorizontal size={17} color="#FFFFFF" />
              <Text style={styles.applyText}>Show transactions</Text>
              {draftFilterCount > 0 ? (
                <View style={styles.applyCount}><Text style={styles.applyCountText}>{draftFilterCount}</Text></View>
              ) : null}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(14, 16, 46, 0.48)',
  },
  container: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 10,
    paddingHorizontal: 18,
    maxHeight: '93%',
    overflow: 'hidden',
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 99,
    backgroundColor: '#D7D9E8',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerIcon: {
    height: 46,
    width: 46,
    borderRadius: 16,
    backgroundColor: '#ECEBFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: { flex: 1 },
  eyebrow: { fontSize: 9, letterSpacing: 1.2, color: colors.primary, fontWeight: '900', marginBottom: 3 },
  title: { fontSize: 23, fontWeight: '900', color: colors.text, letterSpacing: -0.5 },
  subtitle: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 13,
    backgroundColor: '#ECEEF7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { flexShrink: 1 },
  scrollContent: { paddingTop: 17, paddingBottom: 10 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 5,
    marginBottom: 10,
  },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  sectionHint: { color: colors.textSecondary, fontSize: 11, marginTop: 3 },
  typeRow: { flexDirection: 'row', gap: 8, marginBottom: 17 },
  typeOption: {
    flex: 1,
    minHeight: 64,
    borderRadius: 17,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 5,
  },
  typeOptionSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    shadowColor: colors.primary,
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  typeOptionText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  typeOptionTextSelected: { color: '#FFFFFF' },
  countBadge: { backgroundColor: '#ECEBFF', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 99 },
  countBadgeText: { color: colors.primary, fontWeight: '800', fontSize: 10 },
  searchBox: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 13,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    marginBottom: 11,
  },
  searchInput: { flex: 1, paddingVertical: 9, color: colors.text, fontSize: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  categoryCard: {
    position: 'relative',
    width: '31.5%',
    minHeight: 93,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 6,
    marginBottom: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryCardSelected: { backgroundColor: '#F0EFFF', borderColor: colors.primary, borderWidth: 1.5 },
  categoryIconWrap: {
    width: 37,
    height: 37,
    borderRadius: 13,
    backgroundColor: '#F0F1FA',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 7,
  },
  categoryIconWrapSelected: { backgroundColor: '#E2DFFF' },
  categoryIcon: { fontSize: 20 },
  categoryName: { fontSize: 10.5, lineHeight: 14, fontWeight: '700', textAlign: 'center', color: colors.textSecondary },
  categoryNameSelected: { color: colors.primaryDark, fontWeight: '800' },
  categoryCheck: {
    position: 'absolute',
    right: 5,
    top: 5,
    width: 17,
    height: 17,
    borderRadius: 99,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noCategories: { padding: 18, borderRadius: 14, backgroundColor: colors.card, alignItems: 'center' },
  noCategoriesText: { color: colors.textSecondary, fontSize: 12 },
  dateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    borderRadius: 17,
  },
  dateCardActive: { borderColor: colors.primary, backgroundColor: '#F5F4FF' },
  dateIconWrap: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#ECEBFF', alignItems: 'center', justifyContent: 'center' },
  dateCopy: { flex: 1 },
  dateCardLabel: { color: colors.text, fontSize: 12, fontWeight: '800' },
  dateCardValue: { color: colors.textSecondary, fontSize: 11, marginTop: 4 },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  presetRow: { flexDirection: 'row', gap: 8, paddingVertical: 11 },
  presetChip: { backgroundColor: '#ECEBFF', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99 },
  presetText: { color: colors.primaryDark, fontSize: 11, fontWeight: '800' },
  calendarCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 17, padding: 8, marginTop: 2, overflow: 'hidden' },
  calendarIntro: { paddingHorizontal: 8, paddingTop: 8 },
  calendarIntroTitle: { color: colors.text, fontWeight: '800', fontSize: 13 },
  calendarIntroHint: { color: colors.textSecondary, fontSize: 11, marginTop: 3 },
  selectionSummary: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.card, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 11, marginTop: 16 },
  selectionSummaryText: { color: colors.text, fontSize: 11, fontWeight: '700', flex: 1 },
  selectionSummaryMuted: { color: colors.textSecondary, fontSize: 11, flex: 1 },
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 13,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  resetButton: { minWidth: 94, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 14, minHeight: 51 },
  resetText: { color: colors.textSecondary, fontWeight: '800', fontSize: 12 },
  applyButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 15, backgroundColor: colors.primary, paddingHorizontal: 14, minHeight: 51, shadowColor: colors.primary, shadowOpacity: 0.2, shadowRadius: 9, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  applyText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
  applyCount: { minWidth: 21, height: 21, paddingHorizontal: 5, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  applyCountText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
});

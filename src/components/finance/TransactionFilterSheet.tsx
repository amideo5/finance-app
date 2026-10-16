import {
    EXPENSE_CATEGORIES,
    INCOME_CATEGORIES,
} from '@/src/constants/categories';
import { colors } from '@/src/constants/colors';
import { toLocalDateKey } from '@/src/utils/validation';
import { useState } from 'react';
import {
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { Calendar } from 'react-native-calendars';

interface Props {
  visible: boolean;
  onClose: () => void;
  onApply: (filters: any) => void;
}

export default function TransactionFilterSheet({
  visible,
  onClose,
  onApply,
}: Props) {
  const [type, setType] = useState<'all' | 'income' | 'expense'>('all');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);

  const categories =
    type === 'income'
      ? INCOME_CATEGORIES
      : type === 'expense'
        ? EXPENSE_CATEGORIES
        : [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES];

  // 🔥 toggle category
  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category]
    );
  };

  // 🔥 calendar range selection
  const handleDayPress = (day: any) => {
    if (!startDate || (startDate && endDate)) {
      setStartDate(day.dateString);
      setEndDate(null);
    } else {
      if (day.dateString < startDate) {
        setStartDate(day.dateString);
      } else {
        setEndDate(day.dateString);
      }
    }
  };

  // 🔥 marked dates
  const getMarkedDates = () => {
    if (!startDate) return {};

    let marked: any = {
      [startDate]: {
        startingDay: true,
        color: colors.primary,
        textColor: '#fff',
      },
    };

    if (endDate) {
      let current = new Date(startDate);
      const end = new Date(endDate);

      while (current <= end) {
        const dateStr = current.toISOString().split('T')[0];

        marked[dateStr] = {
          color: colors.primary,
          textColor: '#fff',
        };

        current.setDate(current.getDate() + 1);
      }

      marked[startDate] = {
        startingDay: true,
        color: colors.primary,
        textColor: '#fff',
      };

      marked[endDate] = {
        endingDay: true,
        color: colors.primary,
        textColor: '#fff',
      };
    }

    return marked;
  };

  // 🔥 presets
  const applyPreset = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);

    setStartDate(toLocalDateKey(start));
    setEndDate(toLocalDateKey(end));
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* HEADER */}
          <View style={styles.header}>
            <Text style={styles.title}>Filters</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={{ color: colors.textSecondary }}>Close</Text>
            </TouchableOpacity>
          </View>

          <ScrollView>

            {/* TYPE */}
            <View style={styles.row}>
              {['all', 'income', 'expense'].map((t) => (
                <TouchableOpacity
                  key={t}
                  onPress={() => {
                    setType(t as any);
                    setSelectedCategories([]);
                  }}
                  style={[
                    styles.chip,
                    type === t && styles.activeChip,
                  ]}
                >
                  <Text style={styles.chipText}>{t.toUpperCase()}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* CATEGORY */}
            <Text style={styles.section}>
              Categories {selectedCategories.length > 0 && `(${selectedCategories.length})`}
            </Text>

            <View style={styles.grid}>
              {categories.map((cat) => {
                const isSelected = selectedCategories.includes(cat.name);

                return (
                  <TouchableOpacity
                    key={cat.name}
                    onPress={() => toggleCategory(cat.name)}
                    style={[
                      styles.card,
                      isSelected && styles.cardSelected,
                    ]}
                  >
                    <Text style={styles.icon}>{cat.icon}</Text>
                    <Text style={styles.cardText}>{cat.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* PRESETS */}
            <Text style={styles.section}>Quick Range</Text>
            <View style={styles.row}>
              <TouchableOpacity
                style={styles.preset}
                onPress={() => applyPreset(7)}
              >
                <Text>1 Week</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.preset}
                onPress={() => applyPreset(30)}
              >
                <Text>1 Month</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.preset}
                onPress={() => applyPreset(180)}
              >
                <Text>6 Months</Text>
              </TouchableOpacity>
            </View>

            {/* CALENDAR */}
            <Text style={styles.section}>Select Range</Text>

            <Calendar
              markingType={'period'}
              markedDates={getMarkedDates()}
              onDayPress={handleDayPress}
              theme={{
                todayTextColor: colors.primary,
                arrowColor: colors.primary,
              }}
            />

            {/* ACTIONS */}

          </ScrollView>
          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.clearBtn}
              onPress={() => {
                setType('all');
                setSelectedCategories([]);
                setStartDate(null);
                setEndDate(null);
              }}
            >
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.applyBtn}
              onPress={() => {
                onApply({
                  type,
                  categories: selectedCategories,
                  startDate,
                  endDate,
                });
                onClose();
              }}
            >
              <Text style={styles.applyText}>Apply Filters</Text>
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
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  container: {
    backgroundColor: colors.background,
    padding: 16,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  section: {
    marginTop: 12,
    marginBottom: 6,
    color: colors.textSecondary,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.card,
    flexDirection: 'row',
    gap: 6,
    marginRight: 8,
  },
  activeChip: {
    backgroundColor: colors.primary,
  },
  chipText: {
    color: colors.text,
  },
  preset: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.card,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },

  card: {
    width: '33%', // 3columns
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    alignItems: 'center',
  },

  cardSelected: {
    backgroundColor: colors.primary,
  },

  icon: {
    fontSize: 20,
    marginBottom: 4,
  },

  cardText: {
    color: colors.text,
    fontSize: 12,
    textAlign: 'center',
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    borderTopWidth: 1,
    borderColor: '#eee',
    backgroundColor: colors.background,
  },

  clearBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  clearText: {
    color: colors.textSecondary,
    fontWeight: '600',
  },

  applyBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',

    // subtle elevation
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },

  applyText: {
    color: '#fff',
    fontWeight: '700',
  },
});
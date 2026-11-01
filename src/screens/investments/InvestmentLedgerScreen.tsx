import Card from '@/src/components/ui/Card';
import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { getInvestmentPortfolio } from '@/src/services/firebase/investmentsService';
import { formatCurrency } from '@/src/utils/format';
import {
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from 'expo-router';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Filter,
  History,
  Plus,
  Search,
  TrendingUp,
} from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const EVENT_LABELS: Record<string, string> = {
  opening_balance: 'Opening balance',
  contribution: 'Manual contribution',
  withdrawal: 'Withdrawal',
  interest: 'Interest accrued',
  gain: 'Gain recorded',
  loss: 'Loss recorded',
  market_value: 'Market value update',
  bank_transfer: 'Bank transfer',
};

const FILTERS = [
  { value: 'all', label: 'All activity' },
  { value: 'transfer', label: 'Transfers' },
  { value: 'withdrawal', label: 'Withdrawals' },
  { value: 'update', label: 'Value updates' },
];

const formatPaise = (amount: number, currency: string) =>
  formatCurrency(Math.abs(amount) / 100, currency);

export default function InvestmentLedgerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const params = useLocalSearchParams<{
    investmentId?: string | string[];
  }>();

  const initialInvestmentId = Array.isArray(params.investmentId)
    ? params.investmentId[0]
    : params.investmentId;

  const { currentProfile } = useProfile();

  const [transactions, setTransactions] = useState<any[]>([]);
  const [investments, setInvestments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedInvestmentId, setSelectedInvestmentId] = useState(
    initialInvestmentId || 'all',
  );

  const load = useCallback(async () => {
    if (!currentProfile) {
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const result = await getInvestmentPortfolio(currentProfile.id);

      setTransactions(result.transactions);
      setInvestments(result.investments);

      if (initialInvestmentId) {
        setSelectedInvestmentId(initialInvestmentId);
      }
    } catch (error) {
      console.error('Investment ledger load failed:', error);
    } finally {
      setLoading(false);
    }
  }, [currentProfile, initialInvestmentId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const displayed = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return transactions.filter((item) => {
      if (
        selectedInvestmentId !== 'all' &&
        item.investmentId !== selectedInvestmentId
      ) {
        return false;
      }

      if (filter === 'transfer' && item.type !== 'bank_transfer') {
        return false;
      }

      if (filter === 'withdrawal' && item.type !== 'withdrawal') {
        return false;
      }

      if (
        filter === 'update' &&
        !['interest', 'gain', 'loss', 'market_value'].includes(item.type)
      ) {
        return false;
      }

      const searchable = [
        item.investmentName || '',
        item.notes || '',
        item.marketTransactionType === 'buy'
          ? 'Purchase buy'
          : item.marketTransactionType === 'sell'
            ? 'Sale redemption'
            : item.type === 'bank_transfer'
              ? item.direction === 'out' ? 'Bank transfer out' : 'Bank transfer in'
              : EVENT_LABELS[item.type] || item.type,
      ]
        .join(' ')
        .toLowerCase();

      if (needle && !searchable.includes(needle)) {
        return false;
      }

      return true;
    });
  }, [transactions, selectedInvestmentId, filter, search]);

  const currency = currentProfile?.currency || 'INR';

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Math.max(insets.top + 6, 24),
            paddingBottom: Math.max(insets.bottom, 18) + 24,
          },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => {
              void load();
            }}
            tintColor={colors.primary}
          />
        }
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <ArrowLeft size={18} color={colors.text} />
          <Text style={styles.backText}>Portfolio</Text>
        </TouchableOpacity>

        <View style={styles.headingRow}>
          <View style={styles.headingIcon}>
            <History size={23} color={colors.primary} />
          </View>

          <View style={styles.headingCopy}>
            <Text style={styles.title}>Investment ledger</Text>
            <Text style={styles.subtitle}>
              Independent history for every portfolio asset
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.primaryAction}
            onPress={() =>
              router.push({
                pathname: '/investments/activity',
                params:
                  selectedInvestmentId !== 'all'
                    ? { investmentId: selectedInvestmentId }
                    : {},
              })
            }
          >
            <Plus size={16} color="#FFFFFF" />
            <Text style={styles.primaryActionText}>Record activity</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryAction}
            onPress={() =>
              router.push({
                pathname: '/investments/transfer',
                params:
                  selectedInvestmentId !== 'all'
                    ? { investmentId: selectedInvestmentId }
                    : {},
              })
            }
          >
            <ArrowLeftRight size={16} color={colors.primary} />
            <Text style={styles.secondaryActionText}>Transfer in</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryAction}
            onPress={() =>
              router.push({
                pathname: '/investments/transfer-out',
                params:
                  selectedInvestmentId !== 'all'
                    ? { investmentId: selectedInvestmentId }
                    : {},
              })
            }
          >
            <ArrowLeftRight size={16} color={colors.danger} />
            <Text style={styles.secondaryActionText}>Transfer out</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>INVESTMENT</Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          <TouchableOpacity
            onPress={() => setSelectedInvestmentId('all')}
            style={[
              styles.assetChip,
              selectedInvestmentId === 'all' && styles.assetChipSelected,
            ]}
          >
            <Text
              style={[
                styles.assetChipText,
                selectedInvestmentId === 'all' &&
                  styles.assetChipTextSelected,
              ]}
            >
              All holdings
            </Text>
          </TouchableOpacity>

          {investments.map((item) => (
            <TouchableOpacity
              key={item.id}
              onPress={() => setSelectedInvestmentId(item.id)}
              style={[
                styles.assetChip,
                selectedInvestmentId === item.id &&
                  styles.assetChipSelected,
              ]}
            >
              <Text
                style={[
                  styles.assetChipText,
                  selectedInvestmentId === item.id &&
                    styles.assetChipTextSelected,
                ]}
                numberOfLines={1}
              >
                {item.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.searchBox}>
          <Search size={16} color={colors.textLight} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search investment or notes"
            placeholderTextColor={colors.textLight}
            style={styles.searchInput}
          />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {FILTERS.map((item) => (
            <TouchableOpacity
              key={item.value}
              style={[
                styles.filterChip,
                filter === item.value && styles.filterChipSelected,
              ]}
              onPress={() => setFilter(item.value)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  filter === item.value && styles.filterChipTextSelected,
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.resultHeader}>
          <View>
            <Text style={styles.sectionTitle}>Activity history</Text>
            <Text style={styles.sectionSub}>
              {displayed.length}{' '}
              {displayed.length === 1 ? 'entry' : 'entries'} · newest first
            </Text>
          </View>
          <Filter size={17} color={colors.textLight} />
        </View>

        <Card style={styles.listCard} padding={0}>
          {loading && !transactions.length ? (
            <View style={styles.empty}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.emptyText}>Loading ledger…</Text>
            </View>
          ) : displayed.length ? (
            displayed.map((item, index) => {
              const delta = Number(item.amountInPaise || 0);
              const negative =
                delta < 0 ||
                item.type === 'withdrawal' ||
                item.type === 'loss';

              return (
                <TouchableOpacity
                  key={`${item.investmentId}-${item.id}`}
                  activeOpacity={0.85}
                  onPress={() =>
                    router.push(`/investments/${item.investmentId}`)
                  }
                  style={[
                    styles.entry,
                    index < displayed.length - 1 && styles.entryBorder,
                  ]}
                >
                  <View
                    style={[
                      styles.entryIcon,
                      {
                        backgroundColor: negative
                          ? '#FFE8E8'
                          : item.type === 'market_value'
                            ? '#E4F0FF'
                            : '#DFF8EC',
                      },
                    ]}
                  >
                    {item.type === 'bank_transfer' ? (
                      <ArrowLeftRight size={17} color={colors.primary} />
                    ) : item.type === 'market_value' ? (
                      <TrendingUp size={17} color="#3275C9" />
                    ) : negative ? (
                      <ArrowUpRight size={17} color={colors.danger} />
                    ) : (
                      <ArrowDownLeft size={17} color="#14845B" />
                    )}
                  </View>

                  <View style={styles.entryCopy}>
                    <Text style={styles.entryTitle}>
                      {item.marketTransactionType === 'buy'
                        ? 'Purchase / buy'
                        : item.marketTransactionType === 'sell'
                          ? 'Sale / redemption'
                          : item.type === 'bank_transfer'
                            ? item.direction === 'out' ? 'Bank transfer out' : 'Bank transfer in'
                            : EVENT_LABELS[item.type] || 'Portfolio activity'}
                    </Text>

                    <Text style={styles.entryAsset}>
                      {item.investmentName || 'Investment'}
                    </Text>

                    <Text style={styles.entryDate}>
                      {item.date || 'Date not set'}
                      {item.notes ? ` · ${item.notes}` : ''}
                    </Text>
                  </View>

                  <View style={styles.entryRight}>
                    <Text
                      style={[
                        styles.entryAmount,
                        {
                          color: negative
                            ? colors.danger
                            : colors.success,
                        },
                      ]}
                    >
                      {delta < 0 ? '−' : '+'}
                      {formatPaise(delta, currency)}
                    </Text>

                    {item.type === 'market_value' ? (
                      <Text style={styles.entrySub}>
                        New value{' '}
                        {formatCurrency(
                          Number(item.newValueInPaise || 0) / 100,
                          currency,
                        )}
                      </Text>
                    ) : item.marketTransactionType ? (
                      <>
                        <Text style={styles.entrySub}>
                          {Math.abs(Number(item.quantity || 0)).toLocaleString('en-IN', { maximumFractionDigits: 6 })} {item.assetClass === 'stock' ? 'shares' : 'units'} · ₹{Number(item.unitPrice || 0).toLocaleString('en-IN', { maximumFractionDigits: 4 })}
                        </Text>
                        {item.marketTransactionType === 'sell' ? (
                          <Text style={styles.entrySub}>Realized P&L ₹{(Number(item.realizedGainLossInPaise || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</Text>
                        ) : null}
                      </>
                    ) : item.type === 'bank_transfer' ? (
                      <Text style={styles.entrySub}>{item.direction === 'out' ? 'Bank outflow' : 'Bank inflow'}</Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })
          ) : (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <History size={22} color={colors.primary} />
              </View>
              <Text style={styles.emptyTitle}>No matching activity</Text>
              <Text style={styles.emptyText}>
                Try another filter, or record your first investment update.
              </Text>

              <TouchableOpacity
                onPress={() =>
                  router.push({
                    pathname: '/investments/activity',
                    params:
                      selectedInvestmentId !== 'all'
                        ? { investmentId: selectedInvestmentId }
                        : {},
                  })
                }
                style={styles.emptyButton}
              >
                <Plus size={15} color="#FFFFFF" />
                <Text style={styles.emptyButtonText}>Record activity</Text>
              </TouchableOpacity>
            </View>
          )}
        </Card>

        <Text style={styles.footerNote}>
          Bank-to-investment transfers pair with a main-ledger expense;
          investment-to-bank transfers pair with a main-ledger inflow. Internal
          transfers are excluded from income/expense summaries.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 18 },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    marginBottom: 22,
  },
  backText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  headingIcon: {
    width: 53,
    height: 53,
    borderRadius: 18,
    backgroundColor: '#EAE9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headingCopy: { flex: 1 },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 5,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
    marginBottom: 20,
  },
  primaryAction: {
    flexGrow: 1,
    flexBasis: '30%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: colors.primary,
    height: 46,
    borderRadius: 14,
  },
  primaryActionText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  secondaryAction: {
    flexGrow: 1,
    flexBasis: '30%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#F0EFFF',
    height: 46,
    borderRadius: 14,
  },
  secondaryActionText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '800',
  },
  label: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 8,
  },
  filterRow: { gap: 7, paddingBottom: 8 },
  assetChip: {
    maxWidth: 180,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  assetChipSelected: {
    backgroundColor: '#EAE9FF',
    borderColor: colors.primary,
  },
  assetChipText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
  },
  assetChipTextSelected: { color: colors.primary },
  searchBox: {
    height: 45,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 13,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    marginTop: 12,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 11,
    paddingVertical: 0,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: '#ECEEF6',
  },
  filterChipSelected: { backgroundColor: colors.text },
  filterChipText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
  },
  filterChipTextSelected: { color: '#FFFFFF' },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    marginBottom: 11,
  },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  sectionSub: { color: colors.textSecondary, fontSize: 10, marginTop: 4 },
  listCard: { overflow: 'hidden' },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 13,
  },
  entryBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  entryIcon: {
    width: 36,
    height: 36,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entryCopy: { flex: 1, gap: 3 },
  entryTitle: { color: colors.text, fontSize: 11, fontWeight: '800' },
  entryAsset: { color: colors.textSecondary, fontSize: 9, fontWeight: '700' },
  entryDate: { color: colors.textLight, fontSize: 8, lineHeight: 13 },
  entryRight: { alignItems: 'flex-end', maxWidth: 115, gap: 4 },
  entryAmount: { fontSize: 10, fontWeight: '800' },
  entrySub: { color: colors.textLight, fontSize: 8 },
  empty: { alignItems: 'center', padding: 27, gap: 9 },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 17,
    backgroundColor: '#EAE9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { color: colors.text, fontSize: 13, fontWeight: '800' },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 10,
    lineHeight: 15,
    textAlign: 'center',
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 10,
    marginTop: 4,
  },
  emptyButtonText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  footerNote: {
    color: colors.textLight,
    fontSize: 9,
    lineHeight: 14,
    textAlign: 'center',
    marginTop: 17,
    paddingHorizontal: 12,
  },
});
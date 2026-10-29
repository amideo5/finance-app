import Card from '@/src/components/ui/Card';
import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { getInvestmentPortfolio } from '@/src/services/firebase/investmentsService';
import { formatCurrency, formatDate } from '@/src/utils/format';
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
  CalendarDays,
  ChevronRight,
  History,
  Plus,
  TrendingUp,
  Wallet,
} from 'lucide-react-native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const LABELS: Record<string, string> = {
  fixed_deposit: 'Fixed Deposit',
  recurring_deposit: 'Recurring Deposit',
  mutual_fund: 'Mutual Fund',
  stock: 'Stock',
  other: 'Other asset',
};

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

const formatMoneyPaise = (amount: number, currency: string) =>
  formatCurrency(amount / 100, currency);

export default function InvestmentDetailScreen() {
  const router = useRouter();

  const params = useLocalSearchParams<{
    investmentId?: string | string[];
  }>();

  const investmentId = Array.isArray(params.investmentId)
    ? params.investmentId[0]
    : params.investmentId;

  const insets = useSafeAreaInsets();
  const { currentProfile } = useProfile();

  const [investment, setInvestment] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!currentProfile || !investmentId) {
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const portfolio = await getInvestmentPortfolio(currentProfile.id);

      const found = portfolio.investments.find(
        (item: any) => item.id === investmentId,
      );

      setInvestment(found || null);

      setTransactions(
        portfolio.transactions.filter(
          (item: any) => item.investmentId === investmentId,
        ),
      );
    } catch (error) {
      console.error('Investment detail load failed:', error);

      Alert.alert(
        'Could not load investment',
        'Please refresh and try again.',
      );
    } finally {
      setLoading(false);
    }
  }, [currentProfile, investmentId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const currency = currentProfile?.currency || 'INR';
  const value = Number(investment?.currentValueInPaise || 0);
  const invested = Number(investment?.investedAmountInPaise || 0);
  const gain = value - invested;

  if (loading && !investment) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading investment…</Text>
      </View>
    );
  }

  if (!investment) {
    return (
      <View style={styles.loadingScreen}>
        <Text style={styles.notFoundTitle}>Investment not found</Text>
        <Text style={styles.loadingText}>
          It may have been removed or belongs to another profile.
        </Text>

        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <ArrowLeft size={17} color={colors.primary} />
          <Text style={styles.backText}>Back to portfolio</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Math.max(insets.top + 6, 24),
            paddingBottom: Math.max(insets.bottom, 18) + 22,
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
            <Text style={styles.headingEmoji}>
              {investment.assetClass === 'fixed_deposit'
                ? '🏦'
                : investment.assetClass === 'recurring_deposit'
                  ? '🗓️'
                  : investment.assetClass === 'mutual_fund'
                    ? '📊'
                    : investment.assetClass === 'stock'
                      ? '📈'
                      : '💼'}
            </Text>
          </View>

          <View style={styles.headingCopy}>
            <Text style={styles.title}>{investment.name}</Text>
            <Text style={styles.subtitle}>
              {LABELS[investment.assetClass] || 'Other asset'}
              {investment.provider ? ` · ${investment.provider}` : ''}
            </Text>
            {investment.symbol ? (
              <Text style={styles.symbol}>{investment.symbol}</Text>
            ) : null}
          </View>
        </View>

        <View style={styles.valueCard}>
          <Text style={styles.valueLabel}>CURRENT VALUE</Text>
          <Text style={styles.value}>
            {formatMoneyPaise(value, currency)}
          </Text>

          <View style={styles.valueDivider} />

          <View style={styles.metricsRow}>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Net invested</Text>
              <Text style={styles.metricValue}>
                {formatMoneyPaise(invested, currency)}
              </Text>
            </View>

            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Gain / loss</Text>
              <Text
                style={[
                  styles.metricValue,
                  {
                    color: gain >= 0 ? colors.success : colors.danger,
                  },
                ]}
              >
                {gain >= 0 ? '+' : '−'}
                {formatMoneyPaise(Math.abs(gain), currency)}
              </Text>
            </View>
          </View>

          {investment.lastValuationDate ? (
            <Text style={styles.valuationText}>
              Last updated {formatDate(investment.lastValuationDate)}
            </Text>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>Quick actions</Text>

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() =>
              router.push({
                pathname: '/investments/activity',
                params: { investmentId: investment.id },
              })
            }
          >
            <View
              style={[
                styles.actionIcon,
                { backgroundColor: '#EAE9FF' },
              ]}
            >
              <TrendingUp size={19} color={colors.primary} />
            </View>
            <Text style={styles.actionTitle}>Record update</Text>
            <Text style={styles.actionSub}>Interest, gain or value</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() =>
              router.push({
                pathname: '/investments/transfer',
                params: { investmentId: investment.id },
              })
            }
          >
            <View
              style={[
                styles.actionIcon,
                { backgroundColor: '#DFF8EC' },
              ]}
            >
              <ArrowLeftRight size={19} color="#16875B" />
            </View>
            <Text style={styles.actionTitle}>Transfer in</Text>
            <Text style={styles.actionSub}>From a bank account</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={() =>
              router.push({
                pathname: '/investments/transfer-out',
                params: { investmentId: investment.id },
              })
            }
          >
            <View
              style={[
                styles.actionIcon,
                { backgroundColor: '#FFE7E7' },
              ]}
            >
              <ArrowLeftRight size={19} color={colors.danger} />
            </View>
            <Text style={styles.actionTitle}>Transfer out</Text>
            <Text style={styles.actionSub}>To a bank account</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.addActivity}
          onPress={() =>
            router.push({
              pathname: '/investments/activity',
              params: { investmentId: investment.id },
            })
          }
        >
          <Plus size={17} color={colors.primary} />
          <Text style={styles.addActivityText}>Add portfolio activity</Text>
          <ChevronRight size={17} color={colors.primary} />
        </TouchableOpacity>

        <View style={styles.ledgerHeader}>
          <View>
            <Text style={styles.sectionTitle}>Investment ledger</Text>
            <Text style={styles.sectionSub}>
              {transactions.length} recorded activities
            </Text>
          </View>

          <TouchableOpacity
            onPress={() =>
              router.push({
                pathname: '/investments/ledger',
                params: { investmentId: investment.id },
              })
            }
            style={styles.viewAll}
          >
            <History size={14} color={colors.primary} />
            <Text style={styles.viewAllText}>Full ledger</Text>
          </TouchableOpacity>
        </View>

        <Card style={styles.ledgerCard} padding={0}>
          {transactions.length ? (
            transactions.slice(0, 12).map((item: any, index: number) => {
              const delta = Number(item.amountInPaise || 0);

              const isNegative =
                delta < 0 ||
                item.type === 'withdrawal' ||
                item.type === 'loss';

              return (
                <View
                  key={item.id}
                  style={[
                    styles.ledgerRow,
                    index < Math.min(transactions.length, 12) - 1 &&
                      styles.ledgerBorder,
                  ]}
                >
                  <View
                    style={[
                      styles.ledgerIcon,
                      {
                        backgroundColor: isNegative
                          ? '#FFE8E8'
                          : '#E1F8EC',
                      },
                    ]}
                  >
                    {isNegative ? (
                      <ArrowUpRight size={17} color={colors.danger} />
                    ) : (
                      <ArrowDownLeft size={17} color="#14845B" />
                    )}
                  </View>

                  <View style={styles.ledgerCopy}>
                    <Text style={styles.ledgerTitle}>
                      {item.type === 'bank_transfer'
                        ? item.direction === 'out'
                          ? 'Bank transfer out'
                          : 'Bank transfer in'
                        : EVENT_LABELS[item.type] || 'Portfolio activity'}
                    </Text>

                    <Text style={styles.ledgerDate}>
                      {item.date || 'Date not set'}
                      {item.notes ? ` · ${item.notes}` : ''}
                    </Text>
                  </View>

                  <View style={styles.ledgerRight}>
                    <Text
                      style={[
                        styles.ledgerAmount,
                        {
                          color: isNegative
                            ? colors.danger
                            : colors.success,
                        },
                      ]}
                    >
                      {delta < 0 ? '−' : '+'}
                      {formatMoneyPaise(Math.abs(delta), currency)}
                    </Text>

                    {item.type === 'market_value' ? (
                      <Text style={styles.ledgerSub}>
                        Value:{' '}
                        {formatMoneyPaise(
                          Number(item.newValueInPaise || 0),
                          currency,
                        )}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })
          ) : (
            <View style={styles.emptyLedger}>
              <CalendarDays size={22} color={colors.textLight} />
              <Text style={styles.emptyText}>
                No activities recorded for this holding yet.
              </Text>
            </View>
          )}
        </Card>

        {investment.notes ? (
          <Card style={styles.notesCard}>
            <Text style={styles.noteLabel}>NOTES</Text>
            <Text style={styles.noteText}>{investment.notes}</Text>
          </Card>
        ) : null}

        <View style={styles.infoNote}>
          <Wallet size={15} color={colors.textSecondary} />
          <Text style={styles.infoText}>
            Portfolio updates stay separate. “Transfer in” and “Transfer out”
            create matching entries in the main finance ledger and this
            investment ledger.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 18 },
  loadingScreen: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 26,
    gap: 12,
  },
  loadingText: {
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  notFoundTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    marginBottom: 22,
  },
  backText: { fontSize: 12, color: colors.text, fontWeight: '700' },
  headingRow: {
    flexDirection: 'row',
    gap: 13,
    alignItems: 'center',
    marginBottom: 20,
  },
  headingIcon: {
    width: 58,
    height: 58,
    borderRadius: 20,
    backgroundColor: '#EAE9FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headingEmoji: { fontSize: 25 },
  headingCopy: { flex: 1 },
  title: {
    fontSize: 23,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.5,
  },
  subtitle: { fontSize: 11, color: colors.textSecondary, marginTop: 5 },
  symbol: {
    fontSize: 9,
    color: colors.primary,
    fontWeight: '800',
    marginTop: 4,
  },
  valueCard: {
    backgroundColor: colors.card,
    borderRadius: 22,
    padding: 20,
    borderColor: colors.border,
    borderWidth: 1,
    marginBottom: 23,
  },
  valueLabel: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  value: {
    color: colors.text,
    fontSize: 29,
    fontWeight: '800',
    marginTop: 9,
  },
  valueDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 17,
  },
  metricsRow: { flexDirection: 'row', gap: 16 },
  metric: { flex: 1 },
  metricLabel: { color: colors.textSecondary, fontSize: 10, marginBottom: 6 },
  metricValue: { color: colors.text, fontSize: 13, fontWeight: '800' },
  valuationText: { color: colors.textLight, fontSize: 9, marginTop: 13 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '800' },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    marginBottom: 10,
  },
  actionButton: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 13,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionIcon: {
    width: 39,
    height: 39,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  actionTitle: { color: colors.text, fontSize: 11, fontWeight: '800' },
  actionSub: {
    color: colors.textSecondary,
    fontSize: 9,
    marginTop: 5,
    lineHeight: 13,
  },
  addActivity: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 45,
    borderRadius: 14,
    backgroundColor: '#F0EFFF',
    marginBottom: 25,
  },
  addActivityText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '800',
    flex: 1,
  },
  ledgerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 11,
  },
  sectionSub: { fontSize: 10, color: colors.textSecondary, marginTop: 4 },
  viewAll: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  viewAllText: { color: colors.primary, fontWeight: '800', fontSize: 10 },
  ledgerCard: { overflow: 'hidden' },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 13,
  },
  ledgerBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  ledgerIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ledgerCopy: { flex: 1, gap: 4 },
  ledgerTitle: { color: colors.text, fontWeight: '800', fontSize: 11 },
  ledgerDate: { color: colors.textSecondary, fontSize: 9, lineHeight: 13 },
  ledgerRight: { alignItems: 'flex-end', gap: 3 },
  ledgerAmount: { fontWeight: '800', fontSize: 10 },
  ledgerSub: { color: colors.textLight, fontSize: 8 },
  emptyLedger: { padding: 25, alignItems: 'center', gap: 9 },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 10,
    textAlign: 'center',
  },
  notesCard: { marginTop: 14 },
  noteLabel: {
    color: colors.textSecondary,
    fontSize: 9,
    fontWeight: '800',
    marginBottom: 8,
  },
  noteText: { color: colors.text, fontSize: 11, lineHeight: 17 },
  infoNote: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 17,
    paddingHorizontal: 3,
    alignItems: 'flex-start',
  },
  infoText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 9,
    lineHeight: 14,
  },
});
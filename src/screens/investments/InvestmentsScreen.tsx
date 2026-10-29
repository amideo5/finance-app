import Card from '@/src/components/ui/Card';
import { AppLineChart, AppPieChart } from '@/src/components/ui/Chart';
import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { getInvestmentPortfolio } from '@/src/services/firebase/investmentsService';
import { formatCurrency, formatPercent, formatShortDate } from '@/src/utils/format';
import { useFocusEffect, useRouter } from 'expo-router';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ChevronRight, History, Plus, RefreshCw, TrendingUp, Wallet } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ASSET_META: Record<string, { label: string; icon: string; color: string }> = {
  fixed_deposit: { label: 'Fixed Deposits', icon: '🏦', color: '#6157E8' },
  recurring_deposit: { label: 'Recurring Deposits', icon: '🗓️', color: '#16A085' },
  mutual_fund: { label: 'Mutual Funds', icon: '📊', color: '#F59E0B' },
  stock: { label: 'Stocks', icon: '📈', color: '#EC4899' },
  other: { label: 'Other assets', icon: '💼', color: '#3B82F6' },
};

const money = (paise: number, currency: string) => formatCurrency(paise / 100, currency);

export default function InvestmentsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { currentProfile } = useProfile();

  const [portfolio, setPortfolio] = useState<any>({
    investments: [],
    transactions: [],
    snapshots: [],
    totalValueInPaise: 0,
    totalInvestedInPaise: 0,
  });
  const [loading, setLoading] = useState(true);

  const loadPortfolio = useCallback(async () => {
    if (!currentProfile) {
      setPortfolio({
        investments: [],
        transactions: [],
        snapshots: [],
        totalValueInPaise: 0,
        totalInvestedInPaise: 0,
      });
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      setPortfolio(await getInvestmentPortfolio(currentProfile.id));
    } catch (error) {
      console.error('Portfolio load failed:', error);
      Alert.alert(
        'Could not load portfolio',
        'Check your connection and try again.',
      );
    } finally {
      setLoading(false);
    }
  }, [currentProfile]);

  useFocusEffect(
    useCallback(() => {
      void loadPortfolio();
    }, [loadPortfolio]),
  );

  const currency = currentProfile?.currency || 'INR';
  const currentValue = Number(portfolio.totalValueInPaise || 0);
  const invested = Number(portfolio.totalInvestedInPaise || 0);
  const gain = currentValue - invested;
  const gainPercent = invested > 0 ? (gain / invested) * 100 : 0;

  const allocation = useMemo(() => {
    const totals = new Map<string, number>();

    (portfolio.investments || []).forEach((item: any) => {
      const key = item.assetClass || 'other';
      totals.set(
        key,
        (totals.get(key) || 0) + Number(item.currentValueInPaise || 0),
      );
    });

    return [...totals.entries()]
      .filter(([, value]) => value > 0)
      .map(([key, value]) => ({
        key,
        value,
        meta: ASSET_META[key] || ASSET_META.other,
      }));
  }, [portfolio.investments]);

  const growthData = useMemo(() => {
    const snapshots = (portfolio.snapshots || []).slice(-8);

    const points = snapshots.length
      ? snapshots.map((item: any) => ({
          label: formatShortDate(item.date || new Date()),
          value:
            Number(
              item.totalValueInPaise ??
                Math.round(Number(item.totalValue || 0) * 100),
            ) / 100,
        }))
      : [{ label: 'Now', value: currentValue / 100 }];

    return {
      labels: points.map((item: any) => item.label),
      datasets: [
        { data: points.map((item: any) => Math.max(0, item.value)) },
      ],
    };
  }, [portfolio.snapshots, currentValue]);

  const recentTransactions = (portfolio.transactions || []).slice(0, 4);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Math.max(insets.top + 6, 24),
            paddingBottom: Math.max(insets.bottom, 18) + 26,
          },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => {
              void loadPortfolio();
            }}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>GROW YOUR MONEY</Text>
            <Text style={styles.title}>Investments</Text>
            <Text style={styles.subtitle}>Your portfolio, all in one place</Text>
          </View>

          <TouchableOpacity
            style={styles.refreshButton}
            onPress={() => {
              void loadPortfolio();
            }}
            accessibilityRole="button"
            accessibilityLabel="Refresh portfolio"
          >
            <RefreshCw size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>

        <LinearGradient
          colors={['#28235F', '#5548C9', '#7568F2']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroTop}>
            <View style={styles.heroIcon}>
              <Wallet size={18} color="#FFFFFF" />
            </View>
            <Text style={styles.heroLabel}>TOTAL PORTFOLIO VALUE</Text>
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>TRACKED</Text>
            </View>
          </View>

          <Text style={styles.totalValue}>
            {money(currentValue, currency)}
          </Text>

          <View style={styles.returnRow}>
            {gain >= 0 ? (
              <ArrowUpRight size={16} color="#B7F7D1" />
            ) : (
              <ArrowDownLeft size={16} color="#FFD2D2" />
            )}
            <Text
              style={[
                styles.returnText,
                gain < 0 && { color: '#FFD2D2' },
              ]}
            >
              {money(Math.abs(gain), currency)} ({formatPercent(gainPercent)}){' '}
              {gain >= 0 ? 'overall gain' : 'overall loss'}
            </Text>
          </View>

          <View style={styles.heroDivider} />

          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>Net invested</Text>
              <Text style={styles.heroStatValue}>
                {money(invested, currency)}
              </Text>
            </View>

            <View style={styles.statDivider} />

            <View style={styles.heroStat}>
              <Text style={styles.heroStatLabel}>Holdings</Text>
              <Text style={styles.heroStatValue}>
                {portfolio.investments?.length || 0}
              </Text>
            </View>
          </View>

          <View pointerEvents="none" style={styles.heroGlow} />
        </LinearGradient>

        <View style={styles.quickActions}>
          <TouchableOpacity
            style={styles.quickAction}
            onPress={() => router.push('/investments/add')}
            activeOpacity={0.85}
          >
            <View
              style={[styles.actionIcon, { backgroundColor: '#EAE9FF' }]}
            >
              <Plus color={colors.primary} size={20} />
            </View>
            <Text style={styles.actionLabel}>Add asset</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickAction}
            onPress={() => router.push('/investments/transfer')}
            activeOpacity={0.85}
          >
            <View
              style={[styles.actionIcon, { backgroundColor: '#DFF8EC' }]}
            >
              <ArrowLeftRight color="#13845A" size={20} />
            </View>
            <Text style={styles.actionLabel}>Transfer in</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickAction}
            onPress={() => router.push('/investments/transfer-out')}
            activeOpacity={0.85}
          >
            <View
              style={[styles.actionIcon, { backgroundColor: '#FFE7E7' }]}
            >
              <ArrowLeftRight color={colors.danger} size={20} />
            </View>
            <Text style={styles.actionLabel}>Transfer out</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickAction}
            onPress={() => router.push('/investments/activity')}
            activeOpacity={0.85}
          >
            <View
              style={[styles.actionIcon, { backgroundColor: '#FFF0D7' }]}
            >
              <TrendingUp color="#B77711" size={20} />
            </View>
            <Text style={styles.actionLabel}>Record update</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickAction}
            onPress={() => router.push('/investments/ledger')}
            activeOpacity={0.85}
          >
            <View
              style={[styles.actionIcon, { backgroundColor: '#E4F0FF' }]}
            >
              <History color="#3275C9" size={20} />
            </View>
            <Text style={styles.actionLabel}>Ledger</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>Portfolio growth</Text>
            <Text style={styles.sectionSubtitle}>
              Recorded portfolio values over time
            </Text>
          </View>
        </View>

        <Card style={styles.chartCard}>
          {portfolio.snapshots?.length > 1 ? (
            <AppLineChart data={growthData} height={190} />
          ) : (
            <View style={styles.chartEmpty}>
              <View style={styles.chartEmptyIcon}>
                <TrendingUp size={22} color={colors.primary} />
              </View>
              <Text style={styles.chartEmptyTitle}>
                Your growth graph starts here
              </Text>
              <Text style={styles.chartEmptyText}>
                As you add holdings and record values, your portfolio history
                will appear here.
              </Text>
            </View>
          )}

          <View style={styles.chartCaption}>
            <View style={styles.legendDot} />
            <Text style={styles.captionText}>Portfolio value</Text>
            <Text style={styles.captionHint}>
              {portfolio.snapshots?.length || 0} snapshots
            </Text>
          </View>
        </Card>

        <View style={[styles.sectionHeader, { marginTop: 22 }]}>
          <View>
            <Text style={styles.sectionTitle}>Asset allocation</Text>
            <Text style={styles.sectionSubtitle}>
              Where your portfolio is invested
            </Text>
          </View>
        </View>

        <Card style={styles.chartCard}>
          {allocation.length ? (
            <>
              <AppPieChart
                data={allocation.map((item: any) => ({
                  name: item.meta.label,
                  population: item.value / 100,
                  color: item.meta.color,
                  legendFontColor: colors.textSecondary,
                  legendFontSize: 11,
                }))}
                height={190}
              />

              <View style={styles.allocationList}>
                {allocation.map((item: any) => (
                  <View key={item.key} style={styles.allocationRow}>
                    <View style={styles.allocationLeft}>
                      <View
                        style={[
                          styles.allocationDot,
                          { backgroundColor: item.meta.color },
                        ]}
                      />
                      <Text style={styles.allocationLabel}>
                        {item.meta.label}
                      </Text>
                    </View>

                    <View style={styles.allocationRight}>
                      <Text style={styles.allocationValue}>
                        {money(item.value, currency)}
                      </Text>
                      <Text style={styles.allocationPercent}>
                        {currentValue > 0
                          ? `${((item.value / currentValue) * 100).toFixed(1)}%`
                          : '0%'}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <View style={styles.chartEmpty}>
              <View style={styles.chartEmptyIcon}>
                <Wallet size={22} color={colors.primary} />
              </View>
              <Text style={styles.chartEmptyTitle}>
                No allocation to show yet
              </Text>
              <Text style={styles.chartEmptyText}>
                Add a fixed deposit, recurring deposit, mutual fund, stock, or
                another asset to see the breakdown.
              </Text>
            </View>
          )}
        </Card>

        <View style={[styles.sectionHeader, { marginTop: 22 }]}>
          <View>
            <Text style={styles.sectionTitle}>Your holdings</Text>
            <Text style={styles.sectionSubtitle}>
              {portfolio.investments?.length || 0} tracked assets
            </Text>
          </View>

          <TouchableOpacity
            style={styles.seeAll}
            onPress={() => router.push('/investments/ledger')}
          >
            <Text style={styles.seeAllText}>View ledger</Text>
            <ChevronRight color={colors.primary} size={15} />
          </TouchableOpacity>
        </View>

        {loading && !portfolio.investments?.length ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Loading portfolio…</Text>
          </View>
        ) : null}

        {(portfolio.investments || []).map((item: any) => {
          const meta = ASSET_META[item.assetClass] || ASSET_META.other;
          const itemValue = Number(item.currentValueInPaise || 0);
          const itemInvested = Number(item.investedAmountInPaise || 0);
          const itemGain = itemValue - itemInvested;

          return (
            <TouchableOpacity
              key={item.id}
              activeOpacity={0.82}
              onPress={() => router.push(`/investments/${item.id}`)}
              style={styles.holdingRow}
            >
              <View
                style={[
                  styles.holdingIcon,
                  { backgroundColor: `${meta.color}18` },
                ]}
              >
                <Text style={styles.holdingEmoji}>{meta.icon}</Text>
              </View>

              <View style={styles.holdingCopy}>
                <Text style={styles.holdingName} numberOfLines={1}>
                  {item.name}
                </Text>

                <Text style={styles.holdingType}>
                  {meta.label}
                  {item.provider ? ` · ${item.provider}` : ''}
                </Text>

                <Text
                  style={[
                    styles.holdingReturn,
                    {
                      color:
                        itemGain >= 0 ? colors.success : colors.danger,
                    },
                  ]}
                >
                  {itemGain >= 0 ? '+' : '−'}
                  {money(Math.abs(itemGain), currency)} unrealized
                </Text>
              </View>

              <View style={styles.holdingRight}>
                <Text style={styles.holdingValue}>
                  {money(itemValue, currency)}
                </Text>
                <ChevronRight size={17} color={colors.textLight} />
              </View>
            </TouchableOpacity>
          );
        })}

        {!loading && !(portfolio.investments || []).length ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}>
              <Wallet size={24} color={colors.primary} />
            </View>
            <Text style={styles.emptyTitle}>Build your portfolio</Text>
            <Text style={styles.emptyText}>
              Track deposits, mutual funds, stocks, and any other asset
              separately from daily spending.
            </Text>

            <TouchableOpacity
              style={styles.emptyButton}
              onPress={() => router.push('/investments/add')}
            >
              <Plus color="#FFFFFF" size={16} />
              <Text style={styles.emptyButtonText}>
                Add your first investment
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>Recent activity</Text>
            <Text style={styles.sectionSubtitle}>
              Latest portfolio ledger entries
            </Text>
          </View>

          <TouchableOpacity
            onPress={() => router.push('/investments/ledger')}
            style={styles.seeAll}
          >
            <Text style={styles.seeAllText}>All activity</Text>
            <ChevronRight color={colors.primary} size={15} />
          </TouchableOpacity>
        </View>

        <Card style={styles.recentCard} padding={0}>
          {recentTransactions.length ? (
            recentTransactions.map((item: any, index: number) => {
              const positive =
                Number(item.amountInPaise || 0) >= 0 &&
                !['withdrawal', 'loss'].includes(item.type);
              const amount = Math.abs(Number(item.amountInPaise || 0));

              return (
                <View
                  key={`${item.investmentId}-${item.id}`}
                  style={[
                    styles.recentRow,
                    index < recentTransactions.length - 1 &&
                      styles.recentBorder,
                  ]}
                >
                  <View
                    style={[
                      styles.recentIcon,
                      {
                        backgroundColor: positive ? '#DFF8EC' : '#FFE7E7',
                      },
                    ]}
                  >
                    {positive ? (
                      <ArrowDownLeft size={17} color="#13845A" />
                    ) : (
                      <ArrowUpRight size={17} color={colors.danger} />
                    )}
                  </View>

                  <View style={styles.recentCopy}>
                    <Text style={styles.recentTitle}>
                      {item.type === 'bank_transfer'
                        ? item.direction === 'out'
                          ? 'Bank transfer out'
                          : 'Bank transfer in'
                        : String(item.type || 'Activity')
                            .replace(/_/g, ' ')
                            .replace(/^\w/, (letter: string) =>
                              letter.toUpperCase(),
                            )}
                    </Text>
                    <Text style={styles.recentSubtitle}>
                      {item.investmentName} · {item.date || 'Date not set'}
                    </Text>
                  </View>

                  <Text
                    style={[
                      styles.recentAmount,
                      {
                        color: positive ? colors.success : colors.danger,
                      },
                    ]}
                  >
                    {positive ? '+' : '−'}
                    {money(amount, currency)}
                  </Text>
                </View>
              );
            })
          ) : (
            <View style={styles.recentEmpty}>
              <Text style={styles.recentEmptyText}>
                No investment activity recorded yet.
              </Text>
            </View>
          )}
        </Card>

        <Text style={styles.footerNote}>
          Portfolio values are based on the values and updates you record.
          This is a tracking view, not a live brokerage feed.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 18 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  headerCopy: { flex: 1 },
  eyebrow: {
    color: colors.primary,
    fontSize: 9,
    letterSpacing: 1.5,
    fontWeight: '800',
    marginBottom: 5,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    letterSpacing: -0.7,
    fontWeight: '800',
  },
  subtitle: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  refreshButton: {
    width: 42,
    height: 42,
    borderRadius: 15,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    borderRadius: 25,
    padding: 21,
    overflow: 'hidden',
    marginBottom: 17,
    shadowColor: '#4035B8',
    shadowOffset: { width: 0, height: 9 },
    shadowOpacity: 0.18,
    shadowRadius: 15,
    elevation: 5,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  heroIcon: {
    width: 32,
    height: 32,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroLabel: {
    color: '#E0DDFF',
    fontWeight: '800',
    letterSpacing: 1,
    fontSize: 9,
    flex: 1,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.13)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 20,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#9BF2C4',
  },
  liveText: {
    color: '#F2F0FF',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  totalValue: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.8,
    marginTop: 18,
  },
  returnRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  returnText: { color: '#B7F7D1', fontSize: 11, fontWeight: '700' },
  heroDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginVertical: 19,
  },
  heroStats: { flexDirection: 'row', gap: 18 },
  heroStat: { flex: 1 },
  heroStatLabel: { color: '#D4D0FF', fontSize: 10, marginBottom: 5 },
  heroStatValue: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  statDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  heroGlow: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    right: -90,
    top: -85,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  quickActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 24,
    gap: 7,
  },
  quickAction: {
    flexGrow: 1,
    flexBasis: '30%',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 2,
    backgroundColor: colors.card,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 7,
  },
  actionLabel: {
    fontSize: 9,
    color: colors.text,
    fontWeight: '800',
    textAlign: 'center',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 11,
  },
  sectionTitle: { fontSize: 16, color: colors.text, fontWeight: '800' },
  sectionSubtitle: { fontSize: 10, color: colors.textSecondary, marginTop: 4 },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  seeAllText: { color: colors.primary, fontSize: 10, fontWeight: '800' },
  chartCard: { borderRadius: 20, padding: 12 },
  chartEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    paddingVertical: 22,
  },
  chartEmptyIcon: {
    width: 48,
    height: 48,
    borderRadius: 17,
    backgroundColor: '#EAE9FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 11,
  },
  chartEmptyTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  chartEmptyText: {
    color: colors.textSecondary,
    fontSize: 10,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 6,
  },
  chartCaption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    paddingTop: 4,
  },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  captionText: { color: colors.textSecondary, fontSize: 10 },
  captionHint: { color: colors.textLight, fontSize: 9, marginLeft: 'auto' },
  allocationList: { paddingHorizontal: 8, paddingTop: 4 },
  allocationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  allocationLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  allocationDot: { width: 9, height: 9, borderRadius: 5 },
  allocationLabel: { color: colors.text, fontWeight: '700', fontSize: 11 },
  allocationRight: { alignItems: 'flex-end', gap: 3 },
  allocationValue: { color: colors.text, fontWeight: '800', fontSize: 11 },
  allocationPercent: { color: colors.textSecondary, fontSize: 9 },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    padding: 18,
  },
  loadingText: { color: colors.textSecondary, fontSize: 11 },
  holdingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 13,
    marginBottom: 9,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 11,
  },
  holdingIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  holdingEmoji: { fontSize: 20 },
  holdingCopy: { flex: 1, minWidth: 0 },
  holdingName: { color: colors.text, fontSize: 12, fontWeight: '800' },
  holdingType: { color: colors.textSecondary, fontSize: 9, marginTop: 4 },
  holdingReturn: { fontSize: 9, fontWeight: '700', marginTop: 5 },
  holdingRight: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  holdingValue: { color: colors.text, fontSize: 11, fontWeight: '800' },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 21,
    padding: 24,
    borderColor: colors.border,
    borderWidth: 1,
    marginBottom: 18,
  },
  emptyIcon: {
    width: 53,
    height: 53,
    borderRadius: 18,
    backgroundColor: '#EAE9FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: { fontSize: 15, color: colors.text, fontWeight: '800' },
  emptyText: {
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 17,
    fontSize: 10,
    marginTop: 7,
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.primary,
    paddingHorizontal: 15,
    paddingVertical: 11,
    borderRadius: 13,
    marginTop: 16,
  },
  emptyButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 10 },
  recentCard: { overflow: 'hidden' },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 13,
    paddingVertical: 12,
    gap: 10,
  },
  recentBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  recentIcon: {
    width: 36,
    height: 36,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentCopy: { flex: 1, gap: 4 },
  recentTitle: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  recentSubtitle: { color: colors.textSecondary, fontSize: 9 },
  recentAmount: { fontSize: 10, fontWeight: '800' },
  recentEmpty: { padding: 17 },
  recentEmptyText: {
    color: colors.textSecondary,
    fontSize: 10,
    textAlign: 'center',
  },
  footerNote: {
    fontSize: 9,
    color: colors.textLight,
    lineHeight: 15,
    textAlign: 'center',
    paddingHorizontal: 18,
    marginTop: 18,
  },
});
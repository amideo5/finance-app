import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, Check, CircleCheck, Clock3, Info, ReceiptText, ShieldCheck, UsersRound } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { acceptRepayment, cancelRepayment, cancelSplit, getSplit, getSplitSettlements, rejectRepayment, requestRepayment } from '@/src/services/firebase/splitService';
import type { SharedExpenseSplit, SplitSettlement } from '@/types/finance';

const money = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
const paiseInput = (value: string) => /^\d+(?:\.\d{1,2})?$/.test(value.trim()) ? Math.round(Number(value) * 100) : 0;

export default function SplitDetail() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const splitId = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { currentProfile } = useProfile();
  const [split, setSplit] = useState<SharedExpenseSplit | null>(null);
  const [settlements, setSettlements] = useState<SplitSettlement[]>([]);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!splitId) return;
    setLoading(true);
    try {
      const [currentSplit, history] = await Promise.all([getSplit(splitId), getSplitSettlements(splitId)]);
      setSplit(currentSplit);
      setSettlements(history.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))));
    } catch (error) {
      console.error('Unable to load split details', error);
      Alert.alert('Unable to load', 'Could not load this split.');
    } finally {
      setLoading(false);
    }
  }, [splitId]);

  useEffect(() => {
    // Async Firestore refresh is applied after the effect returns.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const act = async (action: () => Promise<unknown>, successMessage: string, afterRefresh?: () => void | Promise<void>) => {
    setBusy(true);
    try {
      await action();
      await refresh();
      await afterRefresh?.();
      Alert.alert('Updated', successMessage);
    } catch (error) {
      Alert.alert('Unable to update', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return (
    <View style={styles.center}>
      <View style={styles.loadingIcon}><ReceiptText color={colors.primary} size={26} /></View>
      <ActivityIndicator color={colors.primary} size="small" />
      <Text style={styles.loadingText}>Loading shared expense…</Text>
    </View>
  );

  if (!split || !currentProfile) return (
    <View style={styles.center}>
      <View style={styles.loadingIcon}><Info color={colors.primary} size={26} /></View>
      <Text style={styles.emptyTitle}>Split unavailable</Text>
      <Text style={styles.emptySubtitle}>This shared expense could not be found.</Text>
      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}><ArrowLeft color={colors.text} size={17} /><Text style={styles.backText}>Go back</Text></TouchableOpacity>
    </View>
  );
  const userId = currentProfile.userId;
  const isCreditor = userId === split.paidByUserId;
  const myObligations = split.obligations.filter((obligation) => obligation.fromUserId === userId);
  const outstanding = myObligations.reduce((sum, obligation) => sum + obligation.amountInPaise - obligation.acceptedAmountInPaise, 0);
  const pendingForMe = settlements.filter((item) => item.status === 'pending' && item.toUserId === userId);
  const ownPending = settlements.filter((item) => item.status === 'pending' && item.fromUserId === userId);
  const statusLabel = String(split.status || 'active').replace(/_/g, ' ');
  const completed = split.finalizationStatus === 'complete';
  const cancelled = split.status === 'cancelled';

  const submitAcknowledgment = () => {
    const amountInPaise = paiseInput(amount);
    if (amountInPaise <= 0) {
      Alert.alert('Invalid amount', 'Enter a positive amount in rupees.');
      return;
    }
    const storageKey = `split-repayment:${split.id}:${userId}`;
    void act(async () => {
      const storedValue = await AsyncStorage.getItem(storageKey);
      let idempotencyKey: string;
      if (storedValue) {
        const stored = JSON.parse(storedValue) as { key: string; amountInPaise: number };
        if (stored.amountInPaise !== amountInPaise) throw new Error('Retry the previous repayment amount first; its result may still be pending.');
        idempotencyKey = stored.key;
      } else {
        idempotencyKey = `${userId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await AsyncStorage.setItem(storageKey, JSON.stringify({ key: idempotencyKey, amountInPaise }));
      }
      await requestRepayment({ splitId: split.id, amountInPaise, senderProfileId: currentProfile.id, idempotencyKey });
    }, 'Repayment acknowledgment sent to the creditor.', async () => {
      await AsyncStorage.removeItem(storageKey);
      setAmount('');
    });
  };

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.container} contentContainerStyle={[styles.pageContent, { paddingTop: Math.max(insets.top + 8, 20), paddingBottom: Math.max(insets.bottom, 20) + 28 }]}>
        <TouchableOpacity accessibilityRole="button" style={styles.backButton} onPress={() => router.back()}>
          <ArrowLeft color={colors.text} size={18} /><Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <View style={styles.pageIntro}>
          <View style={styles.eyebrow}><UsersRound size={14} color={colors.primary} /><Text style={styles.eyebrowText}>SHARED EXPENSE</Text></View>
          <Text style={styles.title}>{split.title}</Text>
          {split.description ? <Text style={styles.subtitle}>{split.description}</Text> : <Text style={styles.subtitle}>Review the original payment, everyone’s share and the current split status.</Text>}
        </View>

        <LinearGradient colors={cancelled ? ['#4A3546', '#885367'] : completed ? ['#105C48', '#17A673', '#39B88E'] : ['#29265E', '#5146D8', '#756BFF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroIcon}><ReceiptText size={21} color="#FFFFFF" /></View>
            <View style={[styles.statusPill, cancelled && styles.statusPillCancelled, completed && styles.statusPillCompleted]}>
              {completed ? <Check size={13} color="#D5FFEC" /> : cancelled ? <Info size={13} color="#FFE4E9" /> : <Clock3 size={13} color="#F9E7AF" />}
              <Text style={styles.statusText}>{statusLabel}</Text>
            </View>
          </View>
          <Text style={styles.heroLabel}>ORIGINAL EXPENSE</Text>
          <Text style={styles.amount}>{money(split.totalAmountInPaise)}</Text>
          <Text style={styles.heroSub}>Paid by {split.createdBy === userId ? 'you' : 'the original payer'} · {split.sourceDate}</Text>
          <View style={styles.heroDivider} />
          <View style={styles.heroBottomRow}>
            <View style={styles.heroMetaItem}><UsersRound size={15} color="#E3E1FF" /><Text style={styles.heroMetaText}>{split.participants.length} participant{split.participants.length === 1 ? '' : 's'}</Text></View>
            <View style={styles.heroMetaItem}><ShieldCheck size={15} color="#E3E1FF" /><Text style={styles.heroMetaText}>{completed ? 'Allocations finalized' : cancelled ? 'Split cancelled' : 'Shared allocation'}</Text></View>
          </View>
        </LinearGradient>

        {isCreditor && split.status !== 'cancelled' && split.finalizationStatus !== 'complete' && (
          <TouchableOpacity disabled={busy} activeOpacity={0.82} style={[styles.cancelCard, busy && styles.disabled]} onPress={() => Alert.alert(
            'Cancel shared expense?',
            'This is only allowed before any repayment is accepted or allocations are finalized.',
            [
              { text: 'Keep split', style: 'cancel' },
              { text: 'Cancel split', style: 'destructive', onPress: () => void act(() => cancelSplit(split.id), 'Split cancelled and its source expense released.') },
            ],
          )}>
            <View style={styles.cancelIcon}><Info size={17} color={colors.expense} /></View>
            <View style={styles.cancelCopy}><Text style={styles.cancelTitle}>Cancel shared expense</Text><Text style={styles.cancelSubtitle}>Available before repayment or finalization</Text></View>
            <Text style={styles.cancelChevron}>›</Text>
          </TouchableOpacity>
        )}

        <View style={styles.sectionHeader}>
          <View style={styles.sectionIcon}><UsersRound size={18} color={colors.primary} /></View>
          <View style={styles.sectionHeaderCopy}><Text style={styles.heading}>Participant allocation</Text><Text style={styles.sectionCaption}>How the original expense is divided</Text></View>
          <View style={styles.countPill}><Text style={styles.countPillText}>{split.participants.length}</Text></View>
        </View>
        <View style={styles.participantCard}>
          {split.participants.map((participant, index) => {
            const obligation = split.obligations.find((item) => item.fromUserId === participant.userId && item.toUserId === split.paidByUserId);
            const name = participant.displayName || (participant.userId === split.paidByUserId ? 'Payer' : participant.userId);
            const isPayer = participant.userId === split.paidByUserId;
            return (
              <View key={participant.userId} style={[styles.participantRow, index === split.participants.length - 1 && styles.participantRowLast]}>
                <View style={[styles.avatar, isPayer && styles.payerAvatar]}><Text style={[styles.avatarText, isPayer && styles.payerAvatarText]}>{String(name).trim().charAt(0).toUpperCase()}</Text></View>
                <View style={styles.personCopy}>
                  <Text style={styles.person} numberOfLines={1}>{name}{participant.userId === userId ? ' (you)' : ''}</Text>
                  <Text style={styles.personMeta}>{isPayer ? 'Original payer' : 'Participant'}{obligation ? ` · outstanding ${money(obligation.amountInPaise - obligation.acceptedAmountInPaise)}` : ''}</Text>
                </View>
                <View style={styles.shareValueWrap}><Text style={styles.shareValue}>{money(participant.shareAmountInPaise)}</Text><Text style={styles.shareCaption}>SHARE</Text></View>
              </View>
            );
          })}
        </View>

        {!split.participants.some((participant) => participant.userId === split.paidByUserId) && (
          <View style={styles.notice}><Info size={17} color={colors.info} /><Text style={styles.noticeText}>The payer is excluded from allocation and has zero consumption share.</Text></View>
        )}

        {myObligations.length > 0 && (
          <LinearGradient colors={['#F2F1FF', '#FAFAFF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.outstandingCard}>
            <View style={styles.outstandingTop}><View style={styles.outstandingIcon}><WalletIconFallback /></View><Text style={styles.outstandingLabel}>YOUR OUTSTANDING SHARE</Text></View>
            <Text style={styles.outstandingAmount}>{money(outstanding)}</Text>
            <Text style={styles.outstandingNote}>Amount remaining across your obligations in this shared expense.</Text>
          </LinearGradient>
        )}

        {completed && (
          <View style={styles.completeCard}>
            <View style={styles.completeIcon}><CircleCheck size={19} color={colors.income} /></View>
            <View style={styles.completeCopy}><Text style={styles.completeTitle}>Allocations finalized</Text><Text style={styles.completeSubtitle}>Final participant expense allocations have been recorded.</Text></View>
          </View>
        )}

        {busy ? <View style={styles.busyNotice}><ActivityIndicator size="small" color={colors.primary} /><Text style={styles.busyText}>Updating shared expense…</Text></View> : null}
      </ScrollView>
    </View>
  );
}

function WalletIconFallback() {
  return <ReceiptText size={17} color={colors.primary} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  pageContent: { paddingHorizontal: 20, paddingBottom: 28, gap: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: 28, gap: 12 },
  loadingIcon: { width: 60, height: 60, borderRadius: 20, backgroundColor: '#ECEBFF', alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  loadingText: { color: colors.textSecondary, fontSize: 14, fontWeight: '500' },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
  emptySubtitle: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19, marginBottom: 4 },
  backButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  backText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  pageIntro: { gap: 6, marginBottom: 3 },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  eyebrowText: { color: colors.primary, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.text, fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: -0.7 },
  subtitle: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, marginTop: 1 },
  hero: { borderRadius: 23, padding: 20, overflow: 'hidden', marginTop: 2, marginBottom: 3 },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroIcon: { width: 43, height: 43, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 18, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: 'rgba(255,255,255,0.15)', maxWidth: '70%' },
  statusPillCancelled: { backgroundColor: 'rgba(255,225,232,0.16)' },
  statusPillCompleted: { backgroundColor: 'rgba(222,255,239,0.17)' },
  statusText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800', textTransform: 'capitalize' },
  heroLabel: { color: '#D8D5FF', fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginTop: 19 },
  amount: { color: '#FFFFFF', fontSize: 36, fontWeight: '800', letterSpacing: -0.8, marginTop: 5 },
  heroSub: { color: '#E6E4FF', marginTop: 5, fontSize: 12, lineHeight: 18 },
  heroDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 17 },
  heroBottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  heroMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroMetaText: { color: '#E5E3FF', fontSize: 11, fontWeight: '600' },
  cancelCard: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderRadius: 16, backgroundColor: '#FFF5F5', borderColor: '#F7D8DC', borderWidth: 1 },
  cancelIcon: { width: 37, height: 37, borderRadius: 12, backgroundColor: '#FFE6E8', alignItems: 'center', justifyContent: 'center' },
  cancelCopy: { flex: 1, gap: 3 },
  cancelTitle: { color: colors.expense, fontSize: 13, fontWeight: '800' },
  cancelSubtitle: { color: '#9D6670', fontSize: 11, lineHeight: 15 },
  cancelChevron: { color: colors.expense, fontSize: 24, fontWeight: '500' },
  disabled: { opacity: 0.5 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  sectionIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#ECEBFF', alignItems: 'center', justifyContent: 'center' },
  sectionHeaderCopy: { flex: 1, gap: 2 },
  heading: { color: colors.text, fontWeight: '800', fontSize: 17 },
  sectionCaption: { color: colors.textSecondary, fontSize: 12, lineHeight: 16 },
  countPill: { minWidth: 28, height: 28, paddingHorizontal: 7, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0EFFF' },
  countPillText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  participantCard: { backgroundColor: colors.card, borderRadius: 20, borderWidth: 1, borderColor: '#ECECF5', paddingHorizontal: 14, paddingVertical: 3, shadowColor: '#20224A', shadowOpacity: 0.035, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 1 },
  participantRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#EFF0F6' },
  participantRowLast: { borderBottomWidth: 0 },
  avatar: { width: 42, height: 42, borderRadius: 15, backgroundColor: '#EFF1F9', alignItems: 'center', justifyContent: 'center' },
  payerAvatar: { backgroundColor: '#E8E6FF' },
  avatarText: { color: '#5D6281', fontSize: 15, fontWeight: '800' },
  payerAvatarText: { color: colors.primary },
  personCopy: { flex: 1, gap: 3 },
  person: { color: colors.text, fontSize: 13, fontWeight: '800' },
  personMeta: { color: colors.textSecondary, fontSize: 11, lineHeight: 16 },
  shareValueWrap: { alignItems: 'flex-end', gap: 3 },
  shareValue: { color: colors.text, fontSize: 14, fontWeight: '800' },
  shareCaption: { color: colors.textLight, fontSize: 9, fontWeight: '800', letterSpacing: 0.7 },
  notice: { backgroundColor: '#EFF6FF', borderRadius: 14, padding: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 9, borderWidth: 1, borderColor: '#D8E8FC' },
  noticeText: { color: '#45617D', fontSize: 12, lineHeight: 18, flex: 1 },
  outstandingCard: { padding: 17, borderRadius: 19, borderWidth: 1, borderColor: '#E0DFFF', gap: 7 },
  outstandingTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  outstandingIcon: { width: 29, height: 29, borderRadius: 10, backgroundColor: '#E5E3FF', alignItems: 'center', justifyContent: 'center' },
  outstandingLabel: { color: colors.primary, fontSize: 10, fontWeight: '800', letterSpacing: 0.9 },
  outstandingAmount: { color: colors.text, fontSize: 29, fontWeight: '800', letterSpacing: -0.4, marginTop: 2 },
  outstandingNote: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  completeCard: { flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#CDEEDF', backgroundColor: '#F2FBF7' },
  completeIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#DDF7EA', alignItems: 'center', justifyContent: 'center' },
  completeCopy: { flex: 1, gap: 3 },
  completeTitle: { color: '#16875B', fontSize: 13, fontWeight: '800' },
  completeSubtitle: { color: '#527A69', fontSize: 11, lineHeight: 16 },
  busyNotice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12 },
  busyText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
});

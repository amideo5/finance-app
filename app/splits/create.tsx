import { useLocalSearchParams, useRouter } from 'expo-router';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, Check, ChevronRight, Info, ReceiptText, Sparkles, UsersRound, WalletCards } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { db } from '@/src/firebaseConfig';
import { getUserFriends } from '@/src/services/firebase/friendsService';
import { createSplit } from '@/src/services/firebase/splitService';
import { allocateEqualShares, validateCustomShares } from '@/src/utils/splitUtils';
import type { SplitParticipant } from '@/types/finance';

interface SourceExpense {
  id: string;
  amount: number;
  currency?: string;
  type: string;
  date: string;
  category?: string;
  notes?: string | null;
  kind?: string;
}

function rupeesToPaise(value: string, allowZero = false): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const paise = Math.round(Number(value) * 100);
  return Number.isSafeInteger(paise) && (allowZero ? paise >= 0 : paise > 0) ? paise : null;
}

const money = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

export default function CreateSplit() {
  const params = useLocalSearchParams<{ txId?: string | string[] }>();
  const routeTransactionId = Array.isArray(params.txId) ? params.txId[0] : params.txId;
  const { currentProfile } = useProfile();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = currentProfile?.userId;

  const [selectedTransactionId, setSelectedTransactionId] = useState(routeTransactionId || '');
  const [source, setSource] = useState<SourceExpense | null>(null);
  const [eligibleExpenses, setEligibleExpenses] = useState<SourceExpense[]>([]);
  const [friends, setFriends] = useState<any[]>([]);
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [includeCreator, setIncludeCreator] = useState(true);
  const [splitType, setSplitType] = useState<'equal' | 'custom'>('equal');
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!currentProfile) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        setSource(null);
        const friendRowsPromise = getUserFriends(currentProfile.userId);
        const transactionRowsPromise = selectedTransactionId
          ? getDoc(doc(db, 'profiles', currentProfile.id, 'transactions', selectedTransactionId)).then((snapshot) => snapshot.exists()
            ? [{ id: snapshot.id, ...snapshot.data() }]
            : [])
          : getDocs(collection(db, 'profiles', currentProfile.id, 'transactions')).then((snapshot) => snapshot.docs.map((transactionDoc) => ({
            id: transactionDoc.id,
            ...transactionDoc.data(),
          })));
        const [transactionRows, friendRows] = await Promise.all([transactionRowsPromise, friendRowsPromise]);
        if (!mounted) return;
        const eligible = transactionRows
          .filter((transaction: any) => transaction.type === 'expense' && !transaction.kind && transaction.currency === 'INR')
          .sort((a: any, b: any) => String(b.date || '').localeCompare(String(a.date || '')))
          .map((transaction: any) => ({ id: transaction.id, ...transaction } as SourceExpense));
        setEligibleExpenses(eligible);
        if (selectedTransactionId && eligible.length > 0) {
          setSource(eligible[0]);
          setTitle(eligible[0].category ? `${eligible[0].category} split` : 'Shared expense');
        }
        setFriends(friendRows);
      } catch (error) {
        console.error('Unable to load split source/friends', error);
        Alert.alert('Unable to load', 'Could not load the expense or your accepted friends.');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    return () => { mounted = false; };
  }, [currentProfile, selectedTransactionId]);

  const totalAmountInPaise = source ? Math.round(Number(source.amount) * 100) : 0;
  const participantIds = useMemo(() => [
    ...(includeCreator && userId ? [userId] : []),
    ...selectedFriends,
  ], [includeCreator, selectedFriends, userId]);

  const friendNames = useMemo(() => new Map<string, string>(friends.map((friend) => [
    friend.friendId,
    friend.profileData?.name || friend.friendId,
  ])), [friends]);

  const toggleFriend = (id: string) => {
    setSelectedFriends((previous) => previous.includes(id)
      ? previous.filter((friendId) => friendId !== id)
      : [...previous, id]);
  };

  const allocations: SplitParticipant[] = useMemo(() => {
    if (!source || participantIds.length === 0 || totalAmountInPaise <= 0) return [];
    try {
      if (splitType === 'equal') return allocateEqualShares(totalAmountInPaise, participantIds);
      return participantIds.map((participantId) => ({
        userId: participantId,
        shareAmountInPaise: rupeesToPaise(customAmounts[participantId] ?? '', true) ?? 0,
      }));
    } catch {
      return [];
    }
  }, [customAmounts, participantIds, source, splitType, totalAmountInPaise]);

  const allocationTotal = allocations.reduce((sum, participant) => sum + participant.shareAmountInPaise, 0);
  const allocationValid = Boolean(source && allocations.length > 0 && allocationTotal === totalAmountInPaise
    && allocations.every((item) => Number.isSafeInteger(item.shareAmountInPaise))
    && (splitType === 'equal' || participantIds.every((id) => rupeesToPaise(customAmounts[id] ?? '', true) !== null)));

  const handleCreate = async () => {
    if (!currentProfile || !source || !userId || !selectedTransactionId) {
      Alert.alert('Expense required', 'Choose a valid expense from your active profile.');
      return;
    }
    if (participantIds.length === 0) {
      Alert.alert('Participants required', 'Include yourself or select at least one friend.');
      return;
    }
    if (!title.trim()) {
      Alert.alert('Title required', 'Enter a title for this shared expense.');
      return;
    }
    try {
      if (splitType === 'custom') validateCustomShares(totalAmountInPaise, allocations);
      else if (allocationTotal !== totalAmountInPaise) throw new Error('Shares do not add up to the source expense.');
      setSaving(true);
      await createSplit({
        sourceProfileId: currentProfile.id,
        sourceTransactionId: selectedTransactionId,
        title: title.trim(),
        description: description.trim() || undefined,
        type: splitType,
        participants: allocations.map((participant) => ({
          ...participant,
          displayName: participant.userId === userId ? currentProfile.name : friendNames.get(participant.userId),
        })),
      });
      Alert.alert('Split created', 'The expense is linked and your friends can now acknowledge repayment.');
      router.back();
    } catch (error) {
      console.error('Unable to create shared expense', error);
      Alert.alert('Could not create split', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <View style={styles.center}>
      <View style={styles.loadingIcon}><UsersRound color={colors.primary} size={26} /></View>
      <ActivityIndicator color={colors.primary} size="small" />
      <Text style={styles.loadingText}>Preparing your shared expense…</Text>
    </View>
  );

  if (!source) return (
    <View style={styles.screen}>
      <ScrollView style={styles.container} contentContainerStyle={[styles.pageContent, { paddingTop: Math.max(insets.top + 8, 20), paddingBottom: Math.max(insets.bottom, 20) + 28 }]}>
        <TouchableOpacity accessibilityRole="button" style={styles.backButton} onPress={() => router.back()}>
          <ArrowLeft color={colors.text} size={18} />
          <Text style={styles.backLabel}>Back</Text>
        </TouchableOpacity>

        <View style={styles.pageIntro}>
          <View style={styles.eyebrow}><UsersRound size={14} color={colors.primary} /><Text style={styles.eyebrowText}>SHARED EXPENSES</Text></View>
          <Text style={styles.title}>{selectedTransactionId ? 'Expense unavailable' : 'Choose an expense'}</Text>
          <Text style={styles.subtitle}>Pick an existing expense to create a split with your friends. Your original transaction will stay unchanged.</Text>
        </View>

        {selectedTransactionId ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}><ReceiptText size={26} color={colors.primary} /></View>
            <Text style={styles.emptyTitle}>This expense can’t be used</Text>
            <Text style={styles.help}>Choose a different eligible INR expense from your active profile. The original transaction will not be changed.</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={() => setSelectedTransactionId('')}>
              <Text style={styles.primaryButtonText}>Choose another expense</Text><ChevronRight color="#FFFFFF" size={18} />
            </TouchableOpacity>
          </View>
        ) : eligibleExpenses.length > 0 ? (
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIcon}><WalletCards size={18} color={colors.primary} /></View>
              <View style={styles.sectionHeaderCopy}>
                <Text style={styles.sectionTitle}>Eligible expenses</Text>
                <Text style={styles.sectionCaption}>{eligibleExpenses.length} expense{eligibleExpenses.length === 1 ? '' : 's'} available to split</Text>
              </View>
            </View>
            {eligibleExpenses.map((expense) => (
              <TouchableOpacity key={expense.id} activeOpacity={0.82} style={styles.expenseOption} onPress={() => setSelectedTransactionId(expense.id)}>
                <View style={styles.expenseIcon}><ReceiptText size={19} color={colors.primary} /></View>
                <View style={styles.expenseOptionBody}>
                  <Text style={styles.choiceTitle} numberOfLines={1}>{expense.category || 'Expense'}</Text>
                  <Text style={styles.help}>{expense.date || 'Date unavailable'}{expense.notes ? ` · ${expense.notes}` : ''}</Text>
                </View>
                <View style={styles.expenseOptionTrailing}>
                  <Text style={styles.shareAmount}>₹{Number(expense.amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                  <ChevronRight size={17} color={colors.textLight} />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}><ReceiptText size={26} color={colors.primary} /></View>
            <Text style={styles.emptyTitle}>No eligible expenses yet</Text>
            <Text style={styles.help}>Only existing INR expenses can be selected for a shared expense.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.pageContent, { paddingTop: Math.max(insets.top + 8, 20), paddingBottom: 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity accessibilityRole="button" style={styles.backButton} onPress={() => router.back()}>
          <ArrowLeft color={colors.text} size={18} />
          <Text style={styles.backLabel}>Back</Text>
        </TouchableOpacity>

        <View style={styles.pageIntro}>
          <View style={styles.eyebrow}><Sparkles size={14} color={colors.primary} /><Text style={styles.eyebrowText}>SHARED EXPENSES</Text></View>
          <Text style={styles.title}>Create a split</Text>
          <Text style={styles.subtitle}>Share a payment with friends and make sure every contribution adds up.</Text>
        </View>

        <LinearGradient colors={['#29265E', '#5146D8', '#756BFF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.expenseHero}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroIcon}><ReceiptText size={20} color="#FFFFFF" /></View>
            <View style={styles.heroLinkedBadge}><Check size={12} color="#C7F9E5" /><Text style={styles.heroLinkedText}>LINKED EXPENSE</Text></View>
          </View>
          <Text style={styles.heroAmount}>{money(totalAmountInPaise)}</Text>
          <Text style={styles.heroCategory}>{source.category || 'Expense'} <Text style={styles.heroDot}>·</Text> {source.date || 'Date unavailable'}</Text>
          <View style={styles.heroDivider} />
          <View style={styles.heroFooter}>
            <View style={styles.heroInfoIcon}><Info size={14} color="#E2E0FF" /></View>
            <Text style={styles.heroFootnote}>Original payment by {currentProfile?.name || 'you'}. This transaction won’t be duplicated or changed.</Text>
          </View>
        </LinearGradient>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.stepBadge}><Text style={styles.stepText}>01</Text></View>
            <View style={styles.sectionHeaderCopy}>
              <Text style={styles.sectionTitle}>Split details</Text>
              <Text style={styles.sectionCaption}>Give this shared expense a name</Text>
            </View>
          </View>
          <Text style={styles.fieldLabel}>TITLE</Text>
          <TextInput value={title} onChangeText={setTitle} style={styles.input} placeholder="Dinner, trip, groceries…" placeholderTextColor={colors.textLight} returnKeyType="next" />
          <Text style={styles.fieldLabel}>DESCRIPTION <Text style={styles.optionalLabel}>OPTIONAL</Text></Text>
          <TextInput value={description} onChangeText={setDescription} style={[styles.input, styles.multiline]} multiline placeholder="Add context for your friends" placeholderTextColor={colors.textLight} />
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.stepBadge}><Text style={styles.stepText}>02</Text></View>
            <View style={styles.sectionHeaderCopy}>
              <Text style={styles.sectionTitle}>Who’s sharing?</Text>
              <Text style={styles.sectionCaption}>Choose everyone whose share is included</Text>
            </View>
            <View style={styles.countPill}><Text style={styles.countPillText}>{participantIds.length}</Text></View>
          </View>

          <TouchableOpacity activeOpacity={0.82} style={[styles.personOption, includeCreator && styles.personOptionSelected]} onPress={() => setIncludeCreator((value) => !value)}>
            <View style={[styles.avatar, styles.youAvatar]}><Text style={styles.youAvatarText}>{(currentProfile?.name || 'Y').trim().charAt(0).toUpperCase()}</Text></View>
            <View style={styles.personOptionBody}>
              <Text style={styles.choiceTitle}>{currentProfile?.name || 'You'} <Text style={styles.youTag}>YOU</Text></Text>
              <Text style={styles.help}>{includeCreator ? 'Your share is included in the allocation' : 'Your share is excluded; friends cover the full amount'}</Text>
            </View>
            <View style={[styles.selectionMark, includeCreator && styles.selectionMarkActive]}>{includeCreator ? <Check color="#FFFFFF" size={14} /> : null}</View>
          </TouchableOpacity>

          {friends.map((friend) => {
            const active = selectedFriends.includes(friend.friendId);
            const name = friend.profileData?.name || friend.friendId;
            return (
              <TouchableOpacity key={friend.friendId} activeOpacity={0.82} style={[styles.personOption, active && styles.personOptionSelected]} onPress={() => toggleFriend(friend.friendId)}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{String(name).trim().charAt(0).toUpperCase()}</Text></View>
                <View style={styles.personOptionBody}>
                  <Text style={styles.choiceTitle} numberOfLines={1}>{name}</Text>
                  <Text style={styles.help}>{active ? 'Included in this split' : 'Tap to add to this split'}</Text>
                </View>
                <View style={[styles.selectionMark, active && styles.selectionMarkActive]}>{active ? <Check color="#FFFFFF" size={14} /> : null}</View>
              </TouchableOpacity>
            );
          })}
          {friends.length === 0 && <View style={styles.inlineNotice}><Info color={colors.textSecondary} size={16} /><Text style={styles.inlineNoticeText}>No accepted friends yet. You can still review your own allocation.</Text></View>}
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View style={styles.stepBadge}><Text style={styles.stepText}>03</Text></View>
            <View style={styles.sectionHeaderCopy}>
              <Text style={styles.sectionTitle}>Choose a share method</Text>
              <Text style={styles.sectionCaption}>Decide how the total should be divided</Text>
            </View>
          </View>
          <View style={styles.methodRow}>
            <TouchableOpacity activeOpacity={0.85} style={[styles.methodCard, splitType === 'equal' && styles.methodCardSelected]} onPress={() => setSplitType('equal')}>
              <View style={[styles.methodIcon, splitType === 'equal' && styles.methodIconSelected]}><UsersRound size={19} color={splitType === 'equal' ? '#FFFFFF' : colors.primary} /></View>
              <Text style={[styles.methodTitle, splitType === 'equal' && styles.methodTitleSelected]}>Equal split</Text>
              <Text style={[styles.methodCaption, splitType === 'equal' && styles.methodCaptionSelected]}>Divide evenly</Text>
              {splitType === 'equal' ? <View style={styles.methodCheck}><Check size={12} color="#FFFFFF" /></View> : null}
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.85} style={[styles.methodCard, splitType === 'custom' && styles.methodCardSelected]} onPress={() => setSplitType('custom')}>
              <View style={[styles.methodIcon, splitType === 'custom' && styles.methodIconSelected]}><WalletCards size={19} color={splitType === 'custom' ? '#FFFFFF' : colors.primary} /></View>
              <Text style={[styles.methodTitle, splitType === 'custom' && styles.methodTitleSelected]}>Custom shares</Text>
              <Text style={[styles.methodCaption, splitType === 'custom' && styles.methodCaptionSelected]}>Set each amount</Text>
              {splitType === 'custom' ? <View style={styles.methodCheck}><Check size={12} color="#FFFFFF" /></View> : null}
            </TouchableOpacity>
          </View>

          {allocations.length > 0 ? (
            <View style={styles.allocationList}>
              <View style={styles.allocationListHeader}><Text style={styles.fieldLabel}>PARTICIPANT</Text><Text style={styles.fieldLabel}>SHARE</Text></View>
              {allocations.map((participant) => {
                const name = participant.userId === userId ? currentProfile?.name || 'You' : friendNames.get(participant.userId) || participant.userId;
                return (
                  <View key={participant.userId} style={styles.shareRow}>
                    <View style={styles.sharePerson}>
                      <View style={[styles.avatar, participant.userId === userId && styles.youAvatar]}><Text style={[styles.avatarText, participant.userId === userId && styles.youAvatarText]}>{String(name).trim().charAt(0).toUpperCase()}</Text></View>
                      <View style={styles.sharePersonCopy}><Text style={styles.sharePersonName} numberOfLines={1}>{name}</Text><Text style={styles.sharePersonRole}>{participant.userId === userId ? 'Original payer' : 'Participant'}</Text></View>
                    </View>
                    {splitType === 'custom' ? (
                      <View style={styles.customAmountWrap}>
                        <Text style={styles.currencyPrefix}>₹</Text>
                        <TextInput
                          value={customAmounts[participant.userId] ?? ''}
                          onChangeText={(value) => setCustomAmounts((previous) => ({ ...previous, [participant.userId]: value }))}
                          placeholder="0.00"
                          placeholderTextColor={colors.textLight}
                          keyboardType="decimal-pad"
                          accessibilityLabel={`Share amount for ${name}`}
                          style={[styles.amountInput, customAmounts[participant.userId] !== undefined && rupeesToPaise(customAmounts[participant.userId], true) === null && styles.invalidInput]}
                        />
                      </View>
                    ) : <Text style={styles.shareAmount}>{money(participant.shareAmountInPaise)}</Text>}
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={styles.emptyAllocation}><Text style={styles.help}>Select yourself or at least one friend to see the allocation.</Text></View>
          )}
        </View>

        <View style={[styles.reviewCard, allocationValid ? styles.reviewValid : styles.reviewWarning]}>
          <View style={styles.reviewHeader}>
            <View style={[styles.reviewStatusIcon, allocationValid ? styles.reviewStatusIconValid : styles.reviewStatusIconWarning]}>{allocationValid ? <Check color="#FFFFFF" size={15} /> : <Info color="#FFFFFF" size={15} />}</View>
            <View style={styles.reviewHeaderCopy}>
              <Text style={styles.reviewTitle}>{allocationValid ? 'Everything adds up' : 'Allocation needs attention'}</Text>
              <Text style={styles.reviewCaption}>{allocationValid ? 'Your shares match the original expense exactly.' : 'Adjust participants or amounts so the allocation matches the expense.'}</Text>
            </View>
          </View>
          <View style={styles.reviewMetrics}>
            <View style={styles.reviewMetric}><Text style={styles.reviewMetricLabel}>EXPENSE TOTAL</Text><Text style={styles.reviewMetricValue}>{money(totalAmountInPaise)}</Text></View>
            <View style={styles.reviewMetricDivider} />
            <View style={styles.reviewMetric}><Text style={styles.reviewMetricLabel}>ALLOCATED</Text><Text style={styles.reviewMetricValue}>{money(allocationTotal)}</Text></View>
          </View>
          <Text style={[styles.reviewLine, allocationValid ? styles.valid : styles.invalid]}>{allocationValid ? '✓ Shares reconcile exactly' : 'Shares must equal the linked expense total'}</Text>
        </View>
      </ScrollView>

      <View style={[styles.stickyFooter, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.footerSummary}><Text style={styles.footerSummaryLabel}>{participantIds.length} participant{participantIds.length === 1 ? '' : 's'}</Text><Text style={styles.footerSummaryAmount}>{money(totalAmountInPaise)}</Text></View>
        <TouchableOpacity accessibilityRole="button" disabled={!allocationValid || saving} style={[styles.primaryButton, styles.footerButton, (!allocationValid || saving) && styles.buttonDisabled]} onPress={() => void handleCreate()}>
          <Text style={styles.primaryButtonText}>{saving ? 'Creating split…' : 'Create split'}</Text>
          {!saving ? <ChevronRight color="#FFFFFF" size={19} /> : <ActivityIndicator color="#FFFFFF" size="small" />}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  pageContent: { paddingHorizontal: 20, paddingBottom: 28, gap: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 13, backgroundColor: colors.background, padding: 24 },
  loadingIcon: { width: 58, height: 58, borderRadius: 20, backgroundColor: '#ECEBFF', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  loadingText: { color: colors.textSecondary, fontSize: 14, fontWeight: '500' },
  backButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, marginBottom: 2 },
  backLabel: { color: colors.text, fontSize: 14, fontWeight: '600' },
  pageIntro: { gap: 6, marginBottom: 3 },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  eyebrowText: { color: colors.primary, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: colors.text, fontSize: 29, lineHeight: 35, fontWeight: '800', letterSpacing: -0.8 },
  subtitle: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, marginTop: 1 },
  expenseHero: { borderRadius: 23, padding: 20, marginTop: 2, marginBottom: 2, overflow: 'hidden' },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  heroLinkedBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: 'rgba(255,255,255,0.13)' },
  heroLinkedText: { color: '#F1F0FF', fontWeight: '800', letterSpacing: 0.9, fontSize: 9 },
  heroAmount: { color: '#FFFFFF', fontSize: 35, fontWeight: '800', letterSpacing: -0.7, marginTop: 18 },
  heroCategory: { color: '#E2E0FF', marginTop: 4, fontSize: 13, fontWeight: '500' },
  heroDot: { color: '#B8B3FF' },
  heroDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 17 },
  heroFooter: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  heroInfoIcon: { marginTop: 1 },
  heroFootnote: { color: '#E4E2FF', fontSize: 12, lineHeight: 18, flex: 1 },
  sectionCard: { backgroundColor: colors.card, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: '#ECECF5', gap: 10, shadowColor: '#20224A', shadowOpacity: 0.035, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 1 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 5 },
  sectionHeaderCopy: { flex: 1, gap: 2 },
  sectionIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: '#F0EFFF', alignItems: 'center', justifyContent: 'center' },
  stepBadge: { width: 34, height: 34, borderRadius: 12, backgroundColor: '#F0EFFF', alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 12, color: colors.primary, fontWeight: '800' },
  sectionTitle: { color: colors.text, fontSize: 16, lineHeight: 20, fontWeight: '800' },
  sectionCaption: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  fieldLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '800', letterSpacing: 1, marginTop: 5 },
  optionalLabel: { color: colors.textLight, fontWeight: '700', letterSpacing: 0.5 },
  input: { backgroundColor: '#FAFAFE', borderWidth: 1, borderColor: colors.border, borderRadius: 13, paddingHorizontal: 13, paddingVertical: 12, minHeight: 47, color: colors.text, fontSize: 14 },
  multiline: { minHeight: 86, textAlignVertical: 'top' },
  countPill: { minWidth: 28, height: 28, paddingHorizontal: 7, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0EFFF' },
  countPillText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  personOption: { borderWidth: 1, borderColor: colors.border, borderRadius: 15, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: '#FFFFFF' },
  personOptionSelected: { borderColor: '#B9B4FF', backgroundColor: '#F8F7FF' },
  avatar: { width: 42, height: 42, borderRadius: 15, backgroundColor: '#EFF1F9', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#5D6281', fontSize: 15, fontWeight: '800' },
  youAvatar: { backgroundColor: '#E7E5FF' },
  youAvatarText: { color: colors.primary },
  personOptionBody: { flex: 1, gap: 3 },
  choiceTitle: { color: colors.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  youTag: { color: colors.primary, fontSize: 9, letterSpacing: 0.7 },
  help: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 1 },
  selectionMark: { width: 23, height: 23, borderRadius: 8, borderWidth: 1.5, borderColor: '#D4D7E5', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  selectionMarkActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  inlineNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 12, borderRadius: 13, backgroundColor: '#F7F7FB' },
  inlineNoticeText: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, flex: 1 },
  methodRow: { flexDirection: 'row', gap: 10 },
  methodCard: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 12, gap: 5, backgroundColor: '#FFFFFF', position: 'relative' },
  methodCardSelected: { borderColor: colors.primary, backgroundColor: '#F8F7FF' },
  methodIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#F0EFFF', alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  methodIconSelected: { backgroundColor: colors.primary },
  methodTitle: { color: colors.text, fontSize: 13, fontWeight: '800' },
  methodTitleSelected: { color: colors.primary },
  methodCaption: { color: colors.textSecondary, fontSize: 11, lineHeight: 15 },
  methodCaptionSelected: { color: '#5A55AC' },
  methodCheck: { position: 'absolute', top: 10, right: 10, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  allocationList: { marginTop: 8, borderTopWidth: 1, borderTopColor: '#EFF0F6', paddingTop: 10 },
  allocationListHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2, marginBottom: 4 },
  shareRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#F0F1F6', paddingVertical: 11, gap: 12 },
  sharePerson: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  sharePersonCopy: { flex: 1, gap: 2 },
  sharePersonName: { color: colors.text, fontSize: 13, fontWeight: '700' },
  sharePersonRole: { color: colors.textSecondary, fontSize: 11 },
  shareAmount: { color: colors.text, fontSize: 14, fontWeight: '800' },
  customAmountWrap: { flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderColor: colors.border, borderRadius: 11, paddingHorizontal: 9, backgroundColor: '#FFFFFF' },
  currencyPrefix: { color: colors.textSecondary, fontSize: 13, fontWeight: '700' },
  amountInput: { minWidth: 76, maxWidth: 100, paddingVertical: 9, textAlign: 'right', color: colors.text, fontWeight: '700', fontSize: 13 },
  invalidInput: { color: colors.expense },
  emptyAllocation: { backgroundColor: '#F8F8FC', borderRadius: 13, padding: 14 },
  reviewCard: { borderRadius: 19, borderWidth: 1, padding: 16, gap: 12 },
  reviewValid: { backgroundColor: '#F3FBF7', borderColor: '#CDEEDF' },
  reviewWarning: { backgroundColor: '#FFF9EF', borderColor: '#F6E1B8' },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reviewStatusIcon: { width: 31, height: 31, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  reviewStatusIconValid: { backgroundColor: colors.income },
  reviewStatusIconWarning: { backgroundColor: colors.warning },
  reviewHeaderCopy: { flex: 1, gap: 2 },
  reviewTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  reviewCaption: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  reviewMetrics: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.72)' },
  reviewMetric: { flex: 1, gap: 5 },
  reviewMetricLabel: { color: colors.textSecondary, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  reviewMetricValue: { color: colors.text, fontSize: 15, fontWeight: '800' },
  reviewMetricDivider: { width: 1, height: 34, backgroundColor: colors.border, marginHorizontal: 12 },
  reviewLine: { fontSize: 12, fontWeight: '700' },
  valid: { color: '#16875B' },
  invalid: { color: '#B7791F' },
  stickyFooter: { backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 20, paddingTop: 12, gap: 10 },
  footerSummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  footerSummaryLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  footerSummaryAmount: { color: colors.text, fontSize: 15, fontWeight: '800' },
  primaryButton: { backgroundColor: colors.primary, borderRadius: 14, minHeight: 50, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  footerButton: { marginTop: 0 },
  buttonDisabled: { opacity: 0.45 },
  emptyCard: { backgroundColor: colors.card, borderRadius: 20, padding: 22, borderWidth: 1, borderColor: colors.border, alignItems: 'center', gap: 10 },
  emptyIcon: { width: 56, height: 56, borderRadius: 19, backgroundColor: '#F0EFFF', alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '800', textAlign: 'center' },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  expenseOption: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#EFF0F6' },
  expenseIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0EFFF' },
  expenseOptionBody: { flex: 1, gap: 3 },
  expenseOptionTrailing: { alignItems: 'flex-end', gap: 5 },
});

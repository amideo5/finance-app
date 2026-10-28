import FriendCard from '@/src/components/finance/FriendCard';
import { getAccounts } from '@/src/services/firebase/accountsService';
import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import {
    acceptFriendRequest,
    getPendingRequests,
    getSentRequests,
    getUserFriends,
    rejectFriendRequest,
    removeFriend
} from '@/src/services/firebase/friendsService';
import {
  acceptFriendSettlement,
  cancelFriendSettlement,
  getFriendNetBalances,
  getFriendSettlements,
  getSplitSettlements,
  getUserSplits,
  rejectFriendSettlement,
  requestFriendSettlement,
} from '@/src/services/firebase/splitService';
import type { FinanceAccount, FriendSettlement, UnresolvedFriendObligation } from '@/types/finance';
import { buildMaps, getOutstandingObligations, type SettlementSuggestion } from '@/src/utils/splitUtils';
import { useRouter } from 'expo-router';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CheckCircle2, ChevronRight, CircleAlert, Clock3, Info, Layers3, Receipt, ShieldCheck, UserPlus, Users, Wallet, X } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Modal,
    TextInput,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function FriendsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { currentProfile } = useProfile();
  const [friends, setFriends] = useState<any[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [sentRequests, setSentRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'friends' | 'pending' | 'sent' | 'splits' | 'settlements'>('friends');
  const [peopleSection, setPeopleSection] = useState<'friends' | 'requests'>('friends');
  const [requestSection, setRequestSection] = useState<'received' | 'sent'>('received');
  const [splits, setSplits] = useState<any[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [settlements, setSettlements] = useState<SettlementSuggestion[]>([]);
  const [unresolvedObligations, setUnresolvedObligations] = useState<UnresolvedFriendObligation[]>([]);
  const [splitsLoading, setSplitsLoading] = useState(false);
  const [splitLoadError, setSplitLoadError] = useState<string | null>(null);
  const [outstandingTotalPaise, setOutstandingTotalPaise] = useState(0);
  const [pendingSplitRepaymentCount, setPendingSplitRepaymentCount] = useState(0);
  const [friendSettlements, setFriendSettlements] = useState<FriendSettlement[]>([]);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [repaymentTarget, setRepaymentTarget] = useState<{ userId: string; maxPaise: number } | null>(null);
  const [repaymentAmount, setRepaymentAmount] = useState('');
  const [selectedPayerAccountId, setSelectedPayerAccountId] = useState('');
  const [acceptSettlementTarget, setAcceptSettlementTarget] = useState<string | null>(null);
  const [submittingRepayment, setSubmittingRepayment] = useState(false);
  const [acceptingSettlement, setAcceptingSettlement] = useState(false);
  const [cancellingSettlementIds, setCancellingSettlementIds] = useState<string[]>([]);
  // A ref blocks fast repeated taps before React has time to re-render the button.
  const cancellingSettlementIdsRef = useRef(new Set<string>());

  const loadSplits = useCallback(async () => {
    const userId = currentProfile?.userId;
    if (!userId) return;
    setSplitsLoading(true);
    setSplitLoadError(null);
    setBalances({});
    setSettlements([]);
    setUnresolvedObligations([]);
    setSplits([]);
    setFriendSettlements([]);
    setOutstandingTotalPaise(0);
    setPendingSplitRepaymentCount(0);
    try {
      const userSplits = await getUserSplits(userId);
      const splitSettlementRows = (await Promise.all(
        userSplits.map((split) => getSplitSettlements(split.id)),
      )).flat();
      const friendSettlementRows = await getFriendSettlements(userId);
      const netLedger = await getFriendNetBalances(userId);

      setSplits(userSplits);
      setFriendSettlements(friendSettlementRows);
      setBalances(netLedger.balances);
      setSettlements(netLedger.suggestions);
      setUnresolvedObligations(netLedger.unresolvedObligations);
      const outstanding = getOutstandingObligations(userSplits, splitSettlementRows);
      setOutstandingTotalPaise(outstanding.reduce((total, item) => total + item.amountInPaise, 0));
      setPendingSplitRepaymentCount(splitSettlementRows.filter((item) => item.status === 'pending').length);
    } catch (error) {
      console.error('Failed to load split and settlement balances:', error);
      const message = error instanceof Error ? error.message : 'Please try again.';
      setSplitLoadError(message);
      // Do not continue displaying stale suggestions after a network, permission,
      // or backend-version failure. A new suggestion requires a fresh server read.
      setBalances({});
      setSettlements([]);
      setUnresolvedObligations([]);
      setSplits([]);
      setFriendSettlements([]);
      setOutstandingTotalPaise(0);
      setPendingSplitRepaymentCount(0);
      Alert.alert('Could not load balances', message);
    } finally {
      setSplitsLoading(false);
    }
  }, [currentProfile]);

  const friendMap = Object.fromEntries(
    friends.map((friend) => [friend.friendId, friend.profileData?.name?.trim() || 'Friend'])
  );
  const repaymentAmountNumber = Number(repaymentAmount);
  const repaymentAmountPaiseForUi = Math.round(repaymentAmountNumber * 100);
  const repaymentAmountValidForUi = Boolean(
    repaymentTarget
    && Number.isFinite(repaymentAmountNumber)
    && Number.isSafeInteger(repaymentAmountPaiseForUi)
    && repaymentAmountPaiseForUi > 0
    && repaymentAmountPaiseForUi <= repaymentTarget.maxPaise
  );
  const selectedPayerAccount = accounts.find((account) => account.id === selectedPayerAccountId);
  const selectedPayerBalancePaise = Math.round(Number(selectedPayerAccount?.balance ?? 0) * 100);
  const selectedPayerHasEnoughBalance = Boolean(
    selectedPayerAccount
    && Number.isFinite(Number(selectedPayerAccount.balance ?? 0))
    && repaymentAmountValidForUi
    && selectedPayerBalancePaise >= repaymentAmountPaiseForUi
  );

  const getName = (id: string) => {
    if (id === currentProfile?.userId) return 'You';
    const historicalName = splits
      .flatMap((split) => Array.isArray(split.participants) ? split.participants : [])
      .find((participant) => participant?.userId === id)?.displayName;
    // Never display raw Firebase UIDs as names if profile metadata is unavailable.
    return friendMap[id] || (typeof historicalName === 'string' && historicalName.trim() ? historicalName.trim() : 'Participant');
  };

  const loadFriendsData = useCallback(async () => {
    if (!currentProfile?.userId) return;

    setLoading(true);
    try {
      const [friendsList, pendingList, sentList, accountList] = await Promise.all([
        getUserFriends(currentProfile!.userId),
        getPendingRequests(currentProfile!.userId),
        getSentRequests(currentProfile!.userId),
        getAccounts(currentProfile!.id),
      ]);

      setFriends(friendsList);
      setPendingRequests(pendingList);
      setSentRequests(sentList);
      setAccounts(accountList as FinanceAccount[]);
    } catch (error) {
      console.error('Error loading friends data:', error);
      Alert.alert('Error', 'Failed to load friends data');
    } finally {
      setLoading(false);
    }
  }, [currentProfile]);

  const refreshSettlementData = async () => {
    await Promise.all([loadSplits(), loadFriendsData()]);
  };

  const openFriendRepayment = (toUserId: string, maxPaise: number) => {
    if (accounts.length === 0) {
      Alert.alert('Account required', 'Add an account before proposing a settlement so the payment can be linked to a funding source.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Add account', onPress: () => router.push('/accounts/add') },
      ]);
      return;
    }
    setSelectedPayerAccountId(accounts[0]?.id || '');
    setRepaymentTarget({ userId: toUserId, maxPaise });
    setRepaymentAmount((maxPaise / 100).toFixed(2));
  };

  const submitFriendRepayment = async () => {
    const fromUserId = currentProfile?.userId;
    if (!fromUserId || !repaymentTarget || !currentProfile) return;
    if (!selectedPayerAccountId || !accounts.some((account) => account.id === selectedPayerAccountId)) {
      Alert.alert('Choose an account', 'Select the account the payment will come from.');
      return;
    }
    const parsed = Number(repaymentAmount);
    const amountInPaise = Math.round(parsed * 100);
    if (!Number.isFinite(parsed) || !Number.isSafeInteger(amountInPaise) || amountInPaise <= 0 || amountInPaise > repaymentTarget.maxPaise) {
      Alert.alert('Invalid amount', `Enter an amount from ₹0.01 up to ₹${(repaymentTarget.maxPaise / 100).toFixed(2)}.`);
      return;
    }
    const payerAccount = accounts.find((account) => account.id === selectedPayerAccountId);
    if (!payerAccount) {
      Alert.alert('Choose an account', 'Select the account the payment will come from.');
      return;
    }
    const availablePaise = Math.round(Number(payerAccount.balance ?? 0) * 100);
    if (!Number.isFinite(availablePaise) || availablePaise < amountInPaise) {
      Alert.alert(
        'Insufficient balance',
        `${payerAccount.name || 'Selected account'} has ₹${(Number.isFinite(availablePaise) ? availablePaise / 100 : 0).toFixed(2)} available, but the payment is ₹${(amountInPaise / 100).toFixed(2)}. Choose another account, reduce the amount, or add funds first.`,
      );
      return;
    }
    setSubmittingRepayment(true);
    try {
      await requestFriendSettlement({
        toUserId: repaymentTarget.userId,
        amountInPaise,
        fromProfileId: currentProfile.id,
        fromAccountId: selectedPayerAccountId,
        idempotencyKey: `friend-settlement-${fromUserId}-${repaymentTarget.userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      });
      setRepaymentTarget(null);
      Alert.alert('Request sent', `Your ₹${(amountInPaise / 100).toFixed(2)} partial payment request was sent. The recipient must accept it.`);
      await refreshSettlementData();
    } catch (error) {
      void refreshSettlementData();
      console.error('Friend settlement request failed:', error);
      Alert.alert('Could not send request', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSubmittingRepayment(false);
    }
  };

  const handleAcceptFriendSettlement = (settlementId: string) => {
    if (!currentProfile) return;
    if (accounts.length === 0) {
      Alert.alert('Account required', 'Add a receiving account before accepting this payment.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Add account', onPress: () => router.push('/accounts/add') },
      ]);
      return;
    }
    setAcceptSettlementTarget(settlementId);
  };

  const confirmAcceptFriendSettlement = async (recipientAccountId: string) => {
    if (!acceptSettlementTarget || !currentProfile) return;
    setAcceptingSettlement(true);
    try {
      await acceptFriendSettlement({
        settlementId: acceptSettlementTarget,
        recipientProfileId: currentProfile.id,
        recipientAccountId,
      });
      setAcceptSettlementTarget(null);
      Alert.alert('Settlement accepted', 'Linked transaction entries were created and both selected account balances were updated.');
      await refreshSettlementData();
    } catch (error) {
      void refreshSettlementData();
      console.error('Accepting friend settlement failed:', error);
      Alert.alert('Could not accept settlement', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setAcceptingSettlement(false);
    }
  };

  const handleRejectFriendSettlement = async (settlementId: string) => {
    try {
      await rejectFriendSettlement({ settlementId });
      await refreshSettlementData();
    } catch (error) {
      void refreshSettlementData();
      console.error('Rejecting friend settlement failed:', error);
      Alert.alert('Could not reject request', error instanceof Error ? error.message : 'Please try again.');
    }
  };

  const handleCancelFriendSettlement = async (settlementId: string) => {
    // Prevent a double tap from launching concurrent Firestore transactions for
    // the same settlement (both can read `pending`, then one commit gets HTTP 409).
    if (cancellingSettlementIdsRef.current.has(settlementId)) return;
    cancellingSettlementIdsRef.current.add(settlementId);
    setCancellingSettlementIds((previous) => previous.includes(settlementId) ? previous : [...previous, settlementId]);

    try {
      let lastError: unknown = null;
      let completed = false;

      // A shared ledger lock can conflict with another settlement write. Retry
      // the idempotent cancellation with a short backoff before surfacing an error.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          await cancelFriendSettlement({ settlementId });
          completed = true;
          break;
        } catch (error) {
          lastError = error;
          const message = error instanceof Error ? error.message : String(error);
          const isConflict = /\b409\b|conflict/i.test(message);
          if (!isConflict || attempt === 2) break;
          await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
        }
      }

      if (!completed) throw lastError instanceof Error ? lastError : new Error('Please try again.');
      await refreshSettlementData();
    } catch (error) {
      // A duplicate request may lose the race after another request already
      // cancelled the settlement. Verify persisted state before showing failure.
      let alreadyCancelled = false;
      try {
        if (currentProfile?.userId) {
          const latestSettlements = await getFriendSettlements(currentProfile.userId);
          alreadyCancelled = latestSettlements.some((item) => item.id === settlementId && item.status === 'cancelled');
        }
      } catch (verificationError) {
        console.warn('Could not verify settlement status after cancellation conflict:', verificationError);
      }

      await refreshSettlementData();
      if (!alreadyCancelled) {
        console.error('Cancelling friend settlement failed:', error);
        const message = error instanceof Error ? error.message : 'Please try again.';
        Alert.alert(
          'Could not cancel request',
          /\b409\b|conflict/i.test(message)
            ? 'Another payment update happened at the same time. The list has been refreshed; if this request is still pending, try cancelling it again.'
            : message,
        );
      }
    } finally {
      cancellingSettlementIdsRef.current.delete(settlementId);
      setCancellingSettlementIds((previous) => previous.filter((id) => id !== settlementId));
    }
  };

  useEffect(() => {
    if (currentProfile) {
      // Fetch remote friend and split records when the active profile changes.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadFriendsData();
      void loadSplits();
    }
  }, [currentProfile, loadFriendsData, loadSplits]);

  const handleAcceptRequest = async (requestId: string, fromUserId: string) => {
    try {
      await acceptFriendRequest(requestId, currentProfile!.userId, fromUserId);
      Alert.alert('Success', 'Friend request accepted!');
      loadFriendsData();
    } catch (error) {
      console.error('Error accepting request:', error);
      Alert.alert('Error', 'Failed to accept request');
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    try {
      await rejectFriendRequest(requestId);
      loadFriendsData();
    } catch (error) {
      console.error('Error rejecting request:', error);
      Alert.alert('Error', 'Failed to reject request');
    }
  };

  const handleRemoveFriend = async (friendId: string, friendName: string) => {
    Alert.alert(
      'Remove Friend',
      `Are you sure you want to remove ${friendName} as a friend?`,
      [
        { text: 'Cancel', onPress: () => { }, style: 'cancel' },
        {
          text: 'Remove',
          onPress: async () => {
            try {
              await removeFriend(currentProfile!.userId, friendId);
              Alert.alert('Success', 'Friend removed');
              loadFriendsData();
            } catch (error) {
              console.error('Error removing friend:', error);
              Alert.alert('Error', 'Failed to remove friend');
            }
          },
          style: 'destructive',
        },
      ]
    );
  };

  const navigateToAddFriend = () => {
    router.push('/friends/add');
  };

  const renderSplits = () => {
    if (!currentProfile) return null;

    // The trusted Edge Function performs the authoritative mutual-friendship check.
    // Keep this client-side filter only for caller scope; do not rely on a cached
    // friend-list query to decide whether a server-validated suggestion is visible.
    const friendOnlySuggestions = settlements.filter((item) =>
      item.fromUserId === currentProfile.userId || item.toUserId === currentProfile.userId,
    );
    const { oweMap, getMap } = buildMaps(friendOnlySuggestions, currentProfile.userId);
    const isCliqueNetPair = (fromUserId: string, toUserId: string) => friendOnlySuggestions.some((item) =>
      item.fromUserId === fromUserId && item.toUserId === toUserId && item.settlementMode === 'clique_net'
    );

    const hasBalance = Object.values(balances).some((value) => value !== 0)
      || friendOnlySuggestions.length > 0
      || unresolvedObligations.length > 0
      || pendingSplitRepaymentCount > 0
      || friendSettlements.some((item) => item.status === 'pending' && (item.fromUserId === currentProfile.userId || item.toUserId === currentProfile.userId));

    const totalYouOwe = Object.values(oweMap).reduce((a, b) => a + b, 0);
    const totalOwed = Object.values(getMap).reduce((a, b) => a + b, 0);
    const totalSharedPaise = splits.filter((split) => split.status !== 'cancelled')
      .reduce((sum, split) => sum + split.totalAmountInPaise, 0);
    const netPaise = totalOwed - totalYouOwe;

    return (
      <View style={styles.tabContent}>
        <LinearGradient colors={['#29265E', '#5146D8', '#6C63F5']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.splitHero}>
          <View style={styles.splitHeroTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.splitEyebrow}>SHARED FINANCES</Text>
              <Text style={styles.splitHeroTitle}>Your split summary</Text>
            </View>
            <View style={styles.splitHeroIcon}><Layers3 size={21} color="#FFFFFF" /></View>
          </View>
          <Text style={styles.splitNetLabel}>Net balance</Text>
          <Text style={styles.splitNetAmount}>{netPaise < 0 ? '−' : netPaise > 0 ? '+' : ''}₹{(Math.abs(netPaise) / 100).toFixed(2)}</Text>
          <Text style={styles.splitNetCaption}>{netPaise > 0 ? 'You are owed more than you owe' : netPaise < 0 ? 'You owe more than you are owed' : 'Your suggested balances are even'}</Text>
          <Text style={styles.splitOutstandingCaption}>Outstanding split obligations · ₹{(outstandingTotalPaise / 100).toFixed(2)}</Text>
          <View style={styles.splitMetricsRow}>
            <View style={styles.splitMetricTile}>
              <View style={styles.splitMetricHeading}><ArrowDownLeft size={14} color="#B9F6DD" /><Text style={styles.splitMetricLabel}>You get</Text></View>
              <Text style={styles.splitMetricAmount}>₹{(totalOwed / 100).toFixed(2)}</Text>
            </View>
            <View style={styles.splitMetricDivider} />
            <View style={styles.splitMetricTile}>
              <View style={styles.splitMetricHeading}><ArrowUpRight size={14} color="#FFD4D8" /><Text style={styles.splitMetricLabel}>You owe</Text></View>
              <Text style={styles.splitMetricAmount}>₹{(totalYouOwe / 100).toFixed(2)}</Text>
            </View>
            <View style={styles.splitMetricDivider} />
            <View style={styles.splitMetricTile}>
              <View style={styles.splitMetricHeading}><Wallet size={14} color="#E1DEFF" /><Text style={styles.splitMetricLabel}>Shared</Text></View>
              <Text style={styles.splitMetricAmount}>₹{(totalSharedPaise / 100).toFixed(2)}</Text>
            </View>
          </View>
        </LinearGradient>

        <View style={styles.infoBanner}>
          <View style={styles.infoBannerIcon}><ShieldCheck size={18} color={colors.primary} /></View>
          <View style={styles.infoBannerBody}>
            <Text style={styles.infoBannerTitle}>How suggestions work</Text>
            <Text style={styles.infoBannerText}>Suggestions require a currently accepted friendship. Mutual groups may be netted to reduce transfers; bridge relationships remain bilateral. A group-net payment does not mark individual splits as paid. A suggestion is complete only after the recipient accepts.</Text>
          </View>
        </View>

        {splitsLoading ? (
          <View style={styles.statusBanner}>
            <ActivityIndicator color={colors.primary} size="small" />
            <View style={styles.statusBannerBody}><Text style={styles.statusBannerTitle}>Refreshing balances</Text><Text style={styles.statusBannerText}>Checking the latest ledger and friendship permissions…</Text></View>
          </View>
        ) : null}
        {pendingSplitRepaymentCount > 0 && !splitLoadError ? (
          <View style={[styles.statusBanner, styles.statusBannerWarning]}>
            <Clock3 size={20} color="#B7791F" />
            <View style={styles.statusBannerBody}><Text style={styles.statusBannerTitle}>{pendingSplitRepaymentCount} repayment request{pendingSplitRepaymentCount === 1 ? '' : 's'} awaiting confirmation</Text><Text style={styles.statusBannerText}>These amounts remain outstanding until confirmed.</Text></View>
          </View>
        ) : null}
        {splitLoadError ? (
          <View style={[styles.statusBanner, styles.statusBannerError]}>
            <CircleAlert size={20} color={colors.danger} />
            <View style={styles.statusBannerBody}><Text style={styles.statusBannerTitle}>Suggestions unavailable</Text><Text style={styles.statusBannerText}>The latest ledger could not be verified. No cached suggestion is shown. Refresh after the split service is available.</Text><Text style={styles.statusBannerDetail}>{splitLoadError}</Text></View>
          </View>
        ) : null}

        {Object.entries(oweMap).length > 0 && (
          <View style={styles.splitSection}>
            <View style={styles.contentSectionHeading}>
              <View><Text style={styles.sectionTitle}>Payments to make</Text><Text style={styles.sectionCaption}>Suggested amounts you owe</Text></View>
              <View style={[styles.sectionCountBadge, styles.oweCountBadge]}><Text style={[styles.sectionCountText, { color: colors.danger }]}>{Object.entries(oweMap).length}</Text></View>
            </View>
            {Object.entries(oweMap).map(([userId, amount]) => (
              <View key={userId} style={styles.suggestionCard}>
                <View style={styles.suggestionPersonRow}>
                  <View style={[styles.suggestionAvatar, styles.suggestionAvatarOwe]}><Text style={styles.suggestionAvatarText}>{getName(userId).charAt(0).toUpperCase()}</Text></View>
                  <View style={styles.suggestionPersonCopy}>
                    <Text style={styles.suggestionName}>{getName(userId)}</Text>
                    <View style={styles.suggestionMetaRow}><Text style={styles.suggestionMeta}>{isCliqueNetPair(currentProfile.userId, userId) ? 'Group-net suggestion' : 'Bilateral suggestion'}</Text><View style={styles.metaDot} /><Text style={styles.suggestionMeta}>You owe</Text></View>
                  </View>
                  <Text style={styles.suggestionAmountOwe}>₹{(amount / 100).toFixed(2)}</Text>
                </View>
                <TouchableOpacity style={styles.repayButton} onPress={() => openFriendRepayment(userId, amount)} activeOpacity={0.85}>
                  <ArrowUpRight size={16} color="#FFFFFF" /><Text style={styles.repayButtonText}>Repay or pay partially</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        {Object.entries(getMap).length > 0 && (
          <View style={styles.splitSection}>
            <View style={styles.contentSectionHeading}>
              <View><Text style={styles.sectionTitle}>Payments coming in</Text><Text style={styles.sectionCaption}>Suggested amounts friends owe you</Text></View>
              <View style={[styles.sectionCountBadge, styles.getCountBadge]}><Text style={[styles.sectionCountText, { color: colors.success }]}>{Object.entries(getMap).length}</Text></View>
            </View>
            {Object.entries(getMap).map(([userId, amount]) => (
              <View key={userId} style={styles.suggestionCard}>
                <View style={styles.suggestionPersonRow}>
                  <View style={[styles.suggestionAvatar, styles.suggestionAvatarGet]}><Text style={styles.suggestionAvatarText}>{getName(userId).charAt(0).toUpperCase()}</Text></View>
                  <View style={styles.suggestionPersonCopy}>
                    <Text style={styles.suggestionName}>{getName(userId)}</Text>
                    <View style={styles.suggestionMetaRow}><Text style={styles.suggestionMeta}>{isCliqueNetPair(userId, currentProfile.userId) ? 'Group-net suggestion' : 'Bilateral suggestion'}</Text><View style={styles.metaDot} /><Text style={styles.suggestionMeta}>You receive</Text></View>
                  </View>
                  <Text style={styles.suggestionAmountGet}>₹{(amount / 100).toFixed(2)}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {unresolvedObligations.length > 0 && (
          <View style={styles.splitSection}>
            <View style={styles.contentSectionHeading}><View><Text style={styles.sectionTitle}>Needs attention</Text><Text style={styles.sectionCaption}>Amounts blocked by friendship rules</Text></View><CircleAlert size={20} color={colors.warning} /></View>
            {unresolvedObligations.map((item) => {
              const youOwe = item.fromUserId === currentProfile.userId;
              const counterpartId = youOwe ? item.toUserId : item.fromUserId;
              return (
                <View key={`${item.fromUserId}:${item.toUserId}`} style={styles.obligationCard}>
                  <View style={styles.obligationTopRow}>
                    <View style={styles.warningIcon}><CircleAlert size={17} color="#B7791F" /></View>
                    <View style={styles.obligationCopy}><Text style={styles.suggestionName}>{youOwe ? `You owe ${getName(counterpartId)}` : `${getName(counterpartId)} owes you`}</Text><Text style={styles.suggestionMeta}>Outstanding · not settled</Text></View>
                    <Text style={youOwe ? styles.suggestionAmountOwe : styles.suggestionAmountGet}>₹{(item.amountInPaise / 100).toFixed(2)}</Text>
                  </View>
                  <Text style={styles.obligationDetail}>{getName(item.fromUserId)} and {getName(item.toUserId)} do not currently have a verified mutual accepted friendship. A direct payment cannot be suggested, so this amount remains outstanding until a permitted settlement is available.</Text>
                </View>
              );
            })}
          </View>
        )}

        {!splitLoadError && !splitsLoading && !hasBalance && (
          <View style={styles.emptyPanel}>
            <View style={styles.emptyPanelIcon}><CheckCircle2 size={28} color={colors.success} /></View>
            <Text style={styles.emptyPanelTitle}>All settled</Text>
            <Text style={styles.emptyPanelText}>No outstanding suggested payments right now. Your shared finances are up to date.</Text>
          </View>
        )}

        <View style={styles.splitSection}>
          <View style={styles.contentSectionHeading}><View><Text style={styles.sectionTitle}>Recent splits</Text><Text style={styles.sectionCaption}>Your latest shared expenses</Text></View><View style={styles.sectionCountBadge}><Text style={styles.sectionCountText}>{splits.length}</Text></View></View>
          {splits.length === 0 ? (
            <View style={styles.compactEmpty}><Receipt size={22} color={colors.textLight} /><Text style={styles.compactEmptyText}>Shared expenses will appear here.</Text></View>
          ) : splits.slice(0, 10).map((split) => (
            <TouchableOpacity key={split.id} style={styles.recentSplitCard} onPress={() => router.push(`/splits/${split.id}`)} activeOpacity={0.82}>
              <View style={styles.recentSplitIcon}><Receipt size={19} color={colors.primary} /></View>
              <View style={styles.recentSplitCopy}>
                <Text style={styles.suggestionName} numberOfLines={1}>{split.title || 'Shared expense'}</Text>
                <Text style={styles.suggestionMeta}>{Array.isArray(split.participants) ? `${split.participants.length} participants` : 'Shared expense'}{split.sourceDate ? ` · ${split.sourceDate}` : ''}</Text>
              </View>
              <View style={styles.recentSplitRight}><Text style={styles.recentSplitAmount}>₹{(split.totalAmountInPaise / 100).toFixed(2)}</Text><View style={styles.splitStatusPill}><Text style={styles.splitStatusText}>{String(split.status || 'active').replaceAll('_', ' ')}</Text></View></View>
              <ChevronRight size={17} color={colors.textLight} />
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  };

  const renderSettlements = () => {
    const userId = currentProfile?.userId;
    if (!userId) return null;
    const incoming = friendSettlements.filter((item) => item.status === 'pending' && item.toUserId === userId);
    const outgoing = friendSettlements.filter((item) => item.status === 'pending' && item.fromUserId === userId);
    const history = friendSettlements
      .filter((item) => item.status !== 'pending')
      .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
    const empty = (message: string) => (
      <View style={styles.paymentEmptyState}><View style={styles.paymentEmptyIcon}><ArrowLeftRight size={20} color={colors.textLight} /></View><Text style={styles.paymentEmptyText}>{message}</Text></View>
    );
    const card = (item: FriendSettlement, direction: 'incoming' | 'outgoing' | 'history') => {
      const personName = direction === 'incoming' ? getName(item.fromUserId) : getName(item.toUserId);
      const statusLabel = direction === 'incoming' ? 'ACTION REQUIRED' : direction === 'outgoing' ? 'AWAITING ACCEPTANCE' : String(item.status).replaceAll('_', ' ').toUpperCase();
      return (
        <View key={item.id} style={styles.friendSettlementCard}>
          <View style={styles.friendSettlementTop}>
            <View style={styles.settlementAvatar}><Text style={styles.settlementAvatarText}>{personName.charAt(0).toUpperCase()}</Text></View>
            <View style={styles.settlementInfo}>
              <Text style={styles.settlementPersonName}>{personName}</Text>
              <Text style={styles.settlementSubText}>{direction === 'incoming' ? 'Proposed by friend' : direction === 'outgoing' ? 'Waiting for their acceptance' : `Payment ${String(item.status).replaceAll('_', ' ')}`}</Text>
            </View>
            <View style={[styles.paymentStatusPill, direction === 'incoming' ? styles.paymentStatusIncoming : direction === 'outgoing' ? styles.paymentStatusPending : item.status === 'accepted' ? styles.paymentStatusAccepted : styles.paymentStatusNeutral]}><Text style={[styles.paymentStatusText, direction === 'incoming' ? styles.paymentStatusIncomingText : direction === 'outgoing' ? styles.paymentStatusPendingText : item.status === 'accepted' ? styles.paymentStatusAcceptedText : styles.paymentStatusNeutralText]}>{statusLabel}</Text></View>
          </View>
          {item.note ? <Text style={styles.settlementNote}>{item.note}</Text> : null}
          {direction === 'incoming' && (!item.fromProfileId || !item.fromAccountId) ? (
            <View style={styles.legacyWarning}><Info size={15} color="#B7791F" /><Text style={styles.legacyWarningText}>This older request has no funding account. Dismiss it and ask the sender to resend with an account selected.</Text></View>
          ) : null}
          <View style={styles.friendSettlementBottom}>
            <View><Text style={styles.settlementAmountLabel}>AMOUNT</Text><Text style={[styles.settlementAmount, item.status === 'accepted' && styles.settlementAmountAccepted]}>₹{(item.amountInPaise / 100).toFixed(2)}</Text></View>
            {direction === 'incoming' ? (
              <View style={styles.actionRow}>
                {item.fromProfileId && item.fromAccountId ? (
                  <TouchableOpacity onPress={() => handleAcceptFriendSettlement(item.id)} style={styles.actionButton} activeOpacity={0.85}><CheckCircle2 size={14} color="#FFFFFF" /><Text style={styles.actionButtonText}>Accept</Text></TouchableOpacity>
                ) : null}
                <TouchableOpacity onPress={() => handleRejectFriendSettlement(item.id)} style={[styles.actionButton, styles.secondaryButton]} activeOpacity={0.85}><Text style={[styles.actionButtonText, styles.secondaryButtonText]}>{item.fromProfileId && item.fromAccountId ? 'Reject' : 'Dismiss request'}</Text></TouchableOpacity>
              </View>
            ) : direction === 'outgoing' ? (
              <TouchableOpacity
                onPress={() => void handleCancelFriendSettlement(item.id)}
                disabled={cancellingSettlementIds.includes(item.id)}
                style={[styles.actionButton, styles.secondaryButton, cancellingSettlementIds.includes(item.id) && styles.actionButtonDisabled]}
                activeOpacity={0.85}
              >
                {cancellingSettlementIds.includes(item.id) ? <ActivityIndicator size="small" color={colors.textSecondary} /> : null}
                <Text style={[styles.actionButtonText, styles.secondaryButtonText]}>{cancellingSettlementIds.includes(item.id) ? 'Cancelling…' : 'Cancel request'}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      );
    };

    return (
      <View style={styles.tabContent}>
        <LinearGradient colors={['#29265E', '#5146D8', '#6C63F5']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.paymentsHero}>
          <View style={styles.paymentsHeroIcon}><ArrowLeftRight size={22} color="#FFFFFF" /></View>
          <Text style={styles.paymentsHeroEyebrow}>FRIEND PAYMENTS</Text>
          <Text style={styles.paymentsHeroTitle}>Settlement requests</Text>
          <Text style={styles.paymentsHeroSub}>Review, accept or cancel payments between you and your friends.</Text>
          <View style={styles.paymentsSummaryRow}>
            <View style={styles.paymentsSummaryItem}><Text style={styles.paymentsSummaryNumber}>{incoming.length}</Text><Text style={styles.paymentsSummaryLabel}>Incoming</Text></View>
            <View style={styles.paymentsSummaryDivider} />
            <View style={styles.paymentsSummaryItem}><Text style={styles.paymentsSummaryNumber}>{outgoing.length}</Text><Text style={styles.paymentsSummaryLabel}>Sent</Text></View>
            <View style={styles.paymentsSummaryDivider} />
            <View style={styles.paymentsSummaryItem}><Text style={styles.paymentsSummaryNumber}>{history.length}</Text><Text style={styles.paymentsSummaryLabel}>History</Text></View>
          </View>
        </LinearGradient>
        <View style={styles.paymentsSection}>
          <View style={styles.contentSectionHeading}><View><Text style={styles.sectionTitle}>Incoming requests</Text><Text style={styles.sectionCaption}>Payments waiting for your decision</Text></View><View style={[styles.sectionCountBadge, incoming.length > 0 && styles.incomingCountBadge]}><Text style={[styles.sectionCountText, incoming.length > 0 && { color: colors.primary }]}>{incoming.length}</Text></View></View>
          {incoming.length === 0 ? empty('No payment requests waiting for your acceptance.') : incoming.map((item) => card(item, 'incoming'))}
        </View>
        <View style={styles.paymentsSection}>
          <View style={styles.contentSectionHeading}><View><Text style={styles.sectionTitle}>Sent requests</Text><Text style={styles.sectionCaption}>Requests awaiting the other person</Text></View><View style={styles.sectionCountBadge}><Text style={styles.sectionCountText}>{outgoing.length}</Text></View></View>
          {outgoing.length === 0 ? empty('You have no pending settlement requests.') : outgoing.map((item) => card(item, 'outgoing'))}
        </View>
        <View style={styles.paymentsSection}>
          <View style={styles.contentSectionHeading}><View><Text style={styles.sectionTitle}>Payment history</Text><Text style={styles.sectionCaption}>Completed or closed requests</Text></View><View style={styles.sectionCountBadge}><Text style={styles.sectionCountText}>{history.length}</Text></View></View>
          {history.length === 0 ? empty('Accepted, rejected, and cancelled requests will appear here.') : history.slice(0, 30).map((item) => card(item, 'history'))}
        </View>
      </View>
    );
  };
  const isPeopleArea = activeTab === 'friends' || activeTab === 'pending' || activeTab === 'sent';

  const openPeopleArea = () => {
    setPeopleSection('friends');
    setActiveTab('friends');
  };

  const openRequestsArea = () => {
    setPeopleSection('requests');
    setActiveTab(requestSection === 'received' ? 'pending' : 'sent');
  };

  const chooseRequestSection = (section: 'received' | 'sent') => {
    setRequestSection(section);
    setPeopleSection('requests');
    setActiveTab(section === 'received' ? 'pending' : 'sent');
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'splits':
        return renderSplits();
      case 'settlements':
        return renderSettlements();
      case 'pending':
        return (
          <View style={styles.tabContent}>
            <View style={styles.peopleContentIntro}>
              <View style={styles.peopleIntroIcon}><UserPlus size={19} color={colors.primary} /></View>
              <View style={{ flex: 1 }}><Text style={styles.peopleIntroTitle}>Received requests</Text><Text style={styles.peopleIntroSub}>Connect with people to share expenses and settle balances.</Text></View>
              <View style={[styles.sectionCountBadge, pendingRequests.length > 0 && styles.incomingCountBadge]}><Text style={[styles.sectionCountText, pendingRequests.length > 0 && { color: colors.primary }]}>{pendingRequests.length}</Text></View>
            </View>
            {pendingRequests.length === 0 ? (
              <View style={styles.emptyPanel}>
                <View style={styles.emptyPanelIcon}><Users size={28} color={colors.primary} /></View>
                <Text style={styles.emptyPanelTitle}>No pending requests</Text>
                <Text style={styles.emptyPanelText}>New connection requests will appear here. You can accept or dismiss each request.</Text>
              </View>
            ) : (
              pendingRequests.map((request) => (
                <FriendCard
                  key={request.id}
                  friendName={request.profileData?.name || request.fromUserId}
                  friendId={request.fromUserId}
                  isPending={true}
                  onAccept={() => handleAcceptRequest(request.id, request.fromUserId)}
                  onReject={() => handleRejectRequest(request.id)}
                />
              ))
            )}
          </View>
        );
      case 'sent':
        return (
          <View style={styles.tabContent}>
            <View style={styles.peopleContentIntro}>
              <View style={styles.peopleIntroIcon}><Clock3 size={19} color={colors.primary} /></View>
              <View style={{ flex: 1 }}><Text style={styles.peopleIntroTitle}>Sent requests</Text><Text style={styles.peopleIntroSub}>Keep track of invitations you have already sent.</Text></View>
              <View style={styles.sectionCountBadge}><Text style={styles.sectionCountText}>{sentRequests.length}</Text></View>
            </View>
            {sentRequests.length === 0 ? (
              <View style={styles.emptyPanel}>
                <View style={styles.emptyPanelIcon}><UserPlus size={28} color={colors.primary} /></View>
                <Text style={styles.emptyPanelTitle}>No sent requests</Text>
                <Text style={styles.emptyPanelText}>When you invite someone, you can follow the request status here.</Text>
                <TouchableOpacity style={styles.emptyPanelButton} onPress={navigateToAddFriend}><Text style={styles.emptyPanelButtonText}>Add a friend</Text></TouchableOpacity>
              </View>
            ) : (
              sentRequests.map((request) => (
                <FriendCard
                  key={request.id}
                  friendName={request.profileData?.name || request.toUserId}
                  friendId={request.toUserId}
                  isPending={true}
                />
              ))
            )}
          </View>
        );
      case 'friends':
      default:
        return (
          <View style={styles.tabContent}>
            <View style={styles.peopleContentIntro}>
              <View style={styles.peopleIntroIcon}><Users size={19} color={colors.primary} /></View>
              <View style={{ flex: 1 }}><Text style={styles.peopleIntroTitle}>Your circle</Text><Text style={styles.peopleIntroSub}>Friends you can split expenses and settle with.</Text></View>
              <View style={styles.sectionCountBadge}><Text style={styles.sectionCountText}>{friends.length}</Text></View>
            </View>
            {friends.length === 0 ? (
              <View style={styles.emptyPanel}>
                <View style={styles.emptyPanelIcon}><Users size={28} color={colors.primary} /></View>
                <Text style={styles.emptyPanelTitle}>Your circle starts here</Text>
                <Text style={styles.emptyPanelText}>Add a friend to start sharing expenses, tracking balances and settling up.</Text>
                <TouchableOpacity style={styles.emptyPanelButton} onPress={navigateToAddFriend}><UserPlus size={16} color="#FFFFFF" /><Text style={styles.emptyPanelButtonText}>Add a friend</Text></TouchableOpacity>
              </View>
            ) : (
              friends.map((friend) => (
                <FriendCard
                  key={friend.id}
                  friendName={friend.profileData?.name || friend.friendId}
                  friendId={friend.friendId}
                  onRemove={() => handleRemoveFriend(friend.friendId, friend.profileData?.name || friend.friendId)}
                  onMessage={() => {
                    // TODO: Navigate to chat
                    Alert.alert('Coming Soon', 'Chat feature coming soon!');
                  }}
                />
              ))
            )}
          </View>
        );
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top + 8, 48) }]}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Friends</Text>
          <Text style={styles.headerSubtitle}>Your people, shared expenses and repayments</Text>
        </View>
        <TouchableOpacity
          style={styles.addButton}
          onPress={navigateToAddFriend}
        >
          <UserPlus color={colors.card} size={24} />
        </TouchableOpacity>
      </View>

      <View style={styles.primaryTabs}>
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.primaryTab, isPeopleArea && styles.primaryTabActive]}
          onPress={openPeopleArea}
        >
          <Users size={17} color={isPeopleArea ? colors.primary : colors.textSecondary} />
          <Text style={[styles.primaryTabText, isPeopleArea && styles.primaryTabTextActive]}>People</Text>
          <Text style={[styles.primaryTabCount, isPeopleArea && styles.primaryTabTextActive]}>{friends.length}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.primaryTab, activeTab === 'splits' && styles.primaryTabActive]}
          onPress={() => setActiveTab('splits')}
        >
          <Layers3 size={17} color={activeTab === 'splits' ? colors.primary : colors.textSecondary} />
          <Text style={[styles.primaryTabText, activeTab === 'splits' && styles.primaryTabTextActive]}>Splits</Text>
          <Text style={[styles.primaryTabCount, activeTab === 'splits' && styles.primaryTabTextActive]}>{splits.length}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.primaryTab, activeTab === 'settlements' && styles.primaryTabActive]}
          onPress={() => setActiveTab('settlements')}
        >
          <ArrowLeftRight size={17} color={activeTab === 'settlements' ? colors.primary : colors.textSecondary} />
          <Text style={[styles.primaryTabText, activeTab === 'settlements' && styles.primaryTabTextActive]}>Payments</Text>
          <Text style={[styles.primaryTabCount, activeTab === 'settlements' && styles.primaryTabTextActive]}>{friendSettlements.filter((item) => item.status === 'pending' && item.toUserId === currentProfile?.userId).length}</Text>
        </TouchableOpacity>
      </View>

      {isPeopleArea ? (
        <View style={styles.peopleNavigation}>
          <View style={styles.secondaryTabs}>
            <TouchableOpacity
              style={[styles.secondaryTab, peopleSection === 'friends' && styles.secondaryTabActive]}
              onPress={openPeopleArea}
            >
              <Text style={[styles.secondaryTabText, peopleSection === 'friends' && styles.secondaryTabTextActive]}>Friends</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryTab, peopleSection === 'requests' && styles.secondaryTabActive]}
              onPress={openRequestsArea}
            >
              <Text style={[styles.secondaryTabText, peopleSection === 'requests' && styles.secondaryTabTextActive]}>Requests</Text>
              {pendingRequests.length > 0 ? <View style={styles.requestBadge}><Text style={styles.requestBadgeText}>{pendingRequests.length}</Text></View> : null}
            </TouchableOpacity>
          </View>
          {peopleSection === 'requests' ? (
            <View style={styles.requestDirectionTabs}>
              <TouchableOpacity
                style={[styles.requestDirectionTab, activeTab === 'pending' && styles.requestDirectionTabActive]}
                onPress={() => chooseRequestSection('received')}
              >
                <Text style={[styles.requestDirectionText, activeTab === 'pending' && styles.requestDirectionTextActive]}>Received ({pendingRequests.length})</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.requestDirectionTab, activeTab === 'sent' && styles.requestDirectionTabActive]}
                onPress={() => chooseRequestSection('sent')}
              >
                <Text style={[styles.requestDirectionText, activeTab === 'sent' && styles.requestDirectionTextActive]}>Sent ({sentRequests.length})</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      ) : null}

      <ScrollView
        style={styles.list}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={() => {
            loadFriendsData();
            loadSplits(); // ✅ added
          }} />
        }
      >
        {renderContent()}
      </ScrollView>

      <Modal transparent visible={!!repaymentTarget} animationType="slide" onRequestClose={() => setRepaymentTarget(null)}>
        <View style={[styles.modalBackdrop, { paddingTop: Math.max(insets.top + 10, 18), paddingBottom: Math.max(insets.bottom + 10, 18) }]}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderIcon}>
                <ArrowUpRight size={21} color={colors.primary} />
              </View>
              <View style={styles.modalHeaderCopy}>
                <Text style={styles.modalEyebrow}>FRIEND SETTLEMENT</Text>
                <Text style={styles.modalTitle}>Propose repayment</Text>
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Close repayment dialog"
                style={styles.modalClose}
                onPress={() => setRepaymentTarget(null)}
                disabled={submittingRepayment}
              >
                <X size={19} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.modalBalanceHero}>
                <Text style={styles.modalHeroLabel}>OUTSTANDING WITH</Text>
                <Text style={styles.modalHeroPerson}>{repaymentTarget ? getName(repaymentTarget.userId) : ''}</Text>
                <Text style={styles.modalHeroAmount}>₹{((repaymentTarget?.maxPaise ?? 0) / 100).toFixed(2)}</Text>
                <View style={styles.modalHeroFootnoteRow}>
                  <Info size={13} color={colors.primary} />
                  <Text style={styles.modalHeroFootnote}>You can repay the full amount or send a partial payment.</Text>
                </View>
              </View>

              <View style={styles.modalFieldGroup}>
                <Text style={styles.modalFieldLabel}>PAYMENT AMOUNT</Text>
                <View style={styles.amountInputShell}>
                  <Text style={styles.currencySymbol}>₹</Text>
                  <TextInput
                    value={repaymentAmount}
                    onChangeText={setRepaymentAmount}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={colors.textLight}
                    accessibilityLabel="Repayment amount in rupees"
                    style={styles.amountInput}
                  />
                </View>
                <Text style={styles.modalHint}>Maximum payment: ₹{((repaymentTarget?.maxPaise ?? 0) / 100).toFixed(2)}</Text>
              </View>

              <View style={styles.modalSectionHeading}>
                <View style={styles.modalSectionIcon}><Wallet size={16} color={colors.primary} /></View>
                <View style={styles.modalSectionCopy}>
                  <Text style={styles.modalSectionTitle}>Pay from account</Text>
                  <Text style={styles.modalSectionCaption}>Choose the account the payment will come from.</Text>
                </View>
              </View>
              <View style={styles.modalAccountList}>
                {accounts.map((account) => {
                  const isSelected = selectedPayerAccountId === account.id;
                  const accountBalance = Number(account.balance ?? 0);
                  const hasValidBalance = Number.isFinite(accountBalance);
                  const balancePaise = Math.round(accountBalance * 100);
                  const insufficient = repaymentAmountValidForUi && (!hasValidBalance || balancePaise < repaymentAmountPaiseForUi);
                  return (
                    <TouchableOpacity
                      key={account.id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      style={[styles.accountChoice, isSelected && styles.accountChoiceSelected, insufficient && styles.accountChoiceInsufficient]}
                      onPress={() => setSelectedPayerAccountId(account.id)}
                    >
                      <View style={[styles.accountIconWrap, isSelected && styles.accountIconWrapSelected, insufficient && styles.accountIconWrapInsufficient]}>
                        <Wallet size={18} color={isSelected ? colors.primary : insufficient ? colors.expense : colors.textSecondary} />
                      </View>
                      <View style={styles.accountCopy}>
                        <Text style={styles.accountName}>{account.name}</Text>
                        <Text style={styles.accountMeta}>Available balance · ₹{(hasValidBalance ? balancePaise / 100 : 0).toFixed(2)}</Text>
                        {insufficient ? <Text style={styles.accountInsufficientText}>Not enough funds for this amount</Text> : null}
                      </View>
                      {isSelected ? <CheckCircle2 size={21} color={colors.primary} /> : <View style={styles.accountRadio} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <Text style={styles.modalFooterNote}>The payment remains pending until your friend accepts it.</Text>
              <View style={styles.modalFooterActions}>
                <TouchableOpacity style={styles.modalCancelButton} onPress={() => setRepaymentTarget(null)} disabled={submittingRepayment}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalPrimaryButton, (submittingRepayment || !repaymentAmountValidForUi || !selectedPayerHasEnoughBalance) && styles.modalButtonDisabled]}
                  onPress={submitFriendRepayment}
                  disabled={submittingRepayment || !repaymentAmountValidForUi || !selectedPayerHasEnoughBalance}
                >
                  {submittingRepayment ? <ActivityIndicator color="#FFFFFF" size="small" /> : <ArrowUpRight size={17} color="#FFFFFF" />}
                  <Text style={styles.modalPrimaryText}>{submittingRepayment ? 'Sending…' : 'Send request'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={!!acceptSettlementTarget} animationType="slide" onRequestClose={() => setAcceptSettlementTarget(null)}>
        <View style={[styles.modalBackdrop, { paddingTop: Math.max(insets.top + 10, 18), paddingBottom: Math.max(insets.bottom + 10, 18) }]}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <View style={[styles.modalHeaderIcon, styles.modalHeaderIconIncoming]}>
                <ArrowDownLeft size={21} color={colors.success} />
              </View>
              <View style={styles.modalHeaderCopy}>
                <Text style={[styles.modalEyebrow, styles.modalEyebrowIncoming]}>INCOMING PAYMENT</Text>
                <Text style={styles.modalTitle}>Choose receiving account</Text>
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Close receiving account dialog"
                style={styles.modalClose}
                onPress={() => setAcceptSettlementTarget(null)}
                disabled={acceptingSettlement}
              >
                <X size={19} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
              <View style={[styles.modalBalanceHero, styles.modalBalanceHeroIncoming]}>
                <Text style={styles.modalHeroLabel}>PAYMENT TO ACCEPT</Text>
                <Text style={styles.modalHeroPerson}>
                  {friendSettlements.find((item) => item.id === acceptSettlementTarget)
                    ? getName(friendSettlements.find((item) => item.id === acceptSettlementTarget)!.fromUserId)
                    : 'Friend settlement'}
                </Text>
                {friendSettlements.find((item) => item.id === acceptSettlementTarget) ? (
                  <Text style={[styles.modalHeroAmount, styles.modalHeroAmountIncoming]}>
                    ₹{((friendSettlements.find((item) => item.id === acceptSettlementTarget)!.amountInPaise) / 100).toFixed(2)}
                  </Text>
                ) : null}
                <View style={styles.modalHeroFootnoteRow}>
                  <Info size={13} color={colors.success} />
                  <Text style={styles.modalHeroFootnote}>Choose where to receive this payment. Accepting will record the linked entries and update the selected account balance.</Text>
                </View>
              </View>

              <View style={styles.modalSectionHeading}>
                <View style={[styles.modalSectionIcon, styles.modalSectionIconIncoming]}><Wallet size={16} color={colors.success} /></View>
                <View style={styles.modalSectionCopy}>
                  <Text style={styles.modalSectionTitle}>Receiving account</Text>
                  <Text style={styles.modalSectionCaption}>Tap an account to accept and credit the payment.</Text>
                </View>
              </View>
              <View style={styles.modalAccountList}>
                {accounts.map((account) => (
                  <TouchableOpacity
                    key={account.id}
                    accessibilityRole="button"
                    style={styles.accountChoice}
                    disabled={acceptingSettlement}
                    onPress={() => void confirmAcceptFriendSettlement(account.id)}
                  >
                    <View style={[styles.accountIconWrap, styles.accountIconWrapIncoming]}>
                      <Wallet size={18} color={colors.success} />
                    </View>
                    <View style={styles.accountCopy}>
                      <Text style={styles.accountName}>{account.name}</Text>
                      <Text style={styles.accountMeta}>Current balance · ₹{Number(account.balance || 0).toFixed(2)}</Text>
                    </View>
                    <ChevronRight size={20} color={acceptingSettlement ? colors.textLight : colors.success} />
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <Text style={styles.modalFooterNote}>Only accept payments you recognise. This action updates account balances.</Text>
              <View style={styles.modalFooterActions}>
                <TouchableOpacity style={styles.modalCancelButton} onPress={() => setAcceptSettlementTarget(null)} disabled={acceptingSettlement}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                {acceptingSettlement ? (
                  <View style={styles.modalProgress}>
                    <ActivityIndicator color={colors.primary} size="small" />
                    <Text style={styles.modalProgressText}>Accepting payment…</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({

  splitHero: { borderRadius: 24, padding: 20, marginBottom: 16, overflow: 'hidden' },
  splitHeroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  splitHeroIcon: { width: 44, height: 44, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  splitEyebrow: { color: '#D5D2FF', fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  splitHeroTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', marginTop: 6, letterSpacing: -0.4 },
  splitNetLabel: { color: '#DBD9FF', fontSize: 12, fontWeight: '600', marginTop: 21 },
  splitNetAmount: { color: '#FFFFFF', fontSize: 35, fontWeight: '800', letterSpacing: -1, marginTop: 2 },
  splitNetCaption: { color: '#E7E5FF', fontSize: 11, marginTop: 3 },
  splitOutstandingCaption: { color: '#E7E5FF', fontSize: 10, marginTop: 6, fontWeight: '600' },
  splitMetricsRow: { flexDirection: 'row', alignItems: 'stretch', marginTop: 21, paddingTop: 15, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.18)', gap: 9 },
  splitMetricTile: { flex: 1, minWidth: 0 },
  splitMetricHeading: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  splitMetricLabel: { color: '#E4E2FF', fontSize: 10, fontWeight: '600' },
  splitMetricAmount: { color: '#FFFFFF', fontSize: 12, fontWeight: '800', marginTop: 7 },
  splitMetricDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.16)', marginHorizontal: 1 },
  infoBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, padding: 14, borderRadius: 17, marginBottom: 14, backgroundColor: '#F0EFFF', borderWidth: 1, borderColor: '#E2DFFF' },
  infoBannerIcon: { width: 32, height: 32, borderRadius: 11, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  infoBannerBody: { flex: 1, gap: 4 },
  infoBannerTitle: { color: colors.text, fontSize: 12, fontWeight: '800' },
  infoBannerText: { color: colors.textSecondary, fontSize: 11, lineHeight: 17 },
  statusBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 13, borderRadius: 15, borderWidth: 1, borderColor: '#E2DFFF', backgroundColor: '#F7F6FF', marginBottom: 12 },
  statusBannerWarning: { borderColor: '#F3D9A8', backgroundColor: '#FFFAEF' },
  statusBannerError: { borderColor: '#F7C7CC', backgroundColor: '#FFF4F5' },
  statusBannerBody: { flex: 1, gap: 3 },
  statusBannerTitle: { fontSize: 12, fontWeight: '800', color: colors.text },
  statusBannerText: { fontSize: 11, lineHeight: 16, color: colors.textSecondary },
  statusBannerDetail: { fontSize: 10, color: colors.danger, marginTop: 3 },
  splitSection: { marginBottom: 15 },
  contentSectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 11, gap: 12 },
  sectionCaption: { color: colors.textSecondary, fontSize: 11, marginTop: -3 },
  sectionCountBadge: { minWidth: 28, height: 28, paddingHorizontal: 8, borderRadius: 10, backgroundColor: '#F0F1F8', alignItems: 'center', justifyContent: 'center' },
  incomingCountBadge: { backgroundColor: '#ECEBFF' },
  sectionCountText: { color: colors.textSecondary, fontSize: 11, fontWeight: '800' },
  oweCountBadge: { backgroundColor: '#FFF0F1' },
  getCountBadge: { backgroundColor: '#E8FAF2' },
  suggestionCard: { backgroundColor: colors.card, borderRadius: 18, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#E9EAF5', shadowColor: '#25224F', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.04, shadowRadius: 7, elevation: 1 },
  suggestionPersonRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  suggestionAvatar: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  suggestionAvatarOwe: { backgroundColor: '#FFF0F1' },
  suggestionAvatarGet: { backgroundColor: '#E8FAF2' },
  suggestionAvatarText: { color: colors.text, fontSize: 15, fontWeight: '800' },
  suggestionPersonCopy: { flex: 1, minWidth: 0, gap: 5 },
  suggestionName: { color: colors.text, fontSize: 13, fontWeight: '800' },
  suggestionMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  suggestionMeta: { color: colors.textSecondary, fontSize: 10, lineHeight: 14 },
  metaDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.textLight },
  suggestionAmountOwe: { color: colors.danger, fontSize: 14, fontWeight: '800' },
  suggestionAmountGet: { color: colors.success, fontSize: 14, fontWeight: '800' },
  repayButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: colors.primary, borderRadius: 13, paddingVertical: 11, marginTop: 13 },
  repayButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  obligationCard: { backgroundColor: '#FFFBF1', borderWidth: 1, borderColor: '#F4DFAE', borderRadius: 17, padding: 14, marginBottom: 10 },
  obligationTopRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  warningIcon: { width: 32, height: 32, borderRadius: 11, backgroundColor: '#FFF0CB', alignItems: 'center', justifyContent: 'center' },
  obligationCopy: { flex: 1, minWidth: 0, gap: 3 },
  obligationDetail: { color: '#866A37', fontSize: 10, lineHeight: 16, marginTop: 10 },
  emptyPanel: { backgroundColor: colors.card, borderRadius: 22, padding: 24, marginTop: 4, marginBottom: 14, alignItems: 'center', borderWidth: 1, borderColor: '#E9EAF5' },
  emptyPanelIcon: { width: 60, height: 60, borderRadius: 21, backgroundColor: '#F0EFFF', alignItems: 'center', justifyContent: 'center', marginBottom: 13 },
  emptyPanelTitle: { color: colors.text, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  emptyPanelText: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 7, maxWidth: 280 },
  emptyPanelButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: colors.primary, borderRadius: 13, paddingHorizontal: 17, paddingVertical: 11, marginTop: 16 },
  emptyPanelButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  compactEmpty: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, padding: 15, borderRadius: 15 },
  compactEmptyText: { color: colors.textSecondary, fontSize: 11, flex: 1 },
  recentSplitCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.card, borderRadius: 16, padding: 12, marginBottom: 9, borderWidth: 1, borderColor: '#E9EAF5' },
  recentSplitIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#F0EFFF', alignItems: 'center', justifyContent: 'center' },
  recentSplitCopy: { flex: 1, minWidth: 0, gap: 4 },
  recentSplitRight: { alignItems: 'flex-end', gap: 5 },
  recentSplitAmount: { color: colors.text, fontSize: 12, fontWeight: '800' },
  splitStatusPill: { backgroundColor: '#F1F2F8', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7, maxWidth: 100 },
  splitStatusText: { color: colors.textSecondary, fontSize: 8, fontWeight: '800', textTransform: 'capitalize' },
  paymentsHero: { borderRadius: 24, padding: 20, marginBottom: 18, overflow: 'hidden' },
  paymentsHeroIcon: { width: 44, height: 44, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center', marginBottom: 15 },
  paymentsHeroEyebrow: { color: '#D5D2FF', fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  paymentsHeroTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', marginTop: 5 },
  paymentsHeroSub: { color: '#E7E5FF', fontSize: 11, lineHeight: 17, marginTop: 5 },
  paymentsSummaryRow: { flexDirection: 'row', alignItems: 'center', marginTop: 19, paddingTop: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.18)' },
  paymentsSummaryItem: { flex: 1, alignItems: 'center', gap: 4 },
  paymentsSummaryNumber: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  paymentsSummaryLabel: { color: '#E7E5FF', fontSize: 10, fontWeight: '600' },
  paymentsSummaryDivider: { height: 30, width: 1, backgroundColor: 'rgba(255,255,255,0.18)' },
  paymentsSection: { marginBottom: 14 },
  paymentEmptyState: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, marginBottom: 9 },
  paymentEmptyIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#F1F2F8', alignItems: 'center', justifyContent: 'center' },
  paymentEmptyText: { flex: 1, color: colors.textSecondary, fontSize: 11, lineHeight: 16 },
  friendSettlementCard: { backgroundColor: colors.card, borderWidth: 1, borderColor: '#E9EAF5', borderRadius: 18, padding: 14, marginBottom: 10, shadowColor: '#25224F', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.035, shadowRadius: 7, elevation: 1 },
  friendSettlementTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  settlementAvatar: { width: 42, height: 42, borderRadius: 15, backgroundColor: '#ECEBFF', alignItems: 'center', justifyContent: 'center' },
  settlementAvatarText: { color: colors.primary, fontSize: 15, fontWeight: '800' },
  settlementPersonName: { color: colors.text, fontSize: 13, fontWeight: '800' },
  settlementSubText: { color: colors.textSecondary, fontSize: 10, marginTop: 4 },
  paymentStatusPill: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, maxWidth: 118 },
  paymentStatusText: { fontSize: 8, fontWeight: '800', letterSpacing: 0.25, textAlign: 'center' },
  paymentStatusIncoming: { backgroundColor: '#F0EFFF' },
  paymentStatusIncomingText: { color: colors.primary },
  paymentStatusPending: { backgroundColor: '#FFF6DF' },
  paymentStatusPendingText: { color: '#9A6B12' },
  paymentStatusAccepted: { backgroundColor: '#E8FAF2' },
  paymentStatusAcceptedText: { color: colors.success },
  paymentStatusNeutral: { backgroundColor: '#F1F2F8' },
  paymentStatusNeutralText: { color: colors.textSecondary },
  settlementNote: { marginTop: 11, color: colors.textSecondary, fontSize: 11, lineHeight: 16, backgroundColor: '#F8F8FC', borderRadius: 10, padding: 10 },
  legacyWarning: { flexDirection: 'row', gap: 7, alignItems: 'flex-start', backgroundColor: '#FFFAEF', borderRadius: 10, padding: 10, marginTop: 10 },
  legacyWarningText: { flex: 1, color: '#866A37', fontSize: 10, lineHeight: 15 },
  friendSettlementBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderTopWidth: 1, borderTopColor: '#F0F1F7', paddingTop: 12, marginTop: 13 },
  settlementAmountLabel: { color: colors.textLight, fontSize: 8, fontWeight: '800', letterSpacing: 0.8 },
  settlementAmount: { color: colors.text, fontSize: 17, fontWeight: '800', marginTop: 4 },
  settlementAmountAccepted: { color: colors.success },
  peopleContentIntro: { flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: colors.card, borderWidth: 1, borderColor: '#E9EAF5', borderRadius: 17, padding: 13, marginBottom: 13 },
  peopleIntroIcon: { width: 39, height: 39, borderRadius: 13, backgroundColor: '#F0EFFF', alignItems: 'center', justifyContent: 'center' },
  peopleIntroTitle: { color: colors.text, fontSize: 13, fontWeight: '800' },
  peopleIntroSub: { color: colors.textSecondary, fontSize: 10, lineHeight: 15, marginTop: 3 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(17, 20, 45, 0.54)', justifyContent: 'flex-end', paddingHorizontal: 14 },
  modalSheet: { maxHeight: '92%', backgroundColor: colors.background, borderRadius: 26, paddingTop: 11, paddingHorizontal: 18, paddingBottom: 15, borderWidth: 1, borderColor: '#FFFFFF', shadowColor: '#10122E', shadowOffset: { width: 0, height: -5 }, shadowOpacity: 0.12, shadowRadius: 18, elevation: 15 },
  modalHandle: { width: 42, height: 4, borderRadius: 4, alignSelf: 'center', backgroundColor: '#D7D9E8', marginBottom: 17 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 14 },
  modalHeaderIcon: { width: 45, height: 45, borderRadius: 15, backgroundColor: '#EFEEFF', alignItems: 'center', justifyContent: 'center' },
  modalHeaderIconIncoming: { backgroundColor: '#E2F8EE' },
  modalHeaderCopy: { flex: 1, minWidth: 0 },
  modalEyebrow: { color: colors.primary, fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  modalEyebrowIncoming: { color: colors.success },
  modalTitle: { color: colors.text, fontSize: 19, lineHeight: 24, fontWeight: '800', marginTop: 3 },
  modalClose: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0F1F7' },
  modalScroll: { flexShrink: 1 },
  modalBody: { paddingBottom: 8, gap: 16 },
  modalBalanceHero: { backgroundColor: '#F0EFFF', borderWidth: 1, borderColor: '#E2DFFF', borderRadius: 19, padding: 15 },
  modalBalanceHeroIncoming: { backgroundColor: '#EBF9F2', borderColor: '#D3F1E2' },
  modalHeroLabel: { color: colors.textSecondary, fontSize: 9, fontWeight: '900', letterSpacing: 0.9 },
  modalHeroPerson: { color: colors.text, fontSize: 14, fontWeight: '800', marginTop: 5 },
  modalHeroAmount: { color: colors.primary, fontSize: 29, lineHeight: 35, letterSpacing: -0.7, fontWeight: '900', marginTop: 2 },
  modalHeroAmountIncoming: { color: colors.success },
  modalHeroFootnoteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 10 },
  modalHeroFootnote: { flex: 1, color: colors.textSecondary, fontSize: 10, lineHeight: 15 },
  modalFieldGroup: { gap: 7 },
  modalFieldLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  amountInputShell: { flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1.5, borderColor: '#D8D5FF', borderRadius: 15, backgroundColor: colors.card, paddingHorizontal: 14 },
  currencySymbol: { color: colors.primary, fontSize: 23, fontWeight: '900' },
  amountInput: { flex: 1, minWidth: 0, paddingVertical: 12, color: colors.text, fontSize: 23, fontWeight: '800' },
  modalHint: { color: colors.textLight, fontSize: 10, lineHeight: 15 },
  modalSectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: -4 },
  modalSectionIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#EFEEFF', alignItems: 'center', justifyContent: 'center' },
  modalSectionIconIncoming: { backgroundColor: '#E2F8EE' },
  modalSectionCopy: { flex: 1 },
  modalSectionTitle: { color: colors.text, fontSize: 13, fontWeight: '800' },
  modalSectionCaption: { color: colors.textSecondary, fontSize: 10, lineHeight: 14, marginTop: 2 },
  modalAccountList: { gap: 8 },
  accountChoice: { flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: 1, borderColor: colors.border, borderRadius: 15, padding: 11, backgroundColor: colors.card },
  accountChoiceSelected: { borderColor: colors.primary, backgroundColor: '#F5F4FF' },
  accountChoiceInsufficient: { borderColor: '#E9A3A8', backgroundColor: '#FFF5F5' },
  accountIconWrap: { width: 39, height: 39, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0F1F8' },
  accountIconWrapSelected: { backgroundColor: '#E6E4FF' },
  accountIconWrapInsufficient: { backgroundColor: '#FCE7E8' },
  accountInsufficientText: { color: colors.expense, fontSize: 10, fontWeight: '800', marginTop: 4 },
  accountIconWrapIncoming: { backgroundColor: '#E2F8EE' },
  accountCopy: { flex: 1, minWidth: 0 },
  accountName: { color: colors.text, fontSize: 12, fontWeight: '800' },
  accountMeta: { color: colors.textSecondary, fontSize: 10, marginTop: 3 },
  accountRadio: { width: 19, height: 19, borderRadius: 10, borderWidth: 1.5, borderColor: '#C8CAD9' },
  modalFooter: { paddingTop: 11, marginTop: 10, borderTopWidth: 1, borderTopColor: '#E9EAF2', gap: 9 },
  modalFooterNote: { color: colors.textSecondary, fontSize: 10, lineHeight: 14 },
  modalFooterActions: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  modalCancelButton: { minWidth: 88, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15, paddingVertical: 13, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  modalCancelText: { color: colors.textSecondary, fontSize: 12, fontWeight: '800' },
  modalPrimaryButton: { flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15, paddingVertical: 13, borderRadius: 14, backgroundColor: colors.primary },
  modalPrimaryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  modalButtonDisabled: { opacity: 0.6 },
  modalProgress: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 11 },
  modalProgressText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
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
  title: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: colors.text,
  },
  headerCopy: { flex: 1, paddingRight: 10 },
  headerSubtitle: { marginTop: 5, color: colors.textSecondary, fontSize: 11 },
  addButton: {
    backgroundColor: colors.primary,
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryTabs: {
    flexDirection: 'row',
    marginHorizontal: 16,
    padding: 5,
    borderRadius: 19,
    backgroundColor: '#EDEFFC',
    gap: 4,
  },
  primaryTab: {
    flex: 1,
    minWidth: 0,
    minHeight: 76,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 5,
    paddingVertical: 9,
    borderRadius: 15,
  },
  primaryTabActive: {
    backgroundColor: colors.card,
    shadowColor: '#302A80',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 7,
    elevation: 2,
  },
  primaryTabText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  primaryTabTextActive: { color: colors.primary },
  primaryTabCount: { color: colors.textLight, fontSize: 10, fontWeight: '800' },
  peopleNavigation: { marginHorizontal: 16, marginTop: 12, marginBottom: 2 },
  secondaryTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  secondaryTab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderRadius: 13,
    backgroundColor: 'transparent',
  },
  secondaryTabActive: { backgroundColor: '#E8E7FF' },
  secondaryTabText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
  secondaryTabTextActive: { color: colors.primary },
  requestBadge: { minWidth: 19, height: 19, borderRadius: 10, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  requestBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  requestDirectionTabs: { flexDirection: 'row', gap: 8, marginTop: 8, paddingTop: 9, borderTopWidth: 1, borderTopColor: colors.border },
  requestDirectionTab: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 11, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  requestDirectionTabActive: { borderColor: colors.primary, backgroundColor: '#F0EFFF' },
  requestDirectionText: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  requestDirectionTextActive: { color: colors.primary },
  list: {
    paddingHorizontal: 15,
    paddingTop: 14,
  },
  tabContent: {
    flex: 1,
    paddingBottom: 18,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginTop: 16,
  },
  emptySubText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 8,
    textAlign: 'center',
  },
  noticeCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    backgroundColor: colors.card,
  },
  noticeTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
  },
  settlementCard: {
    backgroundColor: colors.card,
    padding: 14,
    borderRadius: 10,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  settlementInfo: {
    flex: 1,
    gap: 3,
  },
  settlementActions: {
    alignItems: 'flex-end',
    gap: 8,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 6,
  },
  actionButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  actionButtonText: {
    color: colors.card,
    fontSize: 12,
    fontWeight: '700',
  },
  actionButtonDisabled: { opacity: 0.65 },
  secondaryButton: {
    backgroundColor: '#F8F8FC',
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: {
    color: colors.text,
  },

  detailsBtn: {
    marginTop: 16,
    padding: 12,
    alignItems: 'center',
  },

  detailsText: {
    color: colors.primary,
    fontWeight: '600',
  },

  dashboard: {
    backgroundColor: colors.card,
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },

  dashboardText: { color: colors.textSecondary },

  dashboardNet: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 8,
  },

  settlementText: { fontWeight: '500' },

  amount: { fontWeight: '700' },

  green: {
    color: colors.success,
    fontWeight: '800',
  },

  red: {
    color: colors.danger,
    fontWeight: '800',
  },

  net: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 10,
  },

  dashboardLabel: {
    color: colors.textSecondary,
    marginTop: 6,
  },

  name: {
    color: colors.text,
    fontWeight: '700',
  },

  subText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.25,
    marginBottom: 4,
    marginTop: 10,
  },
  settleBtn: {
    marginTop: 6,
    color: colors.primary,
    fontWeight: '600',
    fontSize: 12,
  },
});

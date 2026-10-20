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
import type { FinanceAccount, FriendSettlement } from '@/types/finance';
import { buildMaps, getOutstandingObligations, type SettlementSuggestion } from '@/src/utils/splitUtils';
import { useRouter } from 'expo-router';
import { UserPlus, Users } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import {
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

export default function FriendsScreen() {
  const router = useRouter();
  const { currentProfile } = useProfile();
  const [friends, setFriends] = useState<any[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [sentRequests, setSentRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'friends' | 'pending' | 'sent' | 'splits' | 'settlements'>('friends');
  const [splits, setSplits] = useState<any[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [settlements, setSettlements] = useState<SettlementSuggestion[]>([]);
  const [outstandingTotalPaise, setOutstandingTotalPaise] = useState(0);
  const [friendSettlements, setFriendSettlements] = useState<FriendSettlement[]>([]);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [repaymentTarget, setRepaymentTarget] = useState<{ userId: string; maxPaise: number } | null>(null);
  const [repaymentAmount, setRepaymentAmount] = useState('');
  const [selectedPayerAccountId, setSelectedPayerAccountId] = useState('');
  const [acceptSettlementTarget, setAcceptSettlementTarget] = useState<string | null>(null);
  const [submittingRepayment, setSubmittingRepayment] = useState(false);
  const [acceptingSettlement, setAcceptingSettlement] = useState(false);

  const loadSplits = useCallback(async () => {
    const userId = currentProfile?.userId;
    if (!userId) return;
    try {
      const userSplits = await getUserSplits(userId);
      const splitSettlementRows = (await Promise.all(
        userSplits.map((split) => getSplitSettlements(split.id)),
      )).flat();
      const friendSettlementRows = await getFriendSettlements(userId);
      setSplits(userSplits);
      setFriendSettlements(friendSettlementRows);

      // A client can only read splits in which the current user participates.
      // Ask the trusted backend for friend-only connected-network balances and
      // directly friend-linked net suggestions across all relevant splits.
      const netLedger = await getFriendNetBalances(userId);
      setBalances(netLedger.balances);
      // The server returns max-flow matches using accepted friendship edges only.
      // Never locally simplify the unfiltered network balances: that can invent
      // suggestions between people who merely share a split.
      setSettlements(netLedger.suggestions);
      const outstanding = getOutstandingObligations(userSplits, splitSettlementRows);
      setOutstandingTotalPaise(outstanding.reduce((total, item) => total + item.amountInPaise, 0));
    } catch (error) {
      console.error('Failed to load split and settlement balances:', error);
      Alert.alert('Could not load balances', error instanceof Error ? error.message : 'Please try again.');
    }
  }, [currentProfile]);

  const friendMap = Object.fromEntries(
    friends.map((friend) => [friend.friendId, friend.profileData?.name?.trim() || 'Friend'])
  );

  const getName = (id: string) => {
    if (id === currentProfile?.userId) return 'You';
    // Do not expose raw Firebase user IDs when a profile lookup is still loading
    // or the friend has no readable profile record.
    return friendMap[id] || 'Friend';
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
    try {
      await cancelFriendSettlement({ settlementId });
      await refreshSettlementData();
    } catch (error) {
      void refreshSettlementData();
      console.error('Cancelling friend settlement failed:', error);
      Alert.alert('Could not cancel request', error instanceof Error ? error.message : 'Please try again.');
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

    const acceptedFriendIds = new Set(friends.map((friend) => String(friend.friendId)));
    const friendOnlySuggestions = settlements.filter((item) => {
      if (item.fromUserId === currentProfile.userId) return acceptedFriendIds.has(item.toUserId);
      if (item.toUserId === currentProfile.userId) return acceptedFriendIds.has(item.fromUserId);
      return false; // this screen only renders the signed-in user's own suggestions
    });
    const { oweMap, getMap } = buildMaps(friendOnlySuggestions, currentProfile.userId);

    const hasBalance = Object.values(balances).some((value) => value !== 0);

    const totalYouOwe = Object.values(oweMap).reduce((a, b) => a + b, 0);
    const totalOwed = Object.values(getMap).reduce((a, b) => a + b, 0);
    const totalSharedPaise = splits.filter((split) => split.status !== 'cancelled')
      .reduce((sum, split) => sum + split.totalAmountInPaise, 0);

    return (
      <>
        {/* 🔥 DASHBOARD */}
        <View style={styles.dashboard}>
          {/* <Text style={styles.dashboardLabel}>Total shared expenses</Text>
          <Text style={styles.name}>₹{(totalSharedPaise / 100).toFixed(2)}</Text>
          <Text style={styles.dashboardLabel}>Outstanding split obligations</Text>
          <Text style={styles.name}>₹{(outstandingTotalPaise / 100).toFixed(2)}</Text> */}
          <Text style={styles.dashboardLabel}>You get</Text>
          <Text style={styles.green}>₹{(totalOwed / 100).toFixed(2)}</Text>

          <Text style={styles.dashboardLabel}>You owe</Text>
          <Text style={styles.red}>₹{(totalYouOwe / 100).toFixed(2)}</Text>

          <Text style={styles.net}>
            Net ₹{((totalOwed - totalYouOwe) / 100).toFixed(2)}
          </Text>
        </View>

        <Text style={styles.subText}>Suggestions are limited to people who are currently accepted friends. Debts involving non-friends remain on their split and are excluded here. Propose a partial or full payment; the recipient selects a receiving account and accepts before ledger and account balances change.</Text>

        {/* 🔴 YOU OWE */}
        {Object.entries(oweMap).length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Suggested net payments — you owe</Text>

            {Object.entries(oweMap).map(([userId, amount]) => (
              <View key={userId} style={styles.settlementCard}>
                <View>
                  <Text style={styles.name}>{getName(userId)}</Text>
                  <Text style={styles.subText}>You owe</Text>
                </View>

                <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
                  <Text style={styles.red}>₹{(amount / 100).toFixed(2)}</Text>
                  <TouchableOpacity onPress={() => openFriendRepayment(userId, amount)}>
                    <Text style={styles.settleBtn}>Repay / partial</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </>
        )}

        {/* 🟢 YOU GET */}
        {Object.entries(getMap).length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Suggested net payments — you receive</Text>

            {Object.entries(getMap).map(([userId, amount]) => (
              <View key={userId} style={styles.settlementCard}>
                <View>
                  <Text style={styles.name}>{getName(userId)}</Text>
                  <Text style={styles.subText}>You get</Text>
                </View>

                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.green}>₹{(amount / 100).toFixed(2)}</Text>
                </View>
              </View>
            ))}
          </>
        )}

        {/* 🎉 ALL SETTLED */}
        {!hasBalance && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>All settled 🎉</Text>
          </View>
        )}
        <Text style={styles.sectionTitle}>Recent splits</Text>
        {splits.slice(0, 10).map((split) => (
          <TouchableOpacity key={split.id} style={styles.settlementCard} onPress={() => router.push(`/splits/${split.id}`)}>
            <View>
              <Text style={styles.name}>{split.title || 'Shared expense'}</Text>
              {/* <Text style={styles.subText}>{String(split.status || 'pending').replaceAll('_', ' ')}</Text> */}
            </View>
            <Text style={styles.name}>₹{(split.totalAmountInPaise / 100).toFixed(2)}</Text>
          </TouchableOpacity>
        ))}
      </>
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
    const empty = (message: string) => <Text style={styles.subText}>{message}</Text>;
    const card = (item: FriendSettlement, direction: 'incoming' | 'outgoing' | 'history') => (
      <View key={item.id} style={styles.settlementCard}>
        <View style={styles.settlementInfo}>
          <Text style={styles.name}>{direction === 'incoming' ? getName(item.fromUserId) : getName(item.toUserId)}</Text>
          <Text style={styles.subText}>
            {direction === 'incoming' ? 'Proposed by friend' : direction === 'outgoing' ? 'Waiting for acceptance' : `Status: ${item.status}`}
          </Text>
          {item.note ? <Text style={styles.subText}>{item.note}</Text> : null}
          {direction === 'incoming' && (!item.fromProfileId || !item.fromAccountId)
            ? <Text style={styles.subText}>This older request has no funding account. Dismiss it and ask the sender to resend with an account selected.</Text>
            : null}
        </View>
        <View style={styles.settlementActions}>
          <Text style={item.status === 'accepted' ? styles.green : styles.name}>₹{(item.amountInPaise / 100).toFixed(2)}</Text>
          {direction === 'incoming' ? (
            <View style={styles.actionRow}>
              {item.fromProfileId && item.fromAccountId ? (
                <TouchableOpacity onPress={() => handleAcceptFriendSettlement(item.id)} style={styles.actionButton}>
                  <Text style={styles.actionButtonText}>Accept</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity onPress={() => handleRejectFriendSettlement(item.id)} style={[styles.actionButton, styles.secondaryButton]}>
                <Text style={[styles.actionButtonText, styles.secondaryButtonText]}>{item.fromProfileId && item.fromAccountId ? 'Reject' : 'Dismiss old request'}</Text>
              </TouchableOpacity>
            </View>
          ) : direction === 'outgoing' ? (
            <TouchableOpacity onPress={() => handleCancelFriendSettlement(item.id)} style={[styles.actionButton, styles.secondaryButton]}>
              <Text style={[styles.actionButtonText, styles.secondaryButtonText]}>Cancel request</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );

    return (
      <View style={styles.tabContent}>
        <Text style={styles.sectionTitle}>Incoming requests ({incoming.length})</Text>
        {incoming.length === 0 ? empty('No payment requests waiting for your acceptance.') : incoming.map((item) => card(item, 'incoming'))}
        <Text style={styles.sectionTitle}>Sent requests ({outgoing.length})</Text>
        {outgoing.length === 0 ? empty('You have no pending settlement requests.') : outgoing.map((item) => card(item, 'outgoing'))}
        <Text style={styles.sectionTitle}>History ({history.length})</Text>
        {history.length === 0 ? empty('Accepted, rejected, and cancelled requests will appear here.') : history.slice(0, 30).map((item) => card(item, 'history'))}
      </View>
    );
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
            {pendingRequests.length === 0 ? (
              <View style={styles.emptyState}>
                <Users size={48} color={colors.textSecondary} />
                <Text style={styles.emptyText}>No pending requests</Text>
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
            {sentRequests.length === 0 ? (
              <View style={styles.emptyState}>
                <Users size={48} color={colors.textSecondary} />
                <Text style={styles.emptyText}>No sent requests</Text>
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
            {friends.length === 0 ? (
              <View style={styles.emptyState}>
                <Users size={48} color={colors.textSecondary} />
                <Text style={styles.emptyText}>No friends yet</Text>
                <Text style={styles.emptySubText}>Send a connection request to get started</Text>
              </View>
            ) : (
              friends.map((friend) => (
                <FriendCard
                  key={friend.id}
                  friendName={friend.profileData?.name || friend.friendId}
                  friendId={friend.friendId}
                  onRemove={() =>
                    handleRemoveFriend(friend.friendId, friend.profileData?.name || friend.friendId)
                  }
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
      <View style={styles.header}>
        <Text style={styles.title}>Friends</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={navigateToAddFriend}
        >
          <UserPlus color={colors.card} size={24} />
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar} contentContainerStyle={styles.tabBarContent}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'friends' && styles.activeTab]}
          onPress={() => setActiveTab('friends')}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'friends' && styles.activeTabText,
            ]}
          >
            Friends ({friends.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'pending' && styles.activeTab]}
          onPress={() => setActiveTab('pending')}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'pending' && styles.activeTabText,
            ]}
          >
            Pending ({pendingRequests.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'sent' && styles.activeTab]}
          onPress={() => setActiveTab('sent')}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'sent' && styles.activeTabText,
            ]}
          >
            Sent ({sentRequests.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'splits' && styles.activeTab]}
          onPress={() => setActiveTab('splits')}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'splits' && styles.activeTabText,
            ]}
          >
            Splits ({splits.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'settlements' && styles.activeTab]}
          onPress={() => setActiveTab('settlements')}
        >
          <Text style={[styles.tabText, activeTab === 'settlements' && styles.activeTabText]}>
            Payments ({friendSettlements.filter((item) => item.status === 'pending' && item.toUserId === currentProfile?.userId).length})
          </Text>
        </TouchableOpacity>
      </ScrollView>

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

      <Modal transparent visible={!!repaymentTarget} animationType="fade" onRequestClose={() => setRepaymentTarget(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.sectionTitle}>Propose repayment</Text>
            <Text style={styles.subText}>To {repaymentTarget ? getName(repaymentTarget.userId) : ''}. Outstanding: ₹{((repaymentTarget?.maxPaise ?? 0) / 100).toFixed(2)}. You can pay part of it.</Text>
            <TextInput
              value={repaymentAmount}
              onChangeText={setRepaymentAmount}
              keyboardType="decimal-pad"
              placeholder="Amount (₹)"
              style={styles.amountInput}
            />
            <Text style={styles.subText}>Pay from account</Text>
            {accounts.map((account) => (
              <TouchableOpacity
                key={account.id}
                style={[styles.accountChoice, selectedPayerAccountId === account.id && styles.accountChoiceSelected]}
                onPress={() => setSelectedPayerAccountId(account.id)}
              >
                <Text style={styles.name}>{account.name}</Text>
                <Text style={styles.subText}>Balance ₹{Number(account.balance || 0).toFixed(2)}{selectedPayerAccountId === account.id ? ' · Selected' : ''}</Text>
              </TouchableOpacity>
            ))}
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setRepaymentTarget(null)} disabled={submittingRepayment}><Text style={styles.subText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={submitFriendRepayment} disabled={submittingRepayment}><Text style={styles.settleBtn}>{submittingRepayment ? 'Sending…' : 'Send request'}</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={!!acceptSettlementTarget} animationType="fade" onRequestClose={() => setAcceptSettlementTarget(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.sectionTitle}>Choose receiving account</Text>
            <Text style={styles.subText}>The accepted payment will be recorded as income and credited to the account you select.</Text>
            {accounts.map((account) => (
              <TouchableOpacity
                key={account.id}
                style={styles.accountChoice}
                disabled={acceptingSettlement}
                onPress={() => void confirmAcceptFriendSettlement(account.id)}
              >
                <Text style={styles.name}>{account.name}</Text>
                <Text style={styles.subText}>Balance ₹{Number(account.balance || 0).toFixed(2)}</Text>
              </TouchableOpacity>
            ))}
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setAcceptSettlementTarget(null)} disabled={acceptingSettlement}><Text style={styles.subText}>Cancel</Text></TouchableOpacity>
              {acceptingSettlement ? <Text style={styles.settleBtn}>Accepting…</Text> : null}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: colors.background, borderRadius: 14, padding: 20, gap: 12 },
  accountChoice: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, gap: 3 },
  accountChoiceSelected: { borderColor: colors.primary, backgroundColor: colors.primary + '12' },
  amountInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: colors.text },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 24, marginTop: 8 },
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
    fontWeight: '700',
    color: colors.text,
  },
  addButton: {
    backgroundColor: colors.primary,
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabBar: {
    flexGrow: 0,
    flexShrink: 0,
    height: 50,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  tabBarContent: {
    flexDirection: 'row',
    paddingHorizontal: 12,
  },
  tab: {
    minWidth: 88,
    paddingVertical: 12,
    paddingHorizontal: 10,
    marginHorizontal: 3,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    alignItems: 'center',
  },
  activeTab: {
    borderBottomColor: colors.primary,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  activeTabText: {
    color: colors.primary,
  },
  list: {
    padding: 16,
  },
  tabContent: {
    flex: 1,
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
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  actionButtonText: {
    color: colors.card,
    fontSize: 12,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
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
    color: '#16a34a',
    fontWeight: '700',
  },

  red: {
    color: '#dc2626',
    fontWeight: '700',
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
    fontWeight: '600',
  },

  subText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  sectionTitle: {
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 16,
  },
  settleBtn: {
    marginTop: 6,
    color: colors.primary,
    fontWeight: '600',
    fontSize: 12,
  },
});

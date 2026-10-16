import FriendCard from '@/src/components/finance/FriendCard';
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
import { getSplitSettlements, getUserSplits } from '@/src/services/firebase/splitService';
import { buildMaps, calculateNetBalances, getOutstandingObligations, simplifyDebts } from '@/src/utils/splitUtils';
import { useRouter } from 'expo-router';
import { UserPlus, Users } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import {
    Alert,
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
  const [activeTab, setActiveTab] = useState<'friends' | 'pending' | 'sent' | 'splits'>('friends');
  const [splits, setSplits] = useState<any[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [settlements, setSettlements] = useState<any[]>([]);
  const [outstandingTotalPaise, setOutstandingTotalPaise] = useState(0);

  // const mergeSettlements = (settlements: any[], currentUser: string) => {
  //   const oweMap: Record<string, number> = {};
  //   const getMap: Record<string, number> = {};

  //   settlements.forEach((s) => {
  //     if (s.from === currentUser) {
  //       oweMap[s.to] = (oweMap[s.to] || 0) + s.amount;
  //     } else if (s.to === currentUser) {
  //       getMap[s.from] = (getMap[s.from] || 0) + s.amount;
  //     }
  //   });

  //   return { oweMap, getMap };
  // };

  const loadSplits = useCallback(async () => {
    if (!currentProfile?.userId) return;
    const data = await getUserSplits(currentProfile!.userId);
    setSplits(data);
    const settlementRows = (await Promise.all(data.map((split) => getSplitSettlements(split.id)))).flat();
    const result = calculateNetBalances(data, settlementRows);
    setBalances(result);
    setOutstandingTotalPaise(getOutstandingObligations(data, settlementRows).reduce((sum, item) => sum + item.amountInPaise, 0));

    const simplified = simplifyDebts(result);
    setSettlements(simplified);
  }, [currentProfile]);

  const friendMap = Object.fromEntries(
    friends.map(f => [f.friendId, f.profileData?.name || f.friendId])
  );

  const getName = (id: string) => {
    if (id === currentProfile?.userId) return 'You';
    return friendMap[id] || id;
  };

  const loadFriendsData = useCallback(async () => {
    if (!currentProfile?.userId) return;

    setLoading(true);
    try {
      const [friendsList, pendingList, sentList] = await Promise.all([
        getUserFriends(currentProfile!.userId),
        getPendingRequests(currentProfile!.userId),
        getSentRequests(currentProfile!.userId),
      ]);

      setFriends(friendsList);
      setPendingRequests(pendingList);
      setSentRequests(sentList);
    } catch (error) {
      console.error('Error loading friends data:', error);
      Alert.alert('Error', 'Failed to load friends data');
    } finally {
      setLoading(false);
    }
  }, [currentProfile]);

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
    if (splits.length === 0) {
      return (
        <View style={styles.emptyState}>
          <Users size={48} color={colors.textSecondary} />
          <Text style={styles.emptyText}>No splits yet</Text>
        </View>
      );
    }
    if (!currentProfile) return null;

    const { oweMap, getMap } = buildMaps(
      settlements,
      currentProfile.userId
    );

    const hasBalance = Object.values(balances).some((value) => value !== 0);

    const totalYouOwe = Object.values(oweMap).reduce((a, b) => a + b, 0);
    const totalOwed = Object.values(getMap).reduce((a, b) => a + b, 0);
    const totalSharedPaise = splits.filter((split) => split.status !== 'cancelled')
      .reduce((sum, split) => sum + split.totalAmountInPaise, 0);

    return (
      <>
        {/* 🔥 DASHBOARD */}
        <View style={styles.dashboard}>
          <Text style={styles.dashboardLabel}>Total shared expenses</Text>
          <Text style={styles.name}>₹{(totalSharedPaise / 100).toFixed(2)}</Text>
          <Text style={styles.dashboardLabel}>Outstanding split obligations</Text>
          <Text style={styles.name}>₹{(outstandingTotalPaise / 100).toFixed(2)}</Text>
          <Text style={styles.dashboardLabel}>You get</Text>
          <Text style={styles.green}>₹{(totalOwed / 100).toFixed(2)}</Text>

          <Text style={styles.dashboardLabel}>You owe</Text>
          <Text style={styles.red}>₹{(totalYouOwe / 100).toFixed(2)}</Text>

          <Text style={styles.net}>
            Net ₹{((totalOwed - totalYouOwe) / 100).toFixed(2)}
          </Text>
        </View>

        <Text style={styles.subText}>Net settlement suggestions simplify balances across splits; they do not record a payment. Repayments are submitted and approved in each split.</Text>

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

                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.red}>₹{(amount / 100).toFixed(2)}</Text>
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
              <Text style={styles.subText}>{String(split.status || 'pending').replaceAll('_', ' ')}</Text>
            </View>
            <Text style={styles.name}>₹{(split.totalAmountInPaise / 100).toFixed(2)}</Text>
          </TouchableOpacity>
        ))}
      </>
    );
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'splits':
        return renderSplits();
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

      <View style={styles.tabBar}>
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
      </View>

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
    </View>
  );
}

const styles = StyleSheet.create({
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
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginHorizontal: 4,
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

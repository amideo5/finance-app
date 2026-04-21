import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import { db } from '@/src/firebaseConfig';
import {
    getSentRequests,
    getUserFriends,
    sendFriendRequest,
} from '@/src/services/firebase/friendsService';
import { useRouter } from 'expo-router';
import { collection, getDocs } from 'firebase/firestore';
import { ArrowLeft, CheckCircle, Clock, Search } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

export default function AddFriendScreen() {
  const router = useRouter();
  const { currentProfile } = useProfile();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [sentRequests, setSentRequests] = useState<string[]>([]);
  const [existingFriends, setExistingFriends] = useState<string[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);

  // Load existing friends and sent requests on mount
  useEffect(() => {
    if (currentProfile?.userId) {
      loadInitialData();
    }
  }, [currentProfile?.userId]);

  const loadInitialData = async () => {
    if (!currentProfile?.userId) return;

    try {
      const [friendsList, sentList] = await Promise.all([
        getUserFriends(currentProfile.userId),
        getSentRequests(currentProfile.userId),
      ]);

      // Extract friend IDs
      const friendIds = friendsList.map((f: any) => f.friendId);
      setExistingFriends(friendIds);

      // Extract user IDs from sent requests
      const sentUserIds = sentList.map((r: any) => r.toUserId);
      setSentRequests(sentUserIds);
    } catch (error) {
      console.error('Error loading initial data:', error);
    } finally {
      setInitialLoading(false);
    }
  };

  const handleSearch = async (text: string) => {
    setSearchQuery(text);

    if (text.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    setLoading(true);
    try {
      // Fetch all profiles (or use a range query for performance)
      const usersRef = collection(db, 'profiles');
      const snapshot = await getDocs(usersRef);
      const searchLower = text.toLowerCase();
      const results = snapshot.docs
        .map((doc) => ({
          id: doc.id,
          userId: doc.data().userId,
          name: doc.data().name,
          ...doc.data(),
        }))
        .filter((profile) => {
          if (profile.userId === currentProfile?.userId) return false;
          if (!profile.name) return false;
          // Case-insensitive, partial match (at least 2 letters)
          return profile.name.toLowerCase().includes(searchLower) && searchLower.length >= 2;
        });

      setSearchResults(results);
    } catch (error) {
      console.error('Error searching users:', error);
      Alert.alert('Error', 'Failed to search users');
    } finally {
      setLoading(false);
    }
  };

  const handleSendRequest = async (userId: string, name: string) => {
    if (!currentProfile?.userId) return;

    try {
      await sendFriendRequest(currentProfile.userId, userId);
      setSentRequests([...sentRequests, userId]);
      Alert.alert('Success', `Friend request sent to ${name}`);
    } catch (error) {
      console.error('Error sending friend request:', error);
      Alert.alert('Error', 'Failed to send friend request');
    }
  };

  const getButtonStatus = (userId: string) => {
    if (existingFriends.includes(userId)) {
      return 'friend';
    }
    if (sentRequests.includes(userId)) {
      return 'requested';
    }
    return 'add';
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <ArrowLeft color={colors.text} size={24} />
        </TouchableOpacity>
        <Text style={styles.title}>Add Friends</Text>
        <View style={styles.spacer} />
      </View>

      <View style={styles.searchContainer}>
        <Search size={20} color={colors.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name..."
          placeholderTextColor={colors.textSecondary}
          value={searchQuery}
          onChangeText={handleSearch}
        />
      </View>

      {(loading || initialLoading) && <ActivityIndicator color={colors.primary} size="large" />}

      <ScrollView style={styles.list}>
        {searchResults.length === 0 && searchQuery && !loading && !initialLoading && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No users found</Text>
          </View>
        )}

        {searchResults.map((user) => {
          const status = getButtonStatus(user.userId);
          const isDisabled = status === 'friend' || status === 'requested';

          return (
            <View key={user.id} style={styles.userCard}>
              <View style={styles.userInfo}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {user.name?.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.userName}>{user.name}</Text>
                </View>
              </View>

              <View style={styles.buttonContainer}>
                {status === 'friend' && (
                  <View style={[styles.statusBadge, styles.friendBadge]}>
                    <CheckCircle size={16} color={colors.success} />
                    <Text style={[styles.statusText, styles.friendText]}>Friends</Text>
                  </View>
                )}
                {status === 'requested' && (
                  <View style={[styles.statusBadge, styles.requestedBadge]}>
                    <Clock size={16} color={colors.warning} />
                    <Text style={[styles.statusText, styles.requestedText]}>Pending</Text>
                  </View>
                )}
                {status === 'add' && (
                  <TouchableOpacity
                    style={styles.requestButton}
                    onPress={() => handleSendRequest(user.userId, user.name)}
                  >
                    <Text style={styles.requestButtonText}>Add</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })}
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
    padding: 16,
    paddingTop: 48,
  },
  spacer: {
    width: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginHorizontal: 16,
    marginBottom: 24,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    fontSize: 16,
    color: colors.text,
  },
  list: {
    paddingHorizontal: 16,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  userCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: colors.card,
    fontSize: 16,
    fontWeight: '600',
  },
  userName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  buttonContainer: {
    marginLeft: 8,
  },
  requestButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  requestButtonText: {
    color: colors.card,
    fontWeight: '600',
    fontSize: 14,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 6,
  },
  friendBadge: {
    backgroundColor: '#E8F5E9',
  },
  friendText: {
    color: colors.success,
    fontWeight: '500',
    fontSize: 13,
  },
  requestedBadge: {
    backgroundColor: '#FFF3E0',
  },
  requestedText: {
    color: colors.warning,
    fontWeight: '500',
    fontSize: 13,
  },
  statusText: {
    fontWeight: '500',
  },
});

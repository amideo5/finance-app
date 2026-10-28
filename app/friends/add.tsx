import { colors } from '@/src/constants/colors';
import { useProfile } from '@/src/context/ProfileContext';
import {
  getSentRequests,
  getUserFriends,
  sendFriendRequest,
} from '@/src/services/firebase/friendsService';
import { searchProfilesByName } from '@/src/services/firebase/profilesService';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock3,
  Search,
  Sparkles,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function AddFriendScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { currentProfile } = useProfile();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [sentRequests, setSentRequests] = useState<string[]>([]);
  const [existingFriends, setExistingFriends] = useState<string[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);

  const loadInitialData = useCallback(async () => {
    if (!currentProfile?.userId) {
      setInitialLoading(false);
      return;
    }

    setInitialLoading(true);
    try {
      const [friendsList, sentList] = await Promise.all([
        getUserFriends(currentProfile.userId),
        getSentRequests(currentProfile.userId),
      ]);

      setExistingFriends(friendsList.map((friend: any) => friend.friendId));
      setSentRequests(sentList.map((request: any) => request.toUserId));
    } catch (error) {
      console.error('Error loading initial data:', error);
    } finally {
      setInitialLoading(false);
    }
  }, [currentProfile?.userId]);

  useEffect(() => {
    // Refresh relationship state whenever the active profile changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadInitialData();
  }, [loadInitialData]);

  const handleSearch = async (text: string) => {
    setSearchQuery(text);

    if (text.trim().length < 2) {
      setSearchResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const results = (await searchProfilesByName(text) as any[]).filter((profile) =>
        profile.userId !== currentProfile?.userId && Boolean(profile.name)
      );
      setSearchResults(results);
    } catch (error) {
      console.error('Error searching users:', error);
      Alert.alert('Search unavailable', 'We could not search for people right now. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSendRequest = async (userId: string, name: string) => {
    if (!currentProfile?.userId) return;

    try {
      await sendFriendRequest(currentProfile.userId, userId);
      setSentRequests((previous) => previous.includes(userId) ? previous : [...previous, userId]);
      Alert.alert('Request sent', `Your friend request has been sent to ${name}.`);
    } catch (error) {
      console.error('Error sending friend request:', error);
      Alert.alert('Could not send request', 'Please try again in a moment.');
    }
  };

  const getButtonStatus = (userId: string) => {
    if (existingFriends.includes(userId)) return 'friend';
    if (sentRequests.includes(userId)) return 'requested';
    return 'add';
  };

  const trimmedQuery = searchQuery.trim();
  const canSearch = trimmedQuery.length >= 2;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top + 8, 18) }]}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Go back"
          activeOpacity={0.75}
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <ArrowLeft color={colors.text} size={21} />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>GROW YOUR CIRCLE</Text>
          <Text style={styles.title}>Add friends</Text>
        </View>
        <View style={styles.headerIcon}>
          <UsersRound color={colors.primary} size={22} />
        </View>
      </View>

      <LinearGradient
        colors={['#29265E', '#5146D8', '#7168F7']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.hero}
      >
        <View style={styles.heroCopy}>
          <View style={styles.heroEyebrowRow}>
            <Sparkles size={13} color="#DED9FF" />
            <Text style={styles.heroEyebrow}>BETTER TOGETHER</Text>
          </View>
          <Text style={styles.heroTitle}>Money is easier with friends.</Text>
          <Text style={styles.heroSubtitle}>Connect with people to share expenses and keep repayments organized.</Text>
        </View>
        <View style={styles.heroPeopleIcon}>
          <UsersRound size={27} color="#FFFFFF" />
        </View>
      </LinearGradient>

      <View style={styles.searchSection}>
        <View style={[styles.searchContainer, canSearch && styles.searchContainerActive]}>
          <View style={styles.searchIconWrap}>
            <Search size={19} color={colors.primary} />
          </View>
          <TextInput
            style={styles.searchInput}
            placeholder="Search people by name"
            placeholderTextColor={colors.textLight}
            value={searchQuery}
            onChangeText={handleSearch}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search people by name"
          />
          {searchQuery.length > 0 ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => {
                setSearchQuery('');
                setSearchResults([]);
                setLoading(false);
              }}
              style={styles.clearSearch}
            >
              <X size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>
        <Text style={styles.searchHint}>
          {canSearch ? 'Search results update as you type' : 'Enter at least 2 characters to find people'}
        </Text>
      </View>

      <ScrollView
        style={styles.list}
        contentContainerStyle={[styles.listContent, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {(initialLoading || loading) ? (
          <View style={styles.loadingCard}>
            <View style={styles.loadingIcon}>
              <ActivityIndicator color={colors.primary} size="small" />
            </View>
            <View style={styles.loadingCopy}>
              <Text style={styles.loadingTitle}>{initialLoading ? 'Preparing your connections' : 'Finding people'}</Text>
              <Text style={styles.loadingSubtitle}>{initialLoading ? 'Checking existing friends and requests…' : `Searching for “${trimmedQuery}”…`}</Text>
            </View>
          </View>
        ) : null}

        {!initialLoading && !loading && !canSearch ? (
          <View style={styles.discoveryCard}>
            <View style={styles.discoveryIllustration}>
              <View style={styles.avatarBubbleOne}><Text style={styles.avatarBubbleText}>A</Text></View>
              <View style={styles.discoveryMainIcon}><UsersRound size={31} color={colors.primary} /></View>
              <View style={styles.avatarBubbleTwo}><Text style={styles.avatarBubbleText}>+</Text></View>
            </View>
            <Text style={styles.discoveryTitle}>Find your people</Text>
            <Text style={styles.discoveryText}>Search by someone’s name to connect. Once they accept, you can include them in shared expenses and splits.</Text>
            <View style={styles.discoveryTip}>
              <Search size={15} color={colors.primary} />
              <Text style={styles.discoveryTipText}>Try a first name or full name</Text>
            </View>
          </View>
        ) : null}

        {!initialLoading && !loading && canSearch && searchResults.length > 0 ? (
          <View style={styles.resultsHeader}>
            <View>
              <Text style={styles.resultsTitle}>People you can connect with</Text>
              <Text style={styles.resultsSubtitle}>{searchResults.length} {searchResults.length === 1 ? 'profile' : 'profiles'} found</Text>
            </View>
            <View style={styles.resultsPill}>
              <UsersRound size={13} color={colors.primary} />
              <Text style={styles.resultsPillText}>{searchResults.length}</Text>
            </View>
          </View>
        ) : null}

        {!initialLoading && !loading && canSearch && searchResults.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}><Search size={25} color={colors.primary} /></View>
            <Text style={styles.emptyTitle}>No people found</Text>
            <Text style={styles.emptyText}>We couldn’t find anyone matching “{trimmedQuery}”. Check the spelling or try another name.</Text>
            <TouchableOpacity style={styles.tryAgainButton} onPress={() => handleSearch(searchQuery)}>
              <Text style={styles.tryAgainText}>Search again</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {searchResults.map((user) => {
          const status = getButtonStatus(user.userId);
          const userName = String(user.name || 'Finance member').trim();
          const initial = userName.charAt(0).toUpperCase() || '?';

          return (
            <View key={user.id || user.userId} style={styles.userCard}>
              <View style={styles.userInfo}>
                <LinearGradient
                  colors={['#E8E7FF', '#D8D5FF']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.avatar}
                >
                  <Text style={styles.avatarText}>{initial}</Text>
                </LinearGradient>
                <View style={styles.userCopy}>
                  <Text style={styles.userName} numberOfLines={1}>{userName}</Text>
                  <Text style={styles.userSubtitle} numberOfLines={1}>
                    {status === 'friend' ? 'Already in your circle' : status === 'requested' ? 'Request sent · awaiting response' : 'Connect to share expenses'}
                  </Text>
                </View>
              </View>

              <View style={styles.buttonContainer}>
                {status === 'friend' ? (
                  <View style={[styles.statusBadge, styles.friendBadge]}>
                    <CheckCircle2 size={15} color={colors.success} />
                    <Text style={[styles.statusText, styles.friendText]}>Friends</Text>
                  </View>
                ) : status === 'requested' ? (
                  <View style={[styles.statusBadge, styles.requestedBadge]}>
                    <Clock3 size={15} color="#B7791F" />
                    <Text style={[styles.statusText, styles.requestedText]}>Pending</Text>
                  </View>
                ) : (
                  <TouchableOpacity
                    activeOpacity={0.82}
                    style={styles.requestButton}
                    onPress={() => void handleSendRequest(user.userId, userName)}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${userName} as a friend`}
                  >
                    <UserPlus size={15} color="#FFFFFF" />
                    <Text style={styles.requestButtonText}>Add</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })}

        {!initialLoading && !loading && canSearch && searchResults.length > 0 ? (
          <View style={styles.footerHint}>
            <Check size={14} color={colors.textSecondary} />
            <Text style={styles.footerHintText}>You’ll see a status here when a request is already sent or a friendship is active.</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 17,
    gap: 12,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerCopy: { flex: 1 },
  eyebrow: { color: colors.primary, fontSize: 9, fontWeight: '800', letterSpacing: 1.45, marginBottom: 3 },
  title: { fontSize: 25, fontWeight: '800', color: colors.text, letterSpacing: -0.6 },
  headerIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#E9E7FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    marginHorizontal: 16,
    borderRadius: 22,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    shadowColor: '#3E36A8',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 14,
    elevation: 4,
  },
  heroCopy: { flex: 1, paddingRight: 10 },
  heroEyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 9 },
  heroEyebrow: { color: '#DED9FF', fontSize: 9, fontWeight: '800', letterSpacing: 1.25 },
  heroTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', letterSpacing: -0.45, lineHeight: 25 },
  heroSubtitle: { color: '#E5E3FF', fontSize: 12, lineHeight: 18, marginTop: 7, maxWidth: 270 },
  heroPeopleIcon: {
    width: 54,
    height: 54,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchSection: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 5 },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 17,
    minHeight: 56,
    paddingHorizontal: 10,
    shadowColor: '#29265E',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.035,
    shadowRadius: 8,
    elevation: 1,
  },
  searchContainerActive: { borderColor: '#B9B4FF' },
  searchIconWrap: {
    width: 35,
    height: 35,
    borderRadius: 11,
    backgroundColor: '#F0EFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchInput: { flex: 1, paddingVertical: 12, paddingHorizontal: 10, fontSize: 15, color: colors.text },
  clearSearch: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F2F3F8' },
  searchHint: { color: colors.textLight, fontSize: 11, marginTop: 8, marginLeft: 4 },
  list: { flex: 1, marginTop: 8 },
  listContent: { paddingHorizontal: 16, paddingTop: 5, flexGrow: 1 },
  loadingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
  },
  loadingIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#F0EFFF', alignItems: 'center', justifyContent: 'center' },
  loadingCopy: { flex: 1, gap: 3 },
  loadingTitle: { color: colors.text, fontWeight: '700', fontSize: 14 },
  loadingSubtitle: { color: colors.textSecondary, fontSize: 12 },
  discoveryCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 24,
    paddingTop: 27,
    paddingBottom: 23,
    marginTop: 8,
  },
  discoveryIllustration: { width: 124, height: 104, alignItems: 'center', justifyContent: 'center', marginBottom: 9 },
  discoveryMainIcon: {
    width: 73,
    height: 73,
    borderRadius: 25,
    backgroundColor: '#F0EFFF',
    borderWidth: 1,
    borderColor: '#E3E1FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBubbleOne: { position: 'absolute', left: 2, top: 7, width: 32, height: 32, borderRadius: 16, backgroundColor: '#D7F7E9', alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  avatarBubbleTwo: { position: 'absolute', right: 1, bottom: 3, width: 34, height: 34, borderRadius: 17, backgroundColor: '#FFE8D8', alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  avatarBubbleText: { color: colors.text, fontWeight: '800', fontSize: 13 },
  discoveryTitle: { color: colors.text, fontSize: 18, fontWeight: '800', letterSpacing: -0.25, marginTop: 2 },
  discoveryText: { color: colors.textSecondary, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 8, maxWidth: 305 },
  discoveryTip: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, backgroundColor: '#F2F1FF', marginTop: 16 },
  discoveryTipText: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  resultsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 9, marginBottom: 12 },
  resultsTitle: { color: colors.text, fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  resultsSubtitle: { color: colors.textSecondary, fontSize: 11, marginTop: 3 },
  resultsPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 11, backgroundColor: '#ECEBFF' },
  resultsPillText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 13,
    marginBottom: 10,
    gap: 10,
  },
  userInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  avatar: { width: 48, height: 48, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarText: { color: colors.primaryDark, fontSize: 19, fontWeight: '800' },
  userCopy: { flex: 1, minWidth: 0, gap: 4 },
  userName: { color: colors.text, fontSize: 14, fontWeight: '800' },
  userSubtitle: { color: colors.textSecondary, fontSize: 10.5, lineHeight: 14 },
  buttonContainer: { marginLeft: 2, alignItems: 'flex-end' },
  requestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minWidth: 78,
    backgroundColor: colors.primary,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 12,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 5,
    elevation: 2,
  },
  requestButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 9, borderRadius: 11, gap: 5 },
  friendBadge: { backgroundColor: '#E6F8EF' },
  friendText: { color: '#138557' },
  requestedBadge: { backgroundColor: '#FFF3D9' },
  requestedText: { color: '#9A6700' },
  statusText: { fontWeight: '800', fontSize: 11 },
  emptyState: { alignItems: 'center', paddingHorizontal: 25, paddingTop: 32, paddingBottom: 30, backgroundColor: colors.card, borderRadius: 21, borderWidth: 1, borderColor: colors.border, marginTop: 8 },
  emptyIconWrap: { width: 60, height: 60, borderRadius: 20, backgroundColor: '#F0EFFF', alignItems: 'center', justifyContent: 'center', marginBottom: 13 },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: '800' },
  emptyText: { color: colors.textSecondary, fontSize: 12, textAlign: 'center', lineHeight: 19, marginTop: 7 },
  tryAgainButton: { marginTop: 16, borderRadius: 12, backgroundColor: '#F0EFFF', paddingHorizontal: 16, paddingVertical: 10 },
  tryAgainText: { color: colors.primary, fontWeight: '800', fontSize: 12 },
  footerHint: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 7, paddingHorizontal: 10, paddingTop: 5, paddingBottom: 6 },
  footerHintText: { flex: 1, color: colors.textLight, fontSize: 10.5, lineHeight: 15 },
});

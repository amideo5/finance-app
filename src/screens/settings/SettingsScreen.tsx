import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import Card from '@/src/components/ui/Card';
import { colors } from '@/src/constants/colors';
import { useAuth } from '@/src/context/AuthContext';
import { useProfile } from '@/src/context/ProfileContext';
import { ChevronRight, User, Lock, LogOut, Plus, Check } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signOut, user } = useAuth();
  const { profiles, currentProfile, switchProfile } = useProfile();

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          await signOut();
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.contentContainer,
        { paddingBottom: Math.max(insets.bottom, 16) + 24 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.header, { paddingTop: Math.max(insets.top + 12, 48) }]}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>PREFERENCES</Text>
          <Text style={styles.title}>Settings</Text>
          <Text style={styles.subtitle}>Manage your account and finance profiles.</Text>
        </View>
        <View style={styles.headerIcon}>
          <Lock color={colors.primary} size={22} strokeWidth={2.2} />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Your account</Text>
        <Card padding={0}>
          <TouchableOpacity
            style={styles.settingItem}
            onPress={() => router.push('/settings/account')}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Manage account"
          >
            <View style={styles.settingLeft}>
              <View style={[styles.iconContainer, styles.primaryIconContainer]}>
                <User color={colors.primary} size={21} strokeWidth={2.1} />
              </View>
              <View style={styles.settingText}>
                <Text style={styles.settingLabel}>Account</Text>
                <Text style={styles.settingValue} numberOfLines={1}>
                  {user?.email || 'Manage your account details'}
                </Text>
              </View>
            </View>
            <ChevronRight color={colors.textSecondary} size={20} />
          </TouchableOpacity>
        </Card>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeadingRow}>
          <Text style={styles.sectionTitle}>Finance profiles</Text>
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{profiles.length}</Text>
          </View>
        </View>
        <Text style={styles.sectionDescription}>
          Switch between your personal, family, or other budgets.
        </Text>
        <Card padding={0}>
          {profiles.length === 0 ? (
            <View style={styles.emptyProfiles}>
              <View style={styles.emptyIconContainer}>
                <User color={colors.textSecondary} size={22} />
              </View>
              <Text style={styles.emptyTitle}>No profiles yet</Text>
              <Text style={styles.emptyDescription}>
                Create a profile to start organizing your finances.
              </Text>
            </View>
          ) : (
            profiles.map((profile, index) => {
              const isActive = currentProfile?.id === profile.id;

              return (
                <TouchableOpacity
                  key={profile.id}
                  style={[
                    styles.profileItem,
                    index !== profiles.length - 1 && styles.profileItemBorder,
                  ]}
                  onPress={() => switchProfile(profile.id)}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel={`Switch to ${profile.name} profile`}
                  accessibilityState={{ selected: isActive }}
                >
                  <View style={styles.profileEmojiContainer}>
                    <Text style={styles.profileEmoji}>{profile.emoji}</Text>
                  </View>
                  <View style={styles.profileText}>
                    <Text style={styles.profileName} numberOfLines={1}>
                      {profile.name}
                    </Text>
                    <Text style={styles.profileType}>{profile.type}</Text>
                  </View>
                  {isActive ? (
                    <View style={styles.activeBadge}>
                      <Check color={colors.success} size={13} strokeWidth={3} />
                      <Text style={styles.activeBadgeText}>Active</Text>
                    </View>
                  ) : (
                    <View style={styles.inactiveIndicator} />
                  )}
                </TouchableOpacity>
              );
            })
          )}
          <TouchableOpacity
            style={[styles.settingItem, styles.addProfileItem]}
            onPress={() => router.push('/settings/profiles/new')}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Create another finance profile"
          >
            <View style={styles.settingLeft}>
              <View style={[styles.iconContainer, styles.addIconContainer]}>
                <Plus color={colors.primary} size={21} strokeWidth={2.2} />
              </View>
              <View style={styles.settingText}>
                <Text style={styles.addProfileLabel}>Add profile</Text>
                <Text style={styles.settingValue}>Create a separate money space</Text>
              </View>
            </View>
            <ChevronRight color={colors.textSecondary} size={20} />
          </TouchableOpacity>
        </Card>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Security</Text>
        <Card padding={0}>
          <TouchableOpacity
            style={styles.settingItem}
            onPress={() => router.push('/settings/pin')}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="PIN Lock settings"
          >
            <View style={styles.settingLeft}>
              <View style={[styles.iconContainer, styles.primaryIconContainer]}>
                <Lock color={colors.primary} size={21} strokeWidth={2.1} />
              </View>
              <View style={styles.settingText}>
                <Text style={styles.settingLabel}>PIN Lock</Text>
                <Text style={styles.settingValue}>Secure access to your finance app</Text>
              </View>
            </View>
            <ChevronRight color={colors.textSecondary} size={20} />
          </TouchableOpacity>
        </Card>
      </View>

      <View style={styles.section}>
        <Card padding={0}>
          <TouchableOpacity
            style={styles.signOutItem}
            onPress={handleSignOut}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
          >
            <View style={styles.settingLeft}>
              <View style={styles.signOutIconContainer}>
                <LogOut color={colors.danger} size={21} strokeWidth={2.1} />
              </View>
              <View style={styles.settingText}>
                <Text style={styles.signOutLabel}>Sign Out</Text>
                <Text style={styles.settingValue}>Sign out of this account</Text>
              </View>
            </View>
            <ChevronRight color={colors.danger} size={20} />
          </TouchableOpacity>
        </Card>
      </View>

      <Text style={styles.footerText}>Your finances, organized your way.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  contentContainer: {
    paddingBottom: 32,
  },
  header: {
    paddingHorizontal: 24,
    paddingBottom: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerCopy: {
    flex: 1,
    paddingRight: 16,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: colors.primary,
    marginBottom: 8,
  },
  title: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '800',
    letterSpacing: -0.7,
    color: colors.text,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    marginTop: 7,
  },
  headerIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${colors.primary}14`,
    borderWidth: 1,
    borderColor: `${colors.primary}25`,
  },
  section: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  sectionHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.1,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  sectionDescription: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    marginTop: -4,
    marginBottom: 12,
  },
  countBadge: {
    minWidth: 23,
    height: 23,
    paddingHorizontal: 7,
    borderRadius: 12,
    marginLeft: 9,
    marginTop: -12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${colors.primary}14`,
  },
  countBadgeText: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: '800',
  },
  settingItem: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  iconContainer: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryIconContainer: {
    backgroundColor: `${colors.primary}12`,
  },
  addIconContainer: {
    backgroundColor: `${colors.primary}12`,
    borderWidth: 1,
    borderColor: `${colors.primary}24`,
    borderStyle: 'dashed',
  },
  settingText: {
    marginLeft: 13,
    flex: 1,
    minWidth: 0,
  },
  settingLabel: {
    fontSize: 15,
    lineHeight: 20,
    color: colors.text,
    fontWeight: '700',
  },
  settingValue: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
    marginTop: 3,
  },
  profileItem: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  profileItemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  profileEmojiContainer: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 13,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  profileEmoji: {
    fontSize: 25,
  },
  profileText: {
    flex: 1,
    minWidth: 0,
  },
  profileName: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    color: colors.text,
  },
  profileType: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
    marginTop: 3,
    textTransform: 'capitalize',
  },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: `${colors.success}16`,
    borderWidth: 1,
    borderColor: `${colors.success}35`,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 11,
    marginLeft: 8,
  },
  activeBadgeText: {
    fontSize: 11,
    color: colors.success,
    fontWeight: '800',
  },
  inactiveIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginHorizontal: 7,
    backgroundColor: colors.border,
  },
  addProfileItem: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  addProfileLabel: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.primary,
    fontWeight: '800',
  },
  emptyProfiles: {
    paddingHorizontal: 24,
    paddingVertical: 26,
    alignItems: 'center',
  },
  emptyIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  emptyDescription: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    color: colors.textSecondary,
    marginTop: 5,
    maxWidth: 230,
  },
  signOutItem: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  signOutIconContainer: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: `${colors.danger}12`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signOutLabel: {
    fontSize: 15,
    lineHeight: 20,
    color: colors.danger,
    fontWeight: '700',
  },
  footerText: {
    textAlign: 'center',
    fontSize: 11,
    color: colors.textSecondary,
    paddingTop: 0,
    paddingBottom: 8,
    letterSpacing: 0.2,
  },
});

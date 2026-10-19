import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import Card from '@/src/components/ui/Card';
import { colors } from '@/src/constants/colors';
import { useAuth } from '@/src/context/AuthContext';
import { useProfile } from '@/src/context/ProfileContext';
import { ChevronRight, User, Lock, Settings, LogOut } from 'lucide-react-native';

export default function SettingsScreen() {
  const router = useRouter();
  const { signOut, user } = useAuth();
  const { profiles, currentProfile, switchProfile } = useProfile();

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out TEST',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await signOut();
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Profile</Text>
        <Card padding={0}>
          <TouchableOpacity style={styles.settingItem}
              onPress={() => router.push('/settings/account')}>
            <View style={styles.settingLeft}>
              <User color={colors.primary} size={24} />
              <View style={styles.settingText}>
                <Text style={styles.settingLabel}>Account</Text>
                <Text style={styles.settingValue}>{user?.email}</Text>
              </View>
            </View>
            <ChevronRight color={colors.textSecondary} size={20} />
          </TouchableOpacity>
        </Card>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Active Profile</Text>
        <Card padding={0}>
          {profiles.map((profile, index) => (
            <TouchableOpacity
              key={profile.id}
              style={[
                styles.profileItem,
                index !== profiles.length - 1 && styles.profileItemBorder,
              ]}
              onPress={() => switchProfile(profile.id)}
            >
              <Text style={styles.profileEmoji}>{profile.emoji}</Text>
              <View style={styles.profileText}>
                <Text style={styles.profileName}>{profile.name}</Text>
                <Text style={styles.profileType}>{profile.type}</Text>
              </View>
              {currentProfile?.id === profile.id && (
                <View style={styles.activeBadge}>
                  <Text style={styles.activeBadgeText}>Active</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </Card>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Security</Text>
        <Card padding={0}>
          <TouchableOpacity style={styles.settingItem}
          onPress={() => router.push('/settings/pin')}>
            <View style={styles.settingLeft}>
              <Lock color={colors.primary} size={24} />
              <Text style={styles.settingLabel}>PIN Lock</Text>
            </View>
            <ChevronRight color={colors.textSecondary} size={20} />
          </TouchableOpacity>
        </Card>
      </View>

      <View style={styles.section}>
        <Card padding={0}>
          <TouchableOpacity style={styles.settingItem} onPress={handleSignOut}>
            <View style={styles.settingLeft}>
              <LogOut color={colors.danger} size={24} />
              <Text style={[styles.settingLabel, { color: colors.danger }]}>
                Sign Out
              </Text>
            </View>
          </TouchableOpacity>
        </Card>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    padding: 24,
    paddingTop: 48,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
  },
  section: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  settingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingText: {
    marginLeft: 16,
    flex: 1,
  },
  settingLabel: {
    fontSize: 16,
    color: colors.text,
    fontWeight: '500',
  },
  settingValue: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  profileItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  profileItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  profileEmoji: {
    fontSize: 32,
    marginRight: 16,
  },
  profileText: {
    flex: 1,
  },
  profileName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  profileType: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  activeBadge: {
    backgroundColor: colors.success,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  activeBadgeText: {
    fontSize: 12,
    color: colors.card,
    fontWeight: '600',
  },
});

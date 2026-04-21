import { colors } from '@/src/constants/colors';
import { MessageCircle, UserPlus, X } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface FriendCardProps {
  friendName: string;
  friendId: string;
  onRemove?: () => void;
  onMessage?: () => void;
  isPending?: boolean;
  onAccept?: () => void;
  onReject?: () => void;
}

export default function FriendCard({
  friendName,
  friendId,
  onRemove,
  onMessage,
  isPending = false,
  onAccept,
  onReject,
}: FriendCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.content}>
        <View style={styles.userInfo}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {friendName.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.nameSection}>
            <Text style={styles.name}>{friendName}</Text>
            {isPending && <Text style={styles.pendingLabel}>Pending</Text>}
          </View>
        </View>

        <View style={styles.actions}>
          {isPending ? (
            <>
              <TouchableOpacity
                style={[styles.actionButton, styles.acceptButton]}
                onPress={onAccept}
              >
                <UserPlus size={18} color={colors.card} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.rejectButton]}
                onPress={onReject}
              >
                <X size={18} color={colors.card} />
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                style={[styles.actionButton, styles.messageButton]}
                onPress={onMessage}
              >
                <MessageCircle size={18} color={colors.card} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionButton, styles.removeButton]}
                onPress={onRemove}
              >
                <X size={18} color={colors.card} />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  content: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  nameSection: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  pendingLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  acceptButton: {
    backgroundColor: colors.primary,
  },
  rejectButton: {
    backgroundColor: colors.textSecondary,
  },
  messageButton: {
    backgroundColor: colors.primary,
  },
  removeButton: {
    backgroundColor: '#E74C3C',
  },
});

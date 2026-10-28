import { colors } from '@/src/constants/colors';
import { Clock3, MessageCircle, UserPlus, UserRoundMinus, X } from 'lucide-react-native';
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
  onRemove,
  onMessage,
  isPending = false,
  onAccept,
  onReject,
}: FriendCardProps) {
  const canRespond = Boolean(onAccept || onReject);
  const initial = friendName.trim().charAt(0).toUpperCase() || 'F';

  return (
    <View style={styles.card}>
      <View style={styles.content}>
        <View style={styles.userInfo}>
          <View style={[styles.avatar, isPending && styles.avatarPending]}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={styles.nameSection}>
            <Text style={styles.name} numberOfLines={1}>{friendName}</Text>
            {isPending ? (
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, canRespond ? styles.statusDotReceived : styles.statusDotPending]} />
                <Text style={styles.pendingLabel}>{canRespond ? 'Request received' : 'Request sent · awaiting response'}</Text>
              </View>
            ) : (
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, styles.statusDotConnected]} />
                <Text style={styles.connectedLabel}>Connected friend</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.actions}>
          {isPending ? (
            canRespond ? (
              <>
                {onAccept ? (
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Accept ${friendName}'s request`} style={[styles.iconButton, styles.acceptButton]} onPress={onAccept} activeOpacity={0.8}>
                    <UserPlus size={17} color="#FFFFFF" />
                  </TouchableOpacity>
                ) : null}
                {onReject ? (
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Reject ${friendName}'s request`} style={[styles.iconButton, styles.rejectButton]} onPress={onReject} activeOpacity={0.8}>
                    <X size={17} color={colors.textSecondary} />
                  </TouchableOpacity>
                ) : null}
              </>
            ) : (
              <View style={styles.waitingPill}><Clock3 size={13} color={colors.primary} /><Text style={styles.waitingText}>Pending</Text></View>
            )
          ) : (
            <>
              {onMessage ? (
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Message ${friendName}`} style={[styles.iconButton, styles.messageButton]} onPress={onMessage} activeOpacity={0.8}>
                  <MessageCircle size={17} color={colors.primary} />
                </TouchableOpacity>
              ) : null}
              {onRemove ? (
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove ${friendName}`} style={[styles.iconButton, styles.removeButton]} onPress={onRemove} activeOpacity={0.8}>
                  <UserRoundMinus size={17} color={colors.danger} />
                </TouchableOpacity>
              ) : null}
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 14,
    marginBottom: 11,
    borderWidth: 1,
    borderColor: '#E9EAF5',
    shadowColor: '#25224F',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.045,
    shadowRadius: 8,
    elevation: 1,
  },
  content: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: '#ECEBFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  avatarPending: { backgroundColor: '#EAF2FF' },
  avatarText: { color: colors.primary, fontSize: 17, fontWeight: '800' },
  nameSection: { flex: 1, minWidth: 0, gap: 5 },
  name: { fontSize: 15, fontWeight: '700', color: colors.text },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusDotReceived: { backgroundColor: '#D97706' },
  statusDotPending: { backgroundColor: colors.primary },
  statusDotConnected: { backgroundColor: colors.success },
  pendingLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
  connectedLabel: { fontSize: 11, color: colors.success, fontWeight: '600' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  iconButton: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  acceptButton: { backgroundColor: colors.primary },
  rejectButton: { backgroundColor: '#F1F2F8', borderWidth: 1, borderColor: colors.border },
  messageButton: { backgroundColor: '#F0EFFF', borderWidth: 1, borderColor: '#E2DFFF' },
  removeButton: { backgroundColor: '#FFF0F1', borderWidth: 1, borderColor: '#FFE0E3' },
  waitingPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#F0EFFF', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 7 },
  waitingText: { fontSize: 10, color: colors.primary, fontWeight: '700' },
});

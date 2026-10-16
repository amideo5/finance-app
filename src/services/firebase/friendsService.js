import {
    collection,
    deleteDoc,
    doc as firestoreDoc,
    getDocs,
    query,
    runTransaction,
    serverTimestamp,
    setDoc,
    where,
} from "firebase/firestore";
import { db } from "../../firebaseConfig";

const loadProfilesByUserIds = async (userIds) => {
  const ids = [...new Set(userIds.filter(Boolean))];
  const profilesByUserId = new Map();

  for (let offset = 0; offset < ids.length; offset += 30) {
    const batchIds = ids.slice(offset, offset + 30);
    const snapshot = await getDocs(query(
      collection(db, "profiles"),
      where("userId", "in", batchIds)
    ));
    snapshot.docs.forEach((profileDoc) => {
      const profile = profileDoc.data();
      if (!profilesByUserId.has(profile.userId)) profilesByUserId.set(profile.userId, profile);
    });
  }
  return profilesByUserId;
};

// Send a friend request
export const sendFriendRequest = async (fromUserId, toUserId) => {
  try {
    // Check if request already exists
    if (!fromUserId || !toUserId || fromUserId === toUserId) {
      throw new Error('A valid, different recipient is required.');
    }
    const requestRef = firestoreDoc(db, "friendRequests", `${fromUserId}_${toUserId}`);
    await setDoc(requestRef, {
      fromUserId,
      toUserId,
      status: "pending",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch (error) {
    console.error("Error sending friend request:", error);
    throw error;
  }
};

// Get pending friend requests for a user
export const getPendingRequests = async (userId) => {
  try {
    const q = query(
      collection(db, "friendRequests"),
      where("toUserId", "==", userId),
      where("status", "==", "pending")
    );
    const snapshot = await getDocs(q);
    const profiles = await loadProfilesByUserIds(snapshot.docs.map((requestDoc) => requestDoc.data().fromUserId));
    return snapshot.docs.map((requestDoc) => {
      const requestData = requestDoc.data();
      return { id: requestDoc.id, ...requestData, profileData: profiles.get(requestData.fromUserId) || null };
    });
  } catch (error) {
    console.error("Error fetching pending requests:", error);
    throw error;
  }
};

// Accept friend request
// Accept friend request
export const acceptFriendRequest = async (requestId, userId, fromUserId) => {
  try {
    const requestRef = firestoreDoc(db, "friendRequests", requestId);
    const friendRef1 = firestoreDoc(db, "friends", `${userId}_${fromUserId}`);
    const friendRef2 = firestoreDoc(db, "friends", `${fromUserId}_${userId}`);
    return await runTransaction(db, async (transaction) => {
      const requestSnapshot = await transaction.get(requestRef);
      if (!requestSnapshot.exists()) throw new Error('Friend request no longer exists.');
      const request = requestSnapshot.data();
      if (request.fromUserId !== fromUserId || request.toUserId !== userId) {
        throw new Error('Friend request participants do not match.');
      }
      if (request.status === 'accepted') return true;
      if (request.status !== 'pending') throw new Error('Friend request is not pending.');

      const connectedAt = serverTimestamp();
      transaction.set(friendRef1, { userId, friendId: fromUserId, connectedAt });
      transaction.set(friendRef2, { userId: fromUserId, friendId: userId, connectedAt });
      transaction.update(requestRef, { status: 'accepted', updatedAt: connectedAt });
      return true;
    });
  } catch (error) {
    console.error("Error accepting friend request:", error);
    throw error;
  }
};

// Reject friend request
export const rejectFriendRequest = async (requestId) => {
  try {
    const requestRef = firestoreDoc(db, "friendRequests", requestId);
    await deleteDoc(requestRef); // Delete instead of updating status
    return true;
  } catch (error) {
    console.error("Error rejecting friend request:", error);
    throw error;
  }
};

// Get all friends of a user
export const getUserFriends = async (userId) => {
  try {
    const q = query(
      collection(db, "friends"),
      where("userId", "==", userId)
    );

    const snapshot = await getDocs(q);
    const profiles = await loadProfilesByUserIds(snapshot.docs.map((friendDoc) => friendDoc.data().friendId));
    return snapshot.docs.map((friendDoc) => {
      const friendData = friendDoc.data();
      return { id: friendDoc.id, ...friendData, profileData: profiles.get(friendData.friendId) || null };
    });
  } catch (error) {
    console.error("Error fetching friends:", error);
    throw error;
  }
};

// Remove friend
export const removeFriend = async (userId, friendId) => {
  try {
    const friendRef1 = firestoreDoc(db, "friends", `${userId}_${friendId}`);
    const friendRef2 = firestoreDoc(db, "friends", `${friendId}_${userId}`);
    
    await Promise.all([
      deleteDoc(friendRef1),
      deleteDoc(friendRef2),
    ]);
    return true;
  } catch (error) {
    console.error("Error removing friend:", error);
    throw error;
  }
};

// Get sent friend requests
export const getSentRequests = async (userId) => {
  try {
    const q = query(
      collection(db, "friendRequests"),
      where("fromUserId", "==", userId),
    );
    const snapshot = await getDocs(q);
    const profiles = await loadProfilesByUserIds(snapshot.docs.map((requestDoc) => requestDoc.data().toUserId));
    return snapshot.docs.map((requestDoc) => {
      const requestData = requestDoc.data();
      return { id: requestDoc.id, ...requestData, profileData: profiles.get(requestData.toUserId) || null };
    });
  } catch (error) {
    console.error("Error fetching sent requests:", error);
    throw error;
  }
};

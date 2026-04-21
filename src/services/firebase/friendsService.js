import {
    collection,
    deleteDoc,
    doc as firestoreDoc, getDoc,
    getDocs,
    query,
    serverTimestamp,
    setDoc,
    updateDoc,
    where,
} from "firebase/firestore";
import { db } from "../../firebaseConfig";

// Send a friend request
export const sendFriendRequest = async (fromUserId, toUserId) => {
  try {
    // Check if request already exists
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

    const pendingRequests = await Promise.all(
      snapshot.docs.map(async (doc) => {
        const requestData = doc.data();

        const profileRef = firestoreDoc(db, "profiles", requestData.fromUserId);
        const profile = await getDoc(profileRef);

        return {
          id: doc.id,
          ...requestData,
          profileData: profile.exists() ? profile.data() : null,
        };
      })
    );

    return pendingRequests;
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

    // 1. Create refs FIRST
    const friendRef1 = firestoreDoc(db, "friends", `${userId}_${fromUserId}`);
    const friendRef2 = firestoreDoc(db, "friends", `${fromUserId}_${userId}`);

    // 2. Prevent duplicate
    const existing = await getDoc(friendRef1);
    if (existing.exists()) return;

    // 3. Create both sides of friendship
    await Promise.all([
      setDoc(friendRef1, {
        userId,
        friendId: fromUserId,
        connectedAt: serverTimestamp(),
      }),
      setDoc(friendRef2, {
        userId: fromUserId,
        friendId: userId,
        connectedAt: serverTimestamp(),
      }),
      deleteDoc(requestRef), // Delete the friend request
    ]);

    return true;
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

    const friends = await Promise.all(
      snapshot.docs.map(async (friendDoc) => {
        const friendData = friendDoc.data();

        const friendProfileRef = firestoreDoc(db, "profiles", friendData.friendId);
        const friendProfile = await getDoc(friendProfileRef);

        return {
          id: friendDoc.id,
          ...friendData,
          profileData: friendProfile.exists() ? friendProfile.data() : null,
        };
      })
    );

    return friends;
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
    
    const sentRequests = await Promise.all(
      snapshot.docs.map(async (doc) => {
        const requestData = doc.data();

        const profileRef = firestoreDoc(db, "profiles", requestData.toUserId);
        const profile = await getDoc(profileRef);

        return {
          id: doc.id,
          ...requestData,
          profileData: profile.exists() ? profile.data() : null,
        };
      })
    );

    return sentRequests;
  } catch (error) {
    console.error("Error fetching sent requests:", error);
    throw error;
  }
};

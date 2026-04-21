const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

exports.onFriendRequestAccepted = functions.firestore
  .document("friendRequests/{requestId}")
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    // Run only when status becomes "accepted"
    if (before.status !== "accepted" && after.status === "accepted") {
      const { fromUserId, toUserId } = after;

      const db = admin.firestore();

      // Prevent duplicate creation
      const existing = await db
        .doc(`friends/${toUserId}_${fromUserId}`)
        .get();

      if (existing.exists) {
        return null;
      }

      const batch = db.batch();

      // A accepts B → create both sides

      // A → B
      const ref1 = db.doc(`friends/${toUserId}_${fromUserId}`);
      batch.set(ref1, {
        userId: toUserId,
        friendId: fromUserId,
        connectedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // B → A
      const ref2 = db.doc(`friends/${fromUserId}_${toUserId}`);
      batch.set(ref2, {
        userId: fromUserId,
        friendId: toUserId,
        connectedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await batch.commit();
    }

    return null;
  });
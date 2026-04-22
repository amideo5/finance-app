import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  where,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/src/firebaseConfig';

// 🔥 Create Split
export const createSplit = async ({
  transactionId,
  createdBy,
  totalAmount,
  type,
  participants,
}: any) => {
  return await addDoc(collection(db, 'splits'), {
    transactionId,
    createdBy,
    totalAmount,
    type,
    participants,
    participantIds: participants.map((p: any) => p.userId),
    createdAt: serverTimestamp(),
  });
};

// 🔥 Get splits for user
export const getUserSplits = async (userId: string) => {
  const snapshot = await getDocs(
    query(
      collection(db, 'splits'),
      where('participantIds', 'array-contains', userId)
    )
  );

  const data: any[] = [];
  snapshot.forEach((doc) => {
    data.push({ id: doc.id, ...doc.data() });
  });

  return data;
};

// 🔥 Mark paid
export const markSplitPaid = async (splitId: string, participants: any[]) => {
  const ref = doc(db, 'splits', splitId);
  await updateDoc(ref, { participants });
};
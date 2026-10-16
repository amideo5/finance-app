import { collection, doc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../firebaseConfig";

export const addAccount = async (profileId, data) => {
  const accountRef = doc(collection(db, "profiles", profileId, "accounts"));

  await setDoc(accountRef, {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return accountRef.id;
};

export const getAccounts = async (profileId) => {
  const snapshot = await getDocs(collection(db, "profiles", profileId, "accounts"));
  return snapshot.docs.map((accountDoc) => ({ id: accountDoc.id, ...accountDoc.data() }));
};

import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../firebaseConfig";

export const setNetWorthSnapshot = async (
  profileId,
  month,
  year,
  assets,
  liabilities,
  netWorth
) => {
  const snapshotId = `${year}_${month}`;
  const ref = doc(db, "profiles", profileId, "netWorthSnapshots", snapshotId);

  await setDoc(ref, {
    month,
    year,
    assets,
    liabilities,
    netWorth,
    createdAt: serverTimestamp(),
  });

  return snapshotId;
};

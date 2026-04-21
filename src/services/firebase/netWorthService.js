import { db } from "../firebase";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

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

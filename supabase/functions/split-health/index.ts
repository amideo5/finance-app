
import { importPKCS8, importX509, SignJWT, jwtVerify } from "npm:jose@6";

const projectId = Deno.env.get("FIREBASE_PROJECT_ID");
const serviceAccountB64 = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON_B64");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "apikey, content-type, x-firebase-id-token",
};

let cachedCerts: Record<string, string> | null = null;
let certsExpireAt = 0;

let cachedGoogleToken: { token: string; expiresAt: number } | null = null;

async function getFirebaseCerts(): Promise<Record<string, string>> {
  if (cachedCerts && Date.now() < certsExpireAt) return cachedCerts;

  const response = await fetch(
    "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com",
  );
  if (!response.ok) throw new Error("Unable to retrieve Firebase certificates");

  const certs = await response.json() as Record<string, string>;
  const cacheControl = response.headers.get("cache-control") ?? "";
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] ?? "300");

  cachedCerts = certs;
  certsExpireAt = Date.now() + maxAge * 1000;
  return certs;
}

async function verifyFirebaseToken(token: string): Promise<string> {
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID is not configured");

  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed Firebase ID token");

  const header = JSON.parse(atob(
    parts[0].replace(/-/g, "+").replace(/_/g, "/"),
  ));

  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new Error("Unsupported token signing algorithm");
  }

  let certs = await getFirebaseCerts();

  if (!certs[header.kid]) {
    cachedCerts = null;
    certsExpireAt = 0;
    certs = await getFirebaseCerts();
  }

  const cert = certs[header.kid];
  if (!cert) throw new Error("Firebase signing certificate not found");

  const publicKey = await importX509(cert, "RS256");
  const { payload } = await jwtVerify(token, publicKey, {
    algorithms: ["RS256"],
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
    requiredClaims: ["exp", "iat", "sub", "auth_time"],
  });

  if (
    typeof payload.sub !== "string" ||
    payload.sub.length === 0 ||
    payload.sub.length > 128
  ) {
    throw new Error("Invalid Firebase user ID");
  }

  return payload.sub;
}

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
};

function getServiceAccount(): ServiceAccount {
  if (!serviceAccountB64) {
    throw new Error("Service account secret is not configured");
  }

  const decoded = atob(serviceAccountB64);
  const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  const account = JSON.parse(new TextDecoder().decode(bytes)) as ServiceAccount;

  if (
    !account.project_id ||
    !account.client_email ||
    !account.private_key
  ) {
    throw new Error("Service account credential is incomplete");
  }

  if (projectId && account.project_id !== projectId) {
    throw new Error("Service account project does not match Firebase project");
  }

  return account;
}

async function getGoogleAccessToken(): Promise<string> {
  if (cachedGoogleToken && Date.now() < cachedGoogleToken.expiresAt) {
    return cachedGoogleToken.token;
  }

  const account = getServiceAccount();
  const tokenUri = account.token_uri ?? "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);

  const privateKey = await importPKCS8(account.private_key, "RS256");

  const assertion = await new SignJWT({
    scope: "https://www.googleapis.com/auth/datastore",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(account.client_email)
    .setSubject(account.client_email)
    .setAudience(tokenUri)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    console.error("Google OAuth failed with status", response.status);
    throw new Error("Unable to obtain Google access token");
  }

  const result = await response.json() as {
    access_token: string;
    expires_in: number;
  };

  cachedGoogleToken = {
    token: result.access_token,
    expiresAt: Date.now() + Math.max(result.expires_in - 60, 60) * 1000,
  };

  return result.access_token;
}

type FirestoreDocument = {
  name?: string;
  fields?: Record<string, unknown>;
  createTime?: string;
  updateTime?: string;
};

type FirestoreTransaction = {
  transaction?: string;
};

class FirestoreHttpError extends Error {
  constructor(public readonly status: number) {
    super(`Firestore REST request failed (${status})`);
  }
}

async function firestoreRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!projectId) {
    throw new Error("FIREBASE_PROJECT_ID is not configured");
  }

  const googleToken = await getGoogleAccessToken();
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${googleToken}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    },
  );

  if (!response.ok) {
    // Log status only. Avoid logging document data or credentials.
    console.error("Firestore REST request failed:", response.status);
    throw new FirestoreHttpError(response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return await response.json() as T;
}

async function beginFirestoreTransaction(): Promise<string> {
  const result = await firestoreRequest<FirestoreTransaction>(
    ":beginTransaction",
    {
      method: "POST",
      body: JSON.stringify({
        options: { readWrite: {} },
      }),
    },
  );

  if (!result.transaction) {
    throw new Error("Firestore did not return a transaction token");
  }

  return result.transaction;
}

async function getFirestoreDocumentInTransaction(
  documentPath: string,
  transactionId: string,
): Promise<FirestoreDocument | null> {
  const encodedPath = documentPath
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  const query = new URLSearchParams({ transaction: transactionId });

  try {
    return await firestoreRequest<FirestoreDocument>(
      `/${encodedPath}?${query.toString()}`,
    );
  } catch (error) {
    if (error instanceof FirestoreHttpError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

async function testFirestoreReadTransaction(uid: string) {
  let transactionId: string | null = null;
  let stage = "begin";

  try {
    transactionId = await beginFirestoreTransaction();

    stage = "read profile";
    const profile = await getFirestoreDocumentInTransaction(
      `profiles/${uid}`,
      transactionId,
    );

    stage = "rollback";
    await firestoreRequest<unknown>(":rollback", {
      method: "POST",
      body: JSON.stringify({ transaction: transactionId }),
    });

    return { profileExists: profile !== null };
  } catch (error) {
    console.error(
      `Firestore transaction test failed at stage "${stage}":`,
      error instanceof Error ? error.message : "Unknown error",
    );

    // Try cleanup, but don't replace the original failure with a rollback error.
    if (transactionId && stage !== "rollback") {
      try {
        await firestoreRequest<unknown>(":rollback", {
          method: "POST",
          body: JSON.stringify({ transaction: transactionId }),
        });
      } catch (rollbackError) {
        console.error(
          "Transaction cleanup failed:",
          rollbackError instanceof Error
            ? rollbackError.message
            : "Unknown error",
        );
      }
    }

    throw error;
  }
}

async function commitFirestoreTransaction(
  transactionId: string,
  writes: unknown[],
): Promise<void> {
  await firestoreRequest<unknown>(
    ":commit",
    {
      method: "POST",
      body: JSON.stringify({
        transaction: transactionId,
        writes,
      }),
    },
  );
}

async function readOwnProfile(uid: string) {
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID is not configured");

  const googleToken = await getGoogleAccessToken();
  const url =
    `https://firestore.googleapis.com/v1/projects/${projectId}` +
    `/databases/(default)/documents/profiles/${encodeURIComponent(uid)}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${googleToken}` },
  });

  if (response.status === 404) return { exists: false, fields: [] as string[] };

  if (!response.ok) {
    console.error("Firestore read failed with status", response.status);
    throw new Error("Firestore read failed");
  }

  const document = await response.json() as {
    fields?: Record<string, unknown>;
  };

  // Return field names only; do not expose profile values in this test.
  return {
    exists: true,
    fields: Object.keys(document.fields ?? {}),
  };
}

type FsValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { arrayValue: { values: FsValue[] } }
  | { mapValue: { fields: Record<string, FsValue> } };

type FsDoc = {
  name?: string;
  fields?: Record<string, FsValue>;
};

function fsEncode(value: unknown): FsValue {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(fsEncode) } };
  }
  if (typeof value === "object") {
    const fields: Record<string, FsValue> = {};
    for (const [key, val] of Object.entries(value)) fields[key] = fsEncode(val);
    return { mapValue: { fields } };
  }
  throw new Error(`Unsupported Firestore value: ${typeof value}`);
}

function fsDecode(value?: FsValue): unknown {
  if (!value) return undefined;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values ?? []).map(fsDecode);
  if ("mapValue" in value) {
    return Object.fromEntries(
      Object.entries(value.mapValue.fields ?? {}).map(([k, v]) => [k, fsDecode(v)]),
    );
  }
  return undefined;
}

function fsDocData(doc: FsDoc): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(doc.fields ?? {}).map(([k, v]) => [k, fsDecode(v)]),
  );
}

function fsDocumentName(path: string): string {
  return `projects/${projectId}/databases/(default)/documents/${path}`;
}

async function queryProfilesForUser(
  uid: string,
  transactionId: string,
): Promise<FsDoc[]> {
  const result = await firestoreRequest<Array<{ document?: FsDoc }>>(
    ":runQuery",
    {
      method: "POST",
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "profiles" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "userId" },
              op: "EQUAL",
              value: fsEncode(uid),
            },
          },
        },
        transaction: transactionId,
      }),
    },
  );

  return result.flatMap((row) => row.document ? [row.document] : []);
}

function stableHash(...parts: string[]): string {
  // Deno's Web Crypto API; deterministic IDs for generated allocation rows.
  const input = parts.join("\u0000");
  // Synchronous SHA-256 isn't available in Web Crypto, so use this async helper instead.
  return input;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function paiseFromRupees(amount: unknown): number | null {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return null;
  const paise = Math.round(amount * 100);
  return Number.isSafeInteger(paise) && Math.abs(amount * 100 - paise) < 1e-6
    ? paise
    : null;
}

function obligationIndex(
  obligations: Array<Record<string, unknown>>,
  fromUserId: string,
  toUserId: string,
): number {
  return obligations.findIndex(
    (item) =>
      item.fromUserId === fromUserId &&
      item.toUserId === toUserId,
  );
}

function assertId(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("/")) {
    throw new Error(`${label} is invalid`);
  }
  return value.trim();
}

function assertPaise(value: unknown, label: string, allowZero = false): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < (allowZero ? 0 : 1)
  ) {
    throw new Error(`${label} must be a valid integer amount in paise`);
  }
  return value;
}

function splitEqualShares(totalPaise: number, participants: Array<{ shareAmountInPaise: number }>) {
  const base = Math.floor(totalPaise / participants.length);
  const remainder = totalPaise % participants.length;

  participants.forEach((participant, index) => {
    const expected = base + (index < remainder ? 1 : 0);
    if (participant.shareAmountInPaise !== expected) {
      throw new Error("Equal shares do not correctly divide the linked expense");
    }
  });
}

// Match the Firebase makeObligations behavior: each non-payer allocation participant
// owes their full share to the creator/payer. The payer has no self-obligation.
function createObligations(
  participants: Array<{ userId: string; shareAmountInPaise: number }>,
  payerUid: string,
) {
  return participants
    .filter((p) => p.userId !== payerUid && p.shareAmountInPaise > 0)
    .map((p) => ({
      fromUserId: p.userId,
      toUserId: payerUid,
      amountInPaise: p.shareAmountInPaise,
      acceptedAmountInPaise: 0,
      pendingAmountInPaise: 0,
    }));
}

async function createSharedExpense(uid: string, data: Record<string, unknown>) {
  const sourceProfileId = assertId(data.sourceProfileId, "Source profile");
  const sourceTransactionId = assertId(data.sourceTransactionId, "Source transaction");

 

  const splitType = data.type;
  if (splitType !== "equal" && splitType !== "custom") {
    throw new Error("Split type must be equal or custom");
  }

  if (!Array.isArray(data.participants) || data.participants.length === 0) {
    throw new Error("Allocation participants are required");
  }

  const participants = data.participants.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("Invalid participant");
    const p = raw as Record<string, unknown>;
    return {
      userId: assertId(p.userId, "Participant UID"),
      displayName: typeof p.displayName === "string" ? p.displayName.slice(0, 100) : "",
      shareAmountInPaise: assertPaise(p.shareAmountInPaise, "Participant share", true),
    };
  });

  const participantIds = participants.map((p) => p.userId);
  if (new Set(participantIds).size !== participantIds.length) {
    throw new Error("Participant UIDs must be unique");
  }

  const transactionId = await beginFirestoreTransaction();
  let committed = false;

  try {
    const sourcePath = `profiles/${sourceProfileId}/transactions/${sourceTransactionId}`;
    const sourceLockPath = `splitSourceLocks/${sourceProfileId}/transactions/${sourceTransactionId}`;

    // All reads are completed before the commit writes.
    const [sourceDoc, sourceProfileDoc, lockDoc, ...friendDocs] = await Promise.all([
      getFirestoreDocumentInTransaction(sourcePath, transactionId),
      getFirestoreDocumentInTransaction(`profiles/${sourceProfileId}`, transactionId),
      getFirestoreDocumentInTransaction(sourceLockPath, transactionId),
      ...participantIds
        .filter((participantId) => participantId !== uid)
        .map((participantId) =>
          getFirestoreDocumentInTransaction(`friends/${uid}_${participantId}`, transactionId)
        ),
    ]);

    if (!sourceProfileDoc || fsDocData(sourceProfileDoc).userId !== uid) {
      throw new Error("Source profile must belong to the signed-in user");
    }
    if (!sourceDoc) throw new Error("The linked source expense no longer exists");

    const source = fsDocData(sourceDoc);
    const transactionNotes =
      typeof source.notes === "string" ? source.notes.trim() : "";

    const title =
      transactionNotes ||
      (typeof source.category === "string" ? source.category : "") ||
      "Shared expense";

    if (title.length > 120) {
      throw new Error("Expense title must be 120 characters or fewer");
    }
    const sourcePaise = paiseFromRupees(source.amount);

    if (
      source.type !== "expense" ||
      source.kind ||
      source.currency !== "INR" ||
      sourcePaise === null ||
      typeof source.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(source.date)
    ) {
      throw new Error("Choose a valid INR expense transaction");
    }

    const allocatedTotal = participants.reduce((sum, p) => sum + p.shareAmountInPaise, 0);
    if (allocatedTotal !== sourcePaise) {
      throw new Error("Participant shares must equal the linked expense total");
    }
    if (splitType === "equal") splitEqualShares(sourcePaise, participants);

    const otherParticipantIds = participantIds.filter((id) => id !== uid);
    for (let i = 0; i < friendDocs.length; i++) {
      if (!friendDocs[i]) throw new Error("All other participants must be accepted friends");
      const friend = fsDocData(friendDocs[i]!);
      if (friend.userId !== uid || friend.friendId !== otherParticipantIds[i]) {
        throw new Error("All other participants must be accepted friends");
      }
    }

    if (lockDoc && fsDocData(lockDoc).status !== "released") {
      throw new Error("This expense is already linked to a split");
    }

    // Resolve each participant's default profile in the same Firestore transaction.
    const profileLists = await Promise.all(
      [...new Set(participantIds)].map((participantId) =>
        queryProfilesForUser(participantId, transactionId)
      ),
    );

    const selectedProfiles = new Map<string, { id: string; data: Record<string, unknown> }>();

    [...new Set(participantIds)].forEach((participantId, index) => {
      const docs = profileLists[index]
        .map((doc) => ({ id: doc.name!.split("/").pop()!, data: fsDocData(doc) }))
        .sort((a, b) => a.id.localeCompare(b.id));

      if (!docs.length) throw new Error(`A finance profile is required for participant ${participantId}`);

      const selected = docs.find((doc) => doc.data.isDefault === true) ?? docs[0];
      if (selected.data.userId !== participantId) {
        throw new Error("Participant profile ownership validation failed");
      }
      selectedProfiles.set(participantId, selected);
    });

    const verifiedParticipants = participants.map((p) => ({
      ...p,
      displayName: String(selectedProfiles.get(p.userId)?.data.name || p.userId),
    }));

    const obligations = createObligations(verifiedParticipants, uid);
    const initiallySettled = obligations.length === 0;

    // Firestore auto IDs are 20 chars; collision protected with exists:false.
    const splitId = Array.from(crypto.getRandomValues(new Uint8Array(20)))
      .map((b) => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[b % 62])
      .join("");

    const splitDocPath = `splits/${splitId}`;
    const splitData = {
      title,
      description: typeof data.description === "string" ? data.description.slice(0, 500) : "",
      createdBy: uid,
      paidByUserId: uid,
      sourceProfileId,
      sourceTransactionId,
      totalAmountInPaise: sourcePaise,
      currency: "INR",
      type: splitType,
      participants: verifiedParticipants,
      participantIds,
      obligations,
      status: initiallySettled ? "finalizing" : "pending_settlement",
      finalizationStatus: initiallySettled ? "processing" : "not_started",
      sourceDate: source.date,
      sourceCategory: source.category || "Other",
      sourceCategoryId: source.categoryId || source.category_id || null,
    };

    const writes: unknown[] = [
      {
        update: {
          name: fsDocumentName(splitDocPath),
          fields: Object.fromEntries(
            Object.entries(splitData).map(([k, v]) => [k, fsEncode(v)]),
          ),
        },
        currentDocument: { exists: false },
      },
      {
        update: {
          name: fsDocumentName(sourceLockPath),
          fields: Object.fromEntries(
            Object.entries({
              splitId,
              sourceProfileId,
              sourceTransactionId,
              createdBy: uid,
              status: "claimed",
              releasedAt: null,
            }).map(([k, v]) => [k, fsEncode(v)]),
          ),
        },
        // Create a new lock, or replace a previously released one.
        currentDocument: lockDoc ? { exists: true } : { exists: false },
      },
    ];

    // If there are no obligations, atomically create the allocation rows too.
    const allocationTransactionIds: Record<string, string> = {};
    if (initiallySettled) {
      for (const p of verifiedParticipants) {
        if (p.shareAmountInPaise === 0) continue;

        const profileId = selectedProfiles.get(p.userId)!.id;
        const allocationId = `split_alloc_${(await sha256Hex(`${splitId}\u0000${p.userId}`)).slice(0, 40)}`;
        allocationTransactionIds[p.userId] = allocationId;

        const allocationData = {
          profileId,
          userId: p.userId,
          type: "expense",
          amount: p.shareAmountInPaise / 100,
          amountInPaise: p.shareAmountInPaise,
          currency: "INR",
          category: "Split Expense",
          categoryId: "split-expense-allocation",
          categoryIcon: "🧾",
          paymentMode: "shared-expense-allocation",
          accountId: null,
          notes: "Final shared expense allocation",
          date: source.date,
          kind: "allocation",
          splitId,
          settlementId: null,
          sourceProfileId,
          sourceTransactionId,
          sourceCategory: source.category || "Other",
          sourceCategoryId: source.categoryId || source.category_id || null,
          counterpartyUserId: null,
          serverGenerated: true,
        };

        writes.push({
          update: {
            name: fsDocumentName(`profiles/${profileId}/transactions/${allocationId}`),
            fields: Object.fromEntries(
              Object.entries(allocationData).map(([k, v]) => [k, fsEncode(v)]),
            ),
          },
          currentDocument: { exists: false },
        });
      }

      splitData.status = "settled";
      splitData.finalizationStatus = "complete";
      Object.assign(splitData, {
        allocationProfileIds: Object.fromEntries(
          verifiedParticipants.map((p) => [p.userId, selectedProfiles.get(p.userId)!.id]),
        ),
        allocationTransactionIds,
      });

      // Replace split's fields with its final settled form in this same commit.
      writes[0] = {
        update: {
          name: fsDocumentName(splitDocPath),
          fields: Object.fromEntries(
            Object.entries(splitData).map(([k, v]) => [k, fsEncode(v)]),
          ),
        },
        currentDocument: { exists: false },
      };
    }

    await commitFirestoreTransaction(transactionId, writes);
    committed = true;
    return { splitId };
  } finally {
    if (!committed) {
      try {
        await firestoreRequest<unknown>(":rollback", {
          method: "POST",
          body: JSON.stringify({ transaction: transactionId }),
        });
      } catch {
        // Transaction may already have expired/aborted.
      }
    }
  }
}

async function requestSplitRepayment(
  uid: string,
  data: Record<string, unknown>,
) {
  const splitId = assertId(data.splitId, "Split ID");
  const senderProfileId = assertId(data.senderProfileId, "Sender profile");
  const idempotencyKey = assertId(data.idempotencyKey, "Idempotency key");

  if (idempotencyKey.length > 200) {
    throw new Error("Idempotency key is too long");
  }

  const amountInPaise = assertPaise(data.amountInPaise, "Repayment amount");

  const settlementId = await sha256Hex(`${uid}\u0000${idempotencyKey}`);
  const splitPath = `splits/${splitId}`;
  const settlementPath = `${splitPath}/settlements/${settlementId}`;

  const transactionId = await beginFirestoreTransaction();
  let committed = false;

  try {
    const [splitDoc, existingSettlementDoc, senderProfileDoc] =
      await Promise.all([
        getFirestoreDocumentInTransaction(splitPath, transactionId),
        getFirestoreDocumentInTransaction(settlementPath, transactionId),
        getFirestoreDocumentInTransaction(
          `profiles/${senderProfileId}`,
          transactionId,
        ),
      ]);

    if (!splitDoc) throw new Error("Split not found");

    const split = fsDocData(splitDoc);

    if (
      split.status === "cancelled" ||
      split.status === "settled" ||
      split.finalizationStatus === "complete"
    ) {
      throw new Error("This split is no longer accepting repayments");
    }

    if (!senderProfileDoc || fsDocData(senderProfileDoc).userId !== uid) {
      throw new Error("The sender profile must belong to you");
    }

    const obligations = Array.isArray(split.obligations)
      ? split.obligations as Array<Record<string, unknown>>
      : [];

    const payerUid = typeof split.paidByUserId === "string"
      ? split.paidByUserId
      : "";

    const index = obligationIndex(obligations, uid, payerUid);

    if (index < 0) {
      throw new Error("You do not owe a repayment for this split");
    }

    // Idempotent retry: return the same settlement if the key was already used
    // for the exact same request.
    if (existingSettlementDoc) {
      const existing = fsDocData(existingSettlementDoc);

      if (
        existing.fromUserId !== uid ||
        existing.amountInPaise !== amountInPaise ||
        existing.senderProfileId !== senderProfileId
      ) {
        throw new Error(
          "Idempotency key was already used for another payment",
        );
      }

      await firestoreRequest<unknown>(":rollback", {
        method: "POST",
        body: JSON.stringify({ transaction: transactionId }),
      });

      committed = true;
      return { settlementId };
    }

    const obligation = obligations[index];
    const total = Number(obligation.amountInPaise);
    const accepted = Number(obligation.acceptedAmountInPaise ?? 0);
    const pending = Number(obligation.pendingAmountInPaise ?? 0);
    const available = total - accepted - pending;

    if (amountInPaise > available) {
      throw new Error(
        "Repayment exceeds the remaining unacknowledged obligation",
      );
    }

    const updatedObligations = obligations.map((item, i) =>
      i === index
        ? {
            ...item,
            pendingAmountInPaise: pending + amountInPaise,
          }
        : item
    );

    const writes = [
      {
        update: {
          name: fsDocumentName(settlementPath),
          fields: Object.fromEntries(
            Object.entries({
              splitId,
              fromUserId: uid,
              toUserId: payerUid,
              amountInPaise,
              senderProfileId,
              status: "pending",
              idempotencyKey,
            }).map(([key, value]) => [key, fsEncode(value)]),
          ),
        },
        currentDocument: { exists: false },
      },
      {
        update: {
          name: fsDocumentName(splitPath),
          fields: Object.fromEntries(
            Object.entries({
              obligations: updatedObligations,
              updatedAt: new Date().toISOString(),
            }).map(([key, value]) => [key, fsEncode(value)]),
          ),
        },
        // Update only the fields being changed.
        updateMask: { fieldPaths: ["obligations", "updatedAt"] },
        currentDocument: { exists: true },
      },
    ];

    await commitFirestoreTransaction(transactionId, writes);
    committed = true;

    return { settlementId };
  } finally {
    if (!committed) {
      try {
        await firestoreRequest<unknown>(":rollback", {
          method: "POST",
          body: JSON.stringify({ transaction: transactionId }),
        });
      } catch {
        // Preserve the original failure.
      }
    }
  }
}


function splitStatusFromObligations(obligations: Array<Record<string, unknown>>) {
  return obligations.some((o) =>
    Number(o.acceptedAmountInPaise ?? 0) < Number(o.amountInPaise ?? 0)
  ) ? "pending_settlement" : "settled";
}

function allObligationsPaidRest(obligations: Array<Record<string, unknown>>) {
  return obligations.every((o) =>
    Number(o.acceptedAmountInPaise ?? 0) >= Number(o.amountInPaise ?? 0)
  );
}

async function makeTransferDoc(
  args: {
    profileId: string; userId: string; type: "income" | "expense";
    amountInPaise: number; category: string; kind: "repayment" | "allocation";
    splitId: string; sourceProfileId: string; sourceTransactionId: string;
    settlementId?: string | null; counterpartyUserId?: string | null;
    date: string; sourceCategory?: string | null; sourceCategoryId?: string | null;
  },
) {
  const {
    profileId, userId, type, amountInPaise, category, kind, splitId,
    sourceProfileId, sourceTransactionId, settlementId = null,
    counterpartyUserId = null, date, sourceCategory = null, sourceCategoryId = null,
  } = args;
  const stable = kind === "allocation"
    ? await sha256Hex(`${splitId}\u0000${userId}`)
    : await sha256Hex(`${splitId}\u0000${settlementId}\u0000${userId}`);
  const id = kind === "allocation"
    ? `split_alloc_${stable.slice(0, 40)}`
    : `split_pay_${stable.slice(0, 40)}`;
  const data = {
    profileId, userId, type, amount: amountInPaise / 100, amountInPaise,
    currency: "INR", category,
    categoryId: kind === "allocation" ? "split-expense-allocation" : "split-repayment",
    categoryIcon: kind === "allocation" ? "🧾" : "↔️",
    paymentMode: kind === "allocation" ? "shared-expense-allocation" : "split-repayment",
    accountId: null,
    notes: kind === "allocation" ? "Final shared expense allocation" : "Accepted split repayment",
    date, kind, splitId, settlementId, sourceProfileId, sourceTransactionId,
    sourceCategory, sourceCategoryId, counterpartyUserId,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    serverGenerated: true,
  };
  return { path: `profiles/${profileId}/transactions/${id}`, id, data };
}

async function acceptSplitRepayment(uid: string, data: Record<string, unknown>) {
  const splitId = assertId(data.splitId, "Split ID");
  const settlementId = assertId(data.settlementId, "Settlement ID");
  const recipientProfileId = assertId(data.recipientProfileId, "Recipient profile ID");
  const splitPath = `splits/${splitId}`;
  const settlementPath = `${splitPath}/settlements/${settlementId}`;

  // Read preliminary split/settlement to know which participant profiles must be queried.
  const preliminaryTx = await beginFirestoreTransaction();
  let preliminarySplit: Record<string, unknown>;
  let preliminarySettlement: Record<string, unknown>;
  try {
    const [sd, td] = await Promise.all([
      getFirestoreDocumentInTransaction(splitPath, preliminaryTx),
      getFirestoreDocumentInTransaction(settlementPath, preliminaryTx),
    ]);
    if (!sd || !td) throw new Error("Split or repayment request not found");
    preliminarySplit = fsDocData(sd);
    preliminarySettlement = fsDocData(td);
  } finally {
    try { await firestoreRequest(":rollback", { method: "POST", body: JSON.stringify({ transaction: preliminaryTx }) }); } catch {}
  }

  const participantIds = Array.isArray(preliminarySplit.participantIds)
    ? preliminarySplit.participantIds as string[]
    : [];
  const profileIds = [...new Set([...participantIds, uid, String(preliminarySettlement.fromUserId)])];

  const tx = await beginFirestoreTransaction();
  let committed = false;
  try {
    const [splitDoc, settlementDoc, recipientDoc, senderDoc, ...profileDocs] = await Promise.all([
      getFirestoreDocumentInTransaction(splitPath, tx),
      getFirestoreDocumentInTransaction(settlementPath, tx),
      getFirestoreDocumentInTransaction(`profiles/${recipientProfileId}`, tx),
      getFirestoreDocumentInTransaction(`profiles/${String(preliminarySettlement.senderProfileId)}`, tx),
      ...profileIds.map((id) => queryProfilesForUser(id, tx)),
    ]);
    if (!splitDoc || !settlementDoc) throw new Error("Split or repayment request not found");
    const split = fsDocData(splitDoc);
    const settlement = fsDocData(settlementDoc);

    if (settlement.status === "accepted") {
      await firestoreRequest(":rollback", { method: "POST", body: JSON.stringify({ transaction: tx }) });
      committed = true;
      return { accepted: true, alreadyAccepted: true };
    }
    if (settlement.status !== "pending") throw new Error("Only pending repayment requests can be accepted");
    if (split.createdBy !== uid || split.paidByUserId !== uid || settlement.toUserId !== uid) {
      throw new Error("Only the original creditor can accept this repayment");
    }
    if (!recipientDoc || fsDocData(recipientDoc).userId !== uid) {
      throw new Error("Recipient profile must belong to the accepting creditor");
    }
    if (!senderDoc || fsDocData(senderDoc).userId !== settlement.fromUserId) {
      throw new Error("Sender profile ownership validation failed");
    }

    const profileByUser = new Map<string, { id: string; data: Record<string, unknown> }>();
    for (let i = 0; i < profileIds.length; i++) {
      const docs = profileDocs[i].map((doc) => ({
        id: doc.name!.split("/").pop()!,
        data: fsDocData(doc),
      })).sort((a, b) => a.id.localeCompare(b.id));
      if (!docs.length) throw new Error(`Finance profile missing for participant ${profileIds[i]}`);
      const chosen = docs.find((d) => d.data.isDefault === true) ?? docs[0];
      if (chosen.data.userId !== profileIds[i]) throw new Error("Allocation profile ownership validation failed");
      profileByUser.set(profileIds[i], chosen);
    }

    const obligations = Array.isArray(split.obligations)
      ? split.obligations as Array<Record<string, unknown>> : [];
    const index = obligationIndex(obligations, String(settlement.fromUserId), uid);
    if (index < 0) throw new Error("Repayment does not match an obligation");
    const obligation = obligations[index];
    const amount = assertPaise(settlement.amountInPaise, "Settlement amount");
    const total = Number(obligation.amountInPaise ?? 0);
    const accepted = Number(obligation.acceptedAmountInPaise ?? 0);
    const pending = Number(obligation.pendingAmountInPaise ?? 0);
    if (amount > total - accepted) throw new Error("Repayment exceeds outstanding obligation");
    if (pending < amount) throw new Error("Repayment reservation is missing or inconsistent");

    const updatedObligations = obligations.map((o, i) => i === index
      ? { ...o, acceptedAmountInPaise: accepted + amount, pendingAmountInPaise: Math.max(0, pending - amount) }
      : o);
    const finalizing = allObligationsPaidRest(updatedObligations);
    const date = new Date().toISOString().slice(0, 10);
    const senderTransfer = await makeTransferDoc({
      profileId: String(settlement.senderProfileId), userId: String(settlement.fromUserId),
      type: "expense", amountInPaise: amount, category: "Split Expense", kind: "repayment",
      splitId, sourceProfileId: String(split.sourceProfileId), sourceTransactionId: String(split.sourceTransactionId),
      settlementId, counterpartyUserId: uid, date,
    });
    const recipientTransfer = await makeTransferDoc({
      profileId: recipientProfileId, userId: uid, type: "income", amountInPaise: amount,
      category: "Split Income", kind: "repayment", splitId,
      sourceProfileId: String(split.sourceProfileId), sourceTransactionId: String(split.sourceTransactionId),
      settlementId, counterpartyUserId: String(settlement.fromUserId), date,
    });

    const writes: unknown[] = [
      { update: { name: fsDocumentName(senderTransfer.path), fields: Object.fromEntries(Object.entries(senderTransfer.data).map(([k,v]) => [k, fsEncode(v)])) }, currentDocument: { exists: false } },
      { update: { name: fsDocumentName(recipientTransfer.path), fields: Object.fromEntries(Object.entries(recipientTransfer.data).map(([k,v]) => [k, fsEncode(v)])) }, currentDocument: { exists: false } },
      { update: { name: fsDocumentName(settlementPath), fields: Object.fromEntries(Object.entries({
        status: "accepted", acceptedBy: uid, recipientProfileId,
        senderTransactionId: senderTransfer.id, recipientTransactionId: recipientTransfer.id,
        acceptedAt: new Date().toISOString(),
      }).map(([k,v]) => [k, fsEncode(v)])) }, updateMask: { fieldPaths: ["status","acceptedBy","recipientProfileId","senderTransactionId","recipientTransactionId","acceptedAt"] }, currentDocument: { exists: true } },
      { update: { name: fsDocumentName(splitPath), fields: Object.fromEntries(Object.entries({
        obligations: updatedObligations, status: finalizing ? "finalizing" : splitStatusFromObligations(updatedObligations),
        finalizationStatus: finalizing ? "processing" : String(split.finalizationStatus ?? "not_started"),
        updatedAt: new Date().toISOString(),
      }).map(([k,v]) => [k, fsEncode(v)])) }, updateMask: { fieldPaths: ["obligations","status","finalizationStatus","updatedAt"] }, currentDocument: { exists: true } },
    ];

    if (finalizing) {
      const allocationIds: Record<string, string> = {};
      const allocationProfileIds: Record<string, string> = {};
      for (const participant of (Array.isArray(split.participants) ? split.participants : []) as Array<Record<string, unknown>>) {
        const userId = String(participant.userId);
        const share = Number(participant.shareAmountInPaise ?? 0);
        const profile = profileByUser.get(userId);
        if (!profile) throw new Error(`Allocation profile missing for ${userId}`);
        allocationProfileIds[userId] = profile.id;
        if (share <= 0) continue;
        const allocation = await makeTransferDoc({
          profileId: profile.id, userId, type: "expense", amountInPaise: share,
          category: "Split Expense", kind: "allocation", splitId,
          sourceProfileId: String(split.sourceProfileId), sourceTransactionId: String(split.sourceTransactionId),
          date: String(split.sourceDate), sourceCategory: String(split.sourceCategory ?? "Other"),
          sourceCategoryId: split.sourceCategoryId == null ? null : String(split.sourceCategoryId),
        });
        writes.push({ update: { name: fsDocumentName(allocation.path), fields: Object.fromEntries(Object.entries(allocation.data).map(([k,v]) => [k, fsEncode(v)])) }, currentDocument: { exists: false } });
        allocationIds[userId] = allocation.id;
      }
      const finalFields: Record<string, unknown> = {
        status: "settled", finalizationStatus: "complete", settledAt: new Date().toISOString(),
        finalizedAt: new Date().toISOString(), allocationProfileIds, allocationTransactionIds: allocationIds,
        updatedAt: new Date().toISOString(),
      };
      const splitWrite = writes[3] as {
        update: { name: string; fields: Record<string, unknown> };
        updateMask: { fieldPaths: string[] };
        currentDocument: { exists: boolean };
      };
      Object.assign(splitWrite.update.fields,
        Object.fromEntries(Object.entries(finalFields).map(([k, v]) => [k, fsEncode(v)])));
      splitWrite.updateMask.fieldPaths = [
        ...new Set([...splitWrite.updateMask.fieldPaths, ...Object.keys(finalFields)]),
      ];
    }

    await commitFirestoreTransaction(tx, writes);
    committed = true;
    return { accepted: true, finalized: finalizing };
  } finally {
    if (!committed) {
      try { await firestoreRequest(":rollback", { method: "POST", body: JSON.stringify({ transaction: tx }) }); } catch {}
    }
  }
}

async function closePendingSettlement(
  uid: string, data: Record<string, unknown>, terminalStatus: "rejected" | "cancelled",
) {
  const splitId = assertId(data.splitId, "Split ID");
  const settlementId = assertId(data.settlementId, "Settlement ID");
  const splitPath = `splits/${splitId}`;
  const settlementPath = `${splitPath}/settlements/${settlementId}`;
  const tx = await beginFirestoreTransaction();
  let committed = false;
  try {
    const [splitDoc, settlementDoc] = await Promise.all([
      getFirestoreDocumentInTransaction(splitPath, tx),
      getFirestoreDocumentInTransaction(settlementPath, tx),
    ]);
    if (!splitDoc || !settlementDoc) throw new Error("Split or repayment request not found");
    const split = fsDocData(splitDoc);
    const settlement = fsDocData(settlementDoc);
    if (settlement.status === terminalStatus) {
      await firestoreRequest(":rollback", { method: "POST", body: JSON.stringify({ transaction: tx }) });
      committed = true;
      return { [terminalStatus]: true, alreadyClosed: true };
    }
    if (settlement.status !== "pending") throw new Error("Only pending repayment requests can be changed");
    const allowed = terminalStatus === "cancelled"
      ? settlement.fromUserId === uid
      : split.createdBy === uid && settlement.toUserId === uid;
    if (!allowed) throw new Error(terminalStatus === "cancelled"
      ? "Only the debtor who requested repayment can cancel it"
      : "Only the creditor can reject this repayment");
    const obligations = Array.isArray(split.obligations)
      ? split.obligations as Array<Record<string, unknown>> : [];
    const index = obligationIndex(obligations, String(settlement.fromUserId), String(settlement.toUserId));
    if (index < 0) throw new Error("Repayment obligation no longer exists");
    const amount = assertPaise(settlement.amountInPaise, "Settlement amount");
    const pending = Number(obligations[index].pendingAmountInPaise ?? 0);
    if (pending < amount) throw new Error("Pending repayment reservation is inconsistent");
    const updated = obligations.map((o, i) => i === index
      ? { ...o, pendingAmountInPaise: pending - amount } : o);
    const now = new Date().toISOString();
    const settlementFields: Record<string, unknown> = {
      status: terminalStatus, [`${terminalStatus}At`]: now,
      [terminalStatus === "rejected" ? "rejectedBy" : "cancelledBy"]: uid,
    };
    await commitFirestoreTransaction(tx, [
      { update: { name: fsDocumentName(settlementPath), fields: Object.fromEntries(Object.entries(settlementFields).map(([k,v]) => [k, fsEncode(v)])) }, updateMask: { fieldPaths: Object.keys(settlementFields) }, currentDocument: { exists: true } },
      { update: { name: fsDocumentName(splitPath), fields: Object.fromEntries(Object.entries({ obligations: updated, status: splitStatusFromObligations(updated), updatedAt: now }).map(([k,v]) => [k, fsEncode(v)])) }, updateMask: { fieldPaths: ["obligations","status","updatedAt"] }, currentDocument: { exists: true } },
    ]);
    committed = true;
    return { [terminalStatus]: true };
  } finally {
    if (!committed) {
      try { await firestoreRequest(":rollback", { method: "POST", body: JSON.stringify({ transaction: tx }) }); } catch {}
    }
  }
}

async function cancelSharedExpense(uid: string, data: Record<string, unknown>) {
  const splitId = assertId(data.splitId, "Split ID");
  const splitPath = `splits/${splitId}`;
  const tx = await beginFirestoreTransaction();
  let committed = false;
  try {
    const splitDoc = await getFirestoreDocumentInTransaction(splitPath, tx);
    if (!splitDoc) throw new Error("Split not found");
    const split = fsDocData(splitDoc);
    const lockPath = `splitSourceLocks/${String(split.sourceProfileId)}/transactions/${String(split.sourceTransactionId)}`;
    const lockDoc = await getFirestoreDocumentInTransaction(lockPath, tx);
    if (split.createdBy !== uid) throw new Error("Only the split creator can cancel it");
    if (split.status === "cancelled") {
      await firestoreRequest(":rollback", { method: "POST", body: JSON.stringify({ transaction: tx }) });
      committed = true;
      return { cancelled: true, alreadyCancelled: true };
    }
    if (split.finalizationStatus === "complete" ||
      (Array.isArray(split.obligations) && split.obligations.some((o: Record<string, unknown>) => Number(o.acceptedAmountInPaise ?? 0) > 0))) {
      throw new Error("A split with accepted repayments or final allocations cannot be cancelled");
    }
    if (Array.isArray(split.obligations) && split.obligations.some((o: Record<string, unknown>) => Number(o.pendingAmountInPaise ?? 0) > 0)) {
      throw new Error("Cancel pending repayment requests before cancelling the split");
    }
    const now = new Date().toISOString();
    const writes: unknown[] = [{
      update: { name: fsDocumentName(splitPath), fields: Object.fromEntries(Object.entries({
        status: "cancelled", updatedAt: now, cancelledAt: now,
      }).map(([k,v]) => [k, fsEncode(v)])) },
      updateMask: { fieldPaths: ["status","updatedAt","cancelledAt"] },
      currentDocument: { exists: true },
    }];
    if (lockDoc && fsDocData(lockDoc).splitId === splitId) {
      writes.push({
        update: { name: fsDocumentName(lockPath), fields: Object.fromEntries(Object.entries({
          status: "released", releasedAt: now,
        }).map(([k,v]) => [k, fsEncode(v)])) },
        updateMask: { fieldPaths: ["status","releasedAt"] },
        currentDocument: { exists: true },
      });
    }
    await commitFirestoreTransaction(tx, writes);
    committed = true;
    return { cancelled: true };
  } finally {
    if (!committed) {
      try { await firestoreRequest(":rollback", { method: "POST", body: JSON.stringify({ transaction: tx }) }); } catch {}
    }
  }
}


Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: corsHeaders },
    );
  }

  const token = req.headers.get("x-firebase-id-token");
  if (!token) {
    return Response.json(
      { error: "Missing Firebase ID token" },
      { status: 401, headers: corsHeaders },
    );
  }

  let uid: string;
  try {
    uid = await verifyFirebaseToken(token);
  } catch {
    return Response.json(
      { error: "Authentication failed" },
      { status: 401, headers: corsHeaders },
    );
  }

  const url = new URL(req.url);

  try {
    if (req.method === "GET" && url.pathname.endsWith("/split-health")) {
      const profile = await testFirestoreReadTransaction(uid);
      return Response.json(
        {
          authenticated: true,
          uid,
          firestore: "transaction_read_ok",
          profileExists: profile.profileExists,
        },
        { status: 200, headers: corsHeaders },
      );
    }

    if (req.method === "POST" && url.pathname.endsWith("/create-shared-expense")) {
      const body = await req.json() as Record<string, unknown>;
      const result = await createSharedExpense(uid, body);
      return Response.json(result, { status: 201, headers: corsHeaders });
    }

    if ( req.method === "POST" && url.pathname.endsWith("/request-split-repayment")) {
      const body = await req.json() as Record<string, unknown>;
      const result = await requestSplitRepayment(uid, body);
      return Response.json(result, { status: 201, headers: corsHeaders });
    }

    if (req.method === "POST" && url.pathname.endsWith("/accept-split-repayment")) {
      const body = await req.json() as Record<string, unknown>;
      const result = await acceptSplitRepayment(uid, body);
      return Response.json(result, { status: 200, headers: corsHeaders });
    }

    if (req.method === "POST" && url.pathname.endsWith("/reject-split-repayment")) {
      const body = await req.json() as Record<string, unknown>;
      const result = await closePendingSettlement(uid, body, "rejected");
      return Response.json(result, { status: 200, headers: corsHeaders });
    }

    if (req.method === "POST" && url.pathname.endsWith("/cancel-split-repayment")) {
      const body = await req.json() as Record<string, unknown>;
      const result = await closePendingSettlement(uid, body, "cancelled");
      return Response.json(result, { status: 200, headers: corsHeaders });
    }

    if (req.method === "POST" && url.pathname.endsWith("/cancel-shared-expense")) {
      const body = await req.json() as Record<string, unknown>;
      const result = await cancelSharedExpense(uid, body);
      return Response.json(result, { status: 200, headers: corsHeaders });
    }

    return Response.json(
      { error: "Unknown endpoint" },
      { status: 404, headers: corsHeaders },
    );
  } catch (error) {
    // Do not send raw Firestore errors or credentials to the client.
    console.error("Split endpoint failed:", error instanceof Error ? error.message : "Unknown error");
    return Response.json(
      { error: error instanceof Error ? error.message : "Request failed" },
      { status: 400, headers: corsHeaders },
    );
  }
});

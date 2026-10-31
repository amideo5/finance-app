
import { importPKCS8, importX509, SignJWT, jwtVerify } from "npm:jose@6";
import { buildMutualFriendshipKeys, calculateFriendshipAwarePlan, deduplicateFriendSettlementRecords, deriveNetSettlementSplitStatuses, getCompleteFriendshipCliqueForPair, getCliqueSettlementCapacity } from "../_shared/settlement.ts";

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
  fields?: Record<string, FsValue>;
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

function addSafePaise(current: number, delta: number, label: string): number {
  const next = current + delta;
  if (!Number.isSafeInteger(next)) {
    throw new Error(`${label} exceeds the safe whole-paise range`);
  }
  return next;
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

// -----------------------------------------------------------------------------
// Friend-level net settlements
// Collection: friendSettlements/{settlementId}
// These payments affect friend-pair or clique balances. Clients derive a display-only
// split status from accepted rows; the source split obligations are not rewritten.
// -----------------------------------------------------------------------------

type FriendSettlementStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "cancelled";

type FriendSettlementRecord = {
  fromUserId: string;
  toUserId: string;
  participantIds: string[];
  amountInPaise: number;
  status: FriendSettlementStatus;
  idempotencyKey: string;
  fromProfileId: string;
  fromAccountId: string;
  note?: string;
  createdAt: string;
  acceptedAt?: string;
  rejectedAt?: string;
  cancelledAt?: string;
  settlementMode?: "clique_net" | "bilateral";
  settlementGroupUserIds?: string[];
};

async function queryFirestoreCollectionInTransaction(
  collectionId: string,
  fieldPath: string,
  operator: "EQUAL" | "ARRAY_CONTAINS",
  value: unknown,
  transactionId: string,
): Promise<FsDoc[]> {
  const result = await firestoreRequest<Array<{ document?: FsDoc }>>(
    ":runQuery",
    {
      method: "POST",
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId }],
          where: {
            fieldFilter: {
              field: { fieldPath },
              op: operator,
              value: fsEncode(value),
            },
          },
        },
        transaction: transactionId,
      }),
    },
  );

  return result.flatMap((row) => row.document ? [row.document] : []);
}


async function queryEntireCollectionInTransaction(
  collectionId: string,
  transactionId: string,
): Promise<FsDoc[]> {
  const result = await firestoreRequest<Array<{ document?: FsDoc }>>(
    ":runQuery",
    {
      method: "POST",
      body: JSON.stringify({
        structuredQuery: { from: [{ collectionId }] },
        transaction: transactionId,
      }),
    },
  );
  return result.flatMap((row) => row.document ? [row.document] : []);
}


const SETTLEMENT_LEDGER_LOCK_PATH = "systemLocks/settlementLedger";

function settlementLedgerLockWrite(lockDoc: FsDoc | null): Record<string, unknown> {
  return {
    update: {
      name: fsDocumentName(SETTLEMENT_LEDGER_LOCK_PATH),
      fields: {
        lastOperationAt: fsEncode(new Date().toISOString()),
        operationId: fsEncode(crypto.randomUUID()),
      },
    },
    updateMask: { fieldPaths: ["lastOperationAt", "operationId"] },
    currentDocument: lockDoc ? { exists: true } : { exists: false },
  };
}

/**
 * Calculate the app-wide net balances from all active split obligations and
 * accepted friend-level payments. Negative means the user owes; positive means
 * the user should receive. Pending items are not booked as payments.
 */
async function getNetworkNetBalancesInTransaction(
  transactionId: string,
): Promise<Record<string, number>> {
  const [splitDocs, friendSettlementDocs] = await Promise.all([
    queryEntireCollectionInTransaction("splits", transactionId),
    queryEntireCollectionInTransaction("friendSettlements", transactionId),
  ]);
  const balances: Record<string, number> = {};
  const adjust = (userId: string, delta: number) => {
    balances[userId] = addSafePaise(balances[userId] ?? 0, delta, "Network balance");
  };

  for (const doc of splitDocs) {
    const split = fsDocData(doc);
    if (split.status === "cancelled") continue;
    const obligations = Array.isArray(split.obligations)
      ? split.obligations as Array<Record<string, unknown>>
      : [];
    for (const obligation of obligations) {
      const from = typeof obligation.fromUserId === "string" ? obligation.fromUserId : "";
      const to = typeof obligation.toUserId === "string" ? obligation.toUserId : "";
      if (!from || !to || from === to) throw new Error("A split contains an invalid obligation");
      const total = assertPaise(obligation.amountInPaise, "Split obligation", true);
      const accepted = assertPaise(obligation.acceptedAmountInPaise ?? 0, "Accepted split repayment", true);
      if (accepted > total) throw new Error("Accepted split repayments exceed an obligation");
      const outstanding = total - accepted;
      if (outstanding > 0) {
        adjust(from, -outstanding);
        adjust(to, outstanding);
      }
    }
  }

  const uniqueFriendSettlements = deduplicateFriendSettlementRecords(friendSettlementDocs.map((doc) => {
    const item = fsDocData(doc);
    return {
      id: doc.name?.split("/").at(-1) ?? "",
      fromUserId: String(item.fromUserId ?? ""),
      toUserId: String(item.toUserId ?? ""),
      amountInPaise: item.amountInPaise as number,
      status: String(item.status ?? ""),
      idempotencyKey: typeof item.idempotencyKey === "string" ? item.idempotencyKey : undefined,
      settlementMode: typeof item.settlementMode === "string" ? item.settlementMode : undefined,
      settlementGroupUserIds: Array.isArray(item.settlementGroupUserIds) ? item.settlementGroupUserIds.filter((id): id is string => typeof id === "string") : undefined,
    };
  }));
  for (const settlement of uniqueFriendSettlements) {
    if (settlement.status !== "accepted") continue;
    const from = assertId(settlement.fromUserId, "Friend settlement sender");
    const to = assertId(settlement.toUserId, "Friend settlement recipient");
    if (from === to) throw new Error("A friend settlement cannot involve the same user twice");
    const amount = assertPaise(settlement.amountInPaise, "Accepted friend settlement");
    // Paying reduces the sender's debt and the recipient's credit.
    adjust(from, amount);
    adjust(to, -amount);
  }

  const total = Object.values(balances).reduce((sum, amount) => sum + amount, 0);
  if (total !== 0) throw new Error(`The network ledger does not reconcile (${total} paise)`);
  return balances;
}

/** Canonical undirected key for an accepted friendship. */
function friendshipKey(userA: string, userB: string): string {
  const [first, second] = userA < userB ? [userA, userB] : [userB, userA];
  return `${first}\u0000${second}`;
}

async function getAcceptedFriendshipKeysInTransaction(transactionId: string): Promise<Set<string>> {
  const docs = await queryEntireCollectionInTransaction("friends", transactionId);
  // `acceptFriendRequest` writes mirrored directional records. Requiring both
  // records prevents a stale/partial friend-list entry from authorizing payment.
  return buildMutualFriendshipKeys(docs.map((doc) => {
    const data = fsDocData(doc);
    return {
      userId: data.userId,
      friendId: data.friendId,
      documentId: doc.name?.split("/").at(-1) ?? "",
    };
  }));
}

/**
 * Calculate balances only from split obligations whose two endpoints are
 * accepted friends, plus accepted friend settlements for friendships that
 * still exist. Non-friend split debts remain in the split ledger unchanged,
 * but they cannot offset a user's friend-only settlement capacity.
 */
/**
 * Amount a caller can currently propose to transfer on a direct friendship edge.
 * Complete mutual cliques use group-net balances; bridge/leaf edges remain bilateral.
 */
type FriendSettlementValidationResult = {
  availableAmountInPaise: number;
  settlementMode: "bilateral" | "clique_net";
  settlementGroupUserIds?: string[];
};

/**
 * Re-reads the ledger in the caller's Firestore transaction. New requests use
 * group netting only when both participants belong to the same complete friendship
 * block; old requests without a mode keep their original bilateral semantics.
 */
async function getFriendSettlementValidationInTransaction(
  fromUserId: string,
  toUserId: string,
  transactionId: string,
  options: {
    excludePendingSettlementId?: string;
    mode?: "auto" | "bilateral" | "clique_net";
    expectedGroupUserIds?: string[];
  } = {},
): Promise<FriendSettlementValidationResult> {
  const [splitDocs, settlementDocs, friendKeys] = await Promise.all([
    queryEntireCollectionInTransaction("splits", transactionId),
    queryEntireCollectionInTransaction("friendSettlements", transactionId),
    getAcceptedFriendshipKeysInTransaction(transactionId),
  ]);
  if (!friendKeys.has(friendshipKey(fromUserId, toUserId))) {
    throw new Error("Repayments are allowed only between mutually accepted friends");
  }

  const obligations: Array<{
    fromUserId: string;
    toUserId: string;
    amountInPaise: number;
    acceptedAmountInPaise: number;
    pendingAmountInPaise: number;
    splitStatus: string;
  }> = [];
  for (const doc of splitDocs) {
    const split = fsDocData(doc);
    const rows = Array.isArray(split.obligations)
      ? split.obligations as Array<Record<string, unknown>> : [];
    for (const item of rows) {
      obligations.push({
        fromUserId: String(item.fromUserId ?? ""),
        toUserId: String(item.toUserId ?? ""),
        amountInPaise: assertPaise(item.amountInPaise, "Split obligation", true),
        acceptedAmountInPaise: assertPaise(item.acceptedAmountInPaise ?? 0, "Accepted split repayment", true),
        pendingAmountInPaise: assertPaise(item.pendingAmountInPaise ?? 0, "Pending split repayment", true),
        splitStatus: String(split.status ?? ""),
      });
    }
  }

  const settlements = deduplicateFriendSettlementRecords(settlementDocs.map((doc) => {
    const item = fsDocData(doc);
    return {
      id: doc.name?.split("/").at(-1) ?? "",
      fromUserId: String(item.fromUserId ?? ""),
      toUserId: String(item.toUserId ?? ""),
      amountInPaise: item.amountInPaise as number,
      status: String(item.status ?? ""),
      idempotencyKey: typeof item.idempotencyKey === "string" ? item.idempotencyKey : undefined,
      settlementMode: typeof item.settlementMode === "string" ? item.settlementMode : undefined,
      settlementGroupUserIds: Array.isArray(item.settlementGroupUserIds)
        ? item.settlementGroupUserIds.filter((id): id is string => typeof id === "string")
        : undefined,
    };
  }));

  // Do not reinterpret a previously accepted group-net payment as bilateral if
  // the friendship block has changed since it was approved.
  for (const settlement of settlements) {
    if (settlement.settlementMode !== "clique_net" || settlement.status !== "accepted") continue;
    const snapshot = [...new Set(settlement.settlementGroupUserIds ?? [])].sort();
    const currentGroup = getCompleteFriendshipCliqueForPair(friendKeys, settlement.fromUserId, settlement.toUserId);
    if (!currentGroup || snapshot.length !== currentGroup.length || snapshot.some((id, index) => id !== currentGroup[index])) {
      throw new Error("A friendship group changed after a group-net settlement. Suggestions are paused to protect settlement history; review the group settlement before continuing.");
    }
  }

  const requestedMode = options.mode ?? "auto";
  const clique = getCompleteFriendshipCliqueForPair(friendKeys, fromUserId, toUserId);
  const useCliqueNetting = requestedMode === "clique_net" || (requestedMode === "auto" && clique !== null);
  if (useCliqueNetting) {
    if (!clique) {
      throw new Error("This friendship pair is no longer part of an eligible complete friendship group.");
    }
    if (options.expectedGroupUserIds) {
      const expected = [...new Set(options.expectedGroupUserIds)].sort();
      if (expected.length !== clique.length || expected.some((id, index) => id !== clique[index])) {
        throw new Error("The friendship group changed after this suggestion. Refresh suggestions and create a new request.");
      }
    }
    const capacity = getCliqueSettlementCapacity(
      obligations,
      settlements,
      friendKeys,
      fromUserId,
      toUserId,
      { excludePendingSettlementId: options.excludePendingSettlementId },
    );
    if (!capacity) throw new Error("The friendship pair is not eligible for group netting.");
    return {
      availableAmountInPaise: capacity.amountInPaise,
      settlementMode: "clique_net",
      settlementGroupUserIds: capacity.groupUserIds,
    };
  }

  // Legacy bilateral settlement: only the exact two-person net obligation grants
  // capacity. A transfer involving another pair cannot be redirected here.
  let signed = 0; // positive means fromUserId owes toUserId.
  let pendingFromTo = 0;
  let pendingToFrom = 0;
  const addSigned = (delta: number) => {
    signed = addSafePaise(signed, delta, "Bilateral settlement balance");
  };
  for (const obligation of obligations) {
    const total = obligation.amountInPaise;
    const accepted = obligation.acceptedAmountInPaise;
    const pending = obligation.pendingAmountInPaise;
    if (accepted > total || pending > total - accepted) {
      throw new Error("Accepted and pending repayments exceed a split obligation");
    }
    if (obligation.splitStatus === "cancelled") {
      if (accepted > 0 || pending > 0) throw new Error("Cancelled split retains accepted or pending repayment amounts");
      continue;
    }
    if (obligation.splitStatus === "settled" && (accepted !== total || pending !== 0)) {
      throw new Error("Settled split status conflicts with outstanding obligation amounts");
    }
    const outstanding = total - accepted;
    if (obligation.fromUserId === fromUserId && obligation.toUserId === toUserId) {
      addSigned(outstanding);
      pendingFromTo = addSafePaise(pendingFromTo, pending, "Pending bilateral repayment");
    } else if (obligation.fromUserId === toUserId && obligation.toUserId === fromUserId) {
      addSigned(-outstanding);
      pendingToFrom = addSafePaise(pendingToFrom, pending, "Pending bilateral repayment");
    }
  }
  for (const settlement of settlements) {
    if (settlement.id === options.excludePendingSettlementId) continue;
    if (settlement.fromUserId === fromUserId && settlement.toUserId === toUserId) {
      if (settlement.status === "accepted") addSigned(-settlement.amountInPaise);
      else pendingFromTo = addSafePaise(pendingFromTo, settlement.amountInPaise, "Pending bilateral settlement");
    } else if (settlement.fromUserId === toUserId && settlement.toUserId === fromUserId) {
      if (settlement.status === "accepted") addSigned(settlement.amountInPaise);
      else pendingToFrom = addSafePaise(pendingToFrom, settlement.amountInPaise, "Pending bilateral settlement");
    }
  }
  const availableAmountInPaise = signed > 0 && pendingToFrom === 0
    ? Math.max(0, signed - pendingFromTo)
    : 0;
  return { availableAmountInPaise, settlementMode: "bilateral" };
}

async function getFriendOnlyNetBalancesInTransaction(
  transactionId: string,
): Promise<{ balances: Record<string, number>; friendKeys: Set<string> }> {
  const [splitDocs, friendSettlementDocs, friendKeys] = await Promise.all([
    queryEntireCollectionInTransaction("splits", transactionId),
    queryEntireCollectionInTransaction("friendSettlements", transactionId),
    getAcceptedFriendshipKeysInTransaction(transactionId),
  ]);
  const balances: Record<string, number> = {};
  const adjust = (userId: string, delta: number) => {
    balances[userId] = addSafePaise(balances[userId] ?? 0, delta, "Friend-only balance");
  };

  for (const doc of splitDocs) {
    const split = fsDocData(doc);
    if (split.status === "cancelled") continue;
    const obligations = Array.isArray(split.obligations)
      ? split.obligations as Array<Record<string, unknown>>
      : [];
    for (const obligation of obligations) {
      const from = typeof obligation.fromUserId === "string" ? obligation.fromUserId : "";
      const to = typeof obligation.toUserId === "string" ? obligation.toUserId : "";
      if (!from || !to || from === to) throw new Error("A split contains an invalid obligation");
      const total = assertPaise(obligation.amountInPaise, "Split obligation", true);
      const accepted = assertPaise(obligation.acceptedAmountInPaise ?? 0, "Accepted split repayment", true);
      const pending = assertPaise(obligation.pendingAmountInPaise ?? 0, "Pending split repayment", true);
      if (accepted > total || pending > total - accepted) {
        throw new Error("Accepted and pending split repayments exceed an obligation");
      }
      if (split.status === "settled" && (accepted !== total || pending !== 0)) {
        throw new Error("Settled split status conflicts with outstanding obligation amounts");
      }
      if (!friendKeys.has(friendshipKey(from, to))) continue;
      const outstanding = total - accepted;
      if (outstanding > 0) {
        adjust(from, -outstanding);
        adjust(to, outstanding);
      }
    }
  }

  const uniqueFriendSettlements = deduplicateFriendSettlementRecords(friendSettlementDocs.map((doc) => {
    const item = fsDocData(doc);
    return {
      id: doc.name?.split("/").at(-1) ?? "",
      fromUserId: String(item.fromUserId ?? ""),
      toUserId: String(item.toUserId ?? ""),
      amountInPaise: item.amountInPaise as number,
      status: String(item.status ?? ""),
      idempotencyKey: typeof item.idempotencyKey === "string" ? item.idempotencyKey : undefined,
      settlementMode: typeof item.settlementMode === "string" ? item.settlementMode : undefined,
      settlementGroupUserIds: Array.isArray(item.settlementGroupUserIds) ? item.settlementGroupUserIds.filter((id): id is string => typeof id === "string") : undefined,
    };
  }));
  for (const settlement of uniqueFriendSettlements) {
    if (settlement.status !== "accepted") continue;
    const from = assertId(settlement.fromUserId, "Friend settlement sender");
    const to = assertId(settlement.toUserId, "Friend settlement recipient");
    if (from === to) throw new Error("A friend settlement cannot involve the same user twice");
    // Legacy bilateral payments no longer create current friend-only capacity
    // after a friendship is revoked. Accepted clique-net transfers are historic
    // group-level adjustments and must remain in the balance ledger even if the
    // graph later changes; the suggestion endpoint will fail closed for stale groups.
    if (!friendKeys.has(friendshipKey(from, to)) && settlement.settlementMode !== "clique_net") continue;
    const amount = assertPaise(settlement.amountInPaise, "Accepted friend settlement");
    adjust(from, amount);
    adjust(to, -amount);
  }

  const total = Object.values(balances).reduce((sum, amount) => sum + amount, 0);
  if (total !== 0) throw new Error(`The friend-only ledger does not reconcile (${total} paise)`);
  return { balances, friendKeys };
}

/**
 * Produce caller-scoped settlement suggestions. Complete mutual friendship cliques
 * are netted as groups because every transfer in that group is a direct friend edge.
 * Bridge/leaf edges retain their exact bilateral semantics, and non-friend debts
 * remain unresolved rather than being routed through a third party.
 */
function simplifyFriendPairObligations(
  splitDocs: FsDoc[],
  friendSettlementDocs: FsDoc[],
  friendKeys: Set<string>,
  focusUserId: string,
): {
  suggestions: Array<{ fromUserId: string; toUserId: string; amountInPaise: number }>;
  unresolvedObligations: Array<{
    fromUserId: string;
    toUserId: string;
    amountInPaise: number;
    reason: "not_currently_mutual_friends";
  }>;
} {
  const obligations: Array<{
    fromUserId: string;
    toUserId: string;
    amountInPaise: number;
    acceptedAmountInPaise: number;
    pendingAmountInPaise: number;
    splitStatus: string;
  }> = [];
  for (const doc of splitDocs) {
    const split = fsDocData(doc);
    if (split.status === "cancelled") continue;
    const rows = Array.isArray(split.obligations)
      ? split.obligations as Array<Record<string, unknown>> : [];
    for (const obligation of rows) {
      obligations.push({
        fromUserId: typeof obligation.fromUserId === "string" ? obligation.fromUserId : "",
        toUserId: typeof obligation.toUserId === "string" ? obligation.toUserId : "",
        amountInPaise: assertPaise(obligation.amountInPaise, "Split obligation", true),
        acceptedAmountInPaise: assertPaise(obligation.acceptedAmountInPaise ?? 0, "Accepted split repayment", true),
        pendingAmountInPaise: assertPaise(obligation.pendingAmountInPaise ?? 0, "Pending split repayment", true),
        splitStatus: String(split.status ?? ""),
      });
    }
  }
  const settlements = friendSettlementDocs.map((doc) => {
    const item = fsDocData(doc);
    return {
      id: doc.name?.split("/").at(-1) ?? "",
      fromUserId: typeof item.fromUserId === "string" ? item.fromUserId : "",
      toUserId: typeof item.toUserId === "string" ? item.toUserId : "",
      amountInPaise: item.amountInPaise,
      status: typeof item.status === "string" ? item.status : "",
      idempotencyKey: typeof item.idempotencyKey === "string" ? item.idempotencyKey : undefined,
      settlementMode: typeof item.settlementMode === "string" ? item.settlementMode : undefined,
      settlementGroupUserIds: Array.isArray(item.settlementGroupUserIds) ? item.settlementGroupUserIds.filter((id): id is string => typeof id === "string") : undefined,
    };
  });
  const plan = calculateFriendshipAwarePlan(
    obligations,
    settlements as Array<{
      id: string; fromUserId: string; toUserId: string; amountInPaise: number;
      status: string; idempotencyKey?: string;
    }>,
    friendKeys,
    { focusUserId },
  );
  return plan;
}

/**
 * Return only the connected shared-expense network containing uid. A split
 * connects its participants and payer; accepted friend settlements preserve
 * a connection after payment. This stops unrelated expense groups from
 * settling against each other and keeps other groups' balances private.
 */
async function getConnectedNetworkUserIdsInTransaction(
  uid: string,
  transactionId: string,
): Promise<Set<string>> {
  const [splitDocs, friendSettlementDocs] = await Promise.all([
    queryEntireCollectionInTransaction("splits", transactionId),
    queryEntireCollectionInTransaction("friendSettlements", transactionId),
  ]);
  const adjacency = new Map<string, Set<string>>();
  const connectGroup = (rawIds: unknown[]) => {
    const ids = [...new Set(rawIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
    for (const id of ids) if (!adjacency.has(id)) adjacency.set(id, new Set<string>());
    for (const id of ids) for (const other of ids) if (id !== other) adjacency.get(id)!.add(other);
  };

  for (const doc of splitDocs) {
    const split = fsDocData(doc);
    if (split.status === "cancelled") continue;
    const obligations = Array.isArray(split.obligations)
      ? split.obligations as Array<Record<string, unknown>>
      : [];
    connectGroup([
      ...(Array.isArray(split.participantIds) ? split.participantIds : []),
      ...obligations.flatMap((obligation) => [obligation.fromUserId, obligation.toUserId]),
      split.createdBy,
      split.paidByUserId,
    ]);
  }
  for (const doc of friendSettlementDocs) {
    const settlement = fsDocData(doc);
    if (settlement.status === "accepted") connectGroup([settlement.fromUserId, settlement.toUserId]);
  }

  const visited = new Set<string>();
  const stack = [uid];
  while (stack.length) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const neighbor of adjacency.get(current) ?? []) if (!visited.has(neighbor)) stack.push(neighbor);
  }
  return visited;
}

async function getNetworkNetBalancesForUser(
  uid: string,
): Promise<{
  balances: Record<string, number>;
  suggestions: Array<{ fromUserId: string; toUserId: string; amountInPaise: number }>;
  unresolvedObligations: Array<{
    fromUserId: string; toUserId: string; amountInPaise: number;
    reason: "not_currently_mutual_friends";
  }>;
  algorithmVersion: 4;
}> {
  const transactionId = await beginFirestoreTransaction();
  try {
    // A single Firestore transaction keeps the component and balance reads on
    // the same snapshot. It is read-only and is always rolled back.
    await getFirestoreDocumentInTransaction(SETTLEMENT_LEDGER_LOCK_PATH, transactionId);
    const friendLedger = await getFriendOnlyNetBalancesInTransaction(transactionId);
    const userBalance = friendLedger.balances[uid] ?? 0;
    // Only the caller's net balance and pairwise suggestions involving that caller
    // leave the trusted backend. Other participants' financial positions stay private.
    const [splitDocs, friendSettlementDocs] = await Promise.all([
      queryEntireCollectionInTransaction("splits", transactionId),
      queryEntireCollectionInTransaction("friendSettlements", transactionId),
    ]);
    const plan = simplifyFriendPairObligations(splitDocs, friendSettlementDocs, friendLedger.friendKeys, uid);
    // Derive source-split display statuses on the trusted backend using the full
    // ledger. A client only sees splits it participates in, which is insufficient
    // to determine whether the rest of a clique has completed its net payments.
    const displayObligations = splitDocs.flatMap((doc) => {
      const split = fsDocData(doc);
      if (split.status === "cancelled") return [];
      const splitId = doc.name?.split("/").at(-1) ?? "";
      const rows = Array.isArray(split.obligations)
        ? split.obligations as Array<Record<string, unknown>> : [];
      return rows.map((obligation) => ({
        splitId,
        fromUserId: typeof obligation.fromUserId === "string" ? obligation.fromUserId : "",
        toUserId: typeof obligation.toUserId === "string" ? obligation.toUserId : "",
        amountInPaise: assertPaise(obligation.amountInPaise, "Split obligation", true),
        acceptedAmountInPaise: assertPaise(obligation.acceptedAmountInPaise ?? 0, "Accepted split repayment", true),
      }));
    });
    const displayFriendSettlements = friendSettlementDocs.map((doc) => {
      const item = fsDocData(doc);
      return {
        id: doc.name?.split("/").at(-1) ?? "",
        fromUserId: String(item.fromUserId ?? ""),
        toUserId: String(item.toUserId ?? ""),
        amountInPaise: assertPaise(item.amountInPaise, "Friend settlement amount", true),
        status: String(item.status ?? ""),
        idempotencyKey: typeof item.idempotencyKey === "string" ? item.idempotencyKey : undefined,
        settlementMode: typeof item.settlementMode === "string" ? item.settlementMode : undefined,
        settlementGroupUserIds: Array.isArray(item.settlementGroupUserIds)
          ? item.settlementGroupUserIds.filter((id): id is string => typeof id === "string")
          : undefined,
      };
    });
    const allSplitSettlementStatuses = deriveNetSettlementSplitStatuses(displayObligations, displayFriendSettlements);
    // The response exposes status IDs only for splits this caller can already
    // read as a participant/creator. Other group members' obligations are used
    // for the aggregate calculation but their split metadata stays private.
    const visibleSplitIds = new Set(splitDocs.flatMap((doc) => {
      const split = fsDocData(doc);
      const participantIds = Array.isArray(split.participantIds) ? split.participantIds : [];
      return participantIds.includes(uid) || split.createdBy === uid
        ? [doc.name?.split("/").at(-1) ?? ""]
        : [];
    }));
    const splitSettlementStatuses = Object.fromEntries(
      Object.entries(allSplitSettlementStatuses).filter(([splitId]) => visibleSplitIds.has(splitId)),
    );
    await firestoreRequest(":rollback", { method: "POST", body: JSON.stringify({ transaction: transactionId }) });
    return {
      balances: { [uid]: userBalance },
      suggestions: plan.suggestions,
      unresolvedObligations: plan.unresolvedObligations,
      splitSettlementStatuses,
      algorithmVersion: 4,
    };
  } catch (error) {
    try { await firestoreRequest(":rollback", { method: "POST", body: JSON.stringify({ transaction: transactionId }) }); } catch {}
    throw error;
  }
}

/**
 * Pending split repayments and pending friend-level requests reserve net
 * capacity for both participants. They are not treated as accepted payments.
 */
type ReservationExclusions = {
  friendSettlementId?: string;
  splitRepayment?: {
    splitId: string;
    fromUserId: string;
    toUserId: string;
    amountInPaise: number;
  };
};

async function getNetworkReservationsInTransaction(
  transactionId: string,
  exclusions: ReservationExclusions = {},
): Promise<Record<string, number>> {
  const [splitDocs, friendSettlementDocs, friendKeys] = await Promise.all([
    queryEntireCollectionInTransaction("splits", transactionId),
    queryEntireCollectionInTransaction("friendSettlements", transactionId),
    getAcceptedFriendshipKeysInTransaction(transactionId),
  ]);
  const reserved: Record<string, number> = {};
  const reserve = (userId: string, amount: number) => {
    if (!userId || amount <= 0) return;
    reserved[userId] = addSafePaise(reserved[userId] ?? 0, amount, "Pending reservation total");
  };

  for (const doc of splitDocs) {
    const split = fsDocData(doc);
    if (split.status === "cancelled") continue;
    const splitId = doc.name?.split("/").at(-1) ?? "";
    const obligations = Array.isArray(split.obligations)
      ? split.obligations as Array<Record<string, unknown>>
      : [];
    for (const obligation of obligations) {
      let amount = assertPaise(obligation.pendingAmountInPaise ?? 0, "Pending split repayment", true);
      const excluded = exclusions.splitRepayment;
      if (
        excluded && splitId === excluded.splitId
        && obligation.fromUserId === excluded.fromUserId
        && obligation.toUserId === excluded.toUserId
      ) {
        // The pending split amount being accepted is already reserved. Remove
        // only this request, retaining every other pending request's reservation.
        amount -= excluded.amountInPaise;
        if (amount < 0) throw new Error("Pending split repayment reservation is inconsistent");
      }
      const fromUserId = String(obligation.fromUserId ?? "");
      const toUserId = String(obligation.toUserId ?? "");
      if (amount > 0 && fromUserId && toUserId && friendKeys.has(friendshipKey(fromUserId, toUserId))) {
        reserve(fromUserId, amount);
        reserve(toUserId, amount);
      }
    }
  }

  const uniqueFriendSettlements = deduplicateFriendSettlementRecords(friendSettlementDocs.map((doc) => {
    const item = fsDocData(doc);
    return {
      id: doc.name?.split("/").at(-1) ?? "",
      fromUserId: String(item.fromUserId ?? ""),
      toUserId: String(item.toUserId ?? ""),
      amountInPaise: item.amountInPaise as number,
      status: String(item.status ?? ""),
      idempotencyKey: typeof item.idempotencyKey === "string" ? item.idempotencyKey : undefined,
    };
  }));
  for (const settlement of uniqueFriendSettlements) {
    if (settlement.id === exclusions.friendSettlementId || settlement.status !== "pending") continue;
    const fromUserId = settlement.fromUserId;
    const toUserId = settlement.toUserId;
    if (!fromUserId || !toUserId || !friendKeys.has(friendshipKey(fromUserId, toUserId))) continue;
    const amount = assertPaise(settlement.amountInPaise, "Pending friend settlement", true);
    reserve(fromUserId, amount);
    reserve(toUserId, amount);
  }
  return reserved;
}

function availableDebtorCapacity(
  userId: string,
  balances: Record<string, number>,
  reservations: Record<string, number>,
): number {
  return Math.max(0, -(balances[userId] ?? 0) - (reservations[userId] ?? 0));
}

function availableCreditorCapacity(
  userId: string,
  balances: Record<string, number>,
  reservations: Record<string, number>,
): number {
  return Math.max(0, (balances[userId] ?? 0) - (reservations[userId] ?? 0));
}

async function assertUsersAreFriendsInTransaction(
  userA: string,
  userB: string,
  transactionId: string,
): Promise<void> {
  if (userA === userB) throw new Error("A repayment cannot be between the same user");
  const [forward, reverse] = await Promise.all([
    getFirestoreDocumentInTransaction(`friends/${userA}_${userB}`, transactionId),
    getFirestoreDocumentInTransaction(`friends/${userB}_${userA}`, transactionId),
  ]);
  if (!forward || !reverse) throw new Error("Repayments are allowed only between mutually accepted friends");
  const forwardData = fsDocData(forward);
  const reverseData = fsDocData(reverse);
  if (
    forwardData.userId !== userA || forwardData.friendId !== userB
    || reverseData.userId !== userB || reverseData.friendId !== userA
  ) {
    throw new Error("Friendship records are inconsistent; the repayment is not authorized");
  }
}

async function requestFriendSettlement(
  uid: string,
  data: Record<string, unknown>,
): Promise<{ settlementId: string }> {
  const toUserId = assertId(data.toUserId, "Recipient user ID");
  const amountInPaise = assertPaise(data.amountInPaise, "Settlement amount");
  const idempotencyKey = assertId(data.idempotencyKey, "Idempotency key");
  const fromProfileId = assertId(data.fromProfileId, "Payer profile ID");
  const fromAccountId = assertId(data.fromAccountId, "Payer account ID");
  if (uid === toUserId) throw new Error("You cannot settle a balance with yourself");
  if (idempotencyKey.length > 200) throw new Error("Idempotency key is too long");

  const settlementId = await sha256Hex(`friend-settlement\u0000${uid}\u0000${idempotencyKey}`);
  const settlementPath = `friendSettlements/${settlementId}`;
  const transactionId = await beginFirestoreTransaction();

  try {
    // Every balance-changing operation reads and writes the same lock document.
    // This prevents concurrent requests from both spending the same net balance.
    const ledgerLockDoc = await getFirestoreDocumentInTransaction(SETTLEMENT_LEDGER_LOCK_PATH, transactionId);
    const [existing, payerProfileDoc, payerAccountDoc] = await Promise.all([
      getFirestoreDocumentInTransaction(settlementPath, transactionId),
      getFirestoreDocumentInTransaction(`profiles/${fromProfileId}`, transactionId),
      getFirestoreDocumentInTransaction(`profiles/${fromProfileId}/accounts/${fromAccountId}`, transactionId),
    ]);
    if (!payerProfileDoc || fsDocData(payerProfileDoc).userId !== uid) throw new Error("The selected payer profile does not belong to you");
    if (!payerAccountDoc) throw new Error("The selected payer account was not found");

    if (existing) {
      const previous = fsDocData(existing);
      if (previous.fromUserId !== uid || previous.toUserId !== toUserId || previous.amountInPaise !== amountInPaise) {
        throw new Error("That idempotency key was already used for a different request");
      }
      await firestoreRequest(":rollback", { method: "POST", body: JSON.stringify({ transaction: transactionId }) });
      return { settlementId };
    }

    // A request does not debit the account yet, but don't let users propose a
    // payment their selected funding account cannot currently cover. We repeat
    // the check at acceptance because the balance may change while it is pending.
    const payerAccountForRequest = fsDocData(payerAccountDoc);
    const payerBalanceForRequest = Number(payerAccountForRequest.balance ?? 0);
    if (!Number.isFinite(payerBalanceForRequest)) {
      throw new Error("The selected payer account has an invalid balance");
    }
    const availablePaiseForRequest = Math.round(payerBalanceForRequest * 100);
    if (availablePaiseForRequest < amountInPaise) {
      const accountName = typeof payerAccountForRequest.name === "string" && payerAccountForRequest.name.trim()
        ? payerAccountForRequest.name.trim()
        : "selected account";
      throw new Error(`Insufficient balance in ${accountName}. Available ₹${(availablePaiseForRequest / 100).toFixed(2)}, required ₹${(amountInPaise / 100).toFixed(2)}. Choose another account or add funds first.`);
    }

    await assertUsersAreFriendsInTransaction(uid, toUserId, transactionId);
    const networkUserIds = await getConnectedNetworkUserIdsInTransaction(uid, transactionId);
    if (!networkUserIds.has(toUserId)) {
      throw new Error("The recipient is not part of your connected shared-expense network");
    }
    const validation = await getFriendSettlementValidationInTransaction(uid, toUserId, transactionId, { mode: "auto" });
    if (validation.availableAmountInPaise <= 0) {
      throw new Error(validation.settlementMode === "clique_net"
        ? "The group net balances do not show that you currently owe this friend. Refresh the suggestions."
        : "The friend-to-friend ledger does not show that you owe this friend");
    }
    if (amountInPaise > validation.availableAmountInPaise) {
      throw new Error(`Amount exceeds the currently available net settlement balance of ₹${(validation.availableAmountInPaise / 100).toFixed(2)}`);
    }

    const record: FriendSettlementRecord = {
      fromUserId: uid,
      toUserId,
      participantIds: [uid, toUserId],
      amountInPaise,
      status: "pending",
      idempotencyKey,
      fromProfileId,
      fromAccountId,
      ...(typeof data.note === "string" && data.note.trim() ? { note: data.note.trim().slice(0, 500) } : {}),
      createdAt: new Date().toISOString(),
      ...(validation.settlementMode === "clique_net" ? {
        settlementMode: "clique_net" as const,
        settlementGroupUserIds: validation.settlementGroupUserIds,
      } : { settlementMode: "bilateral" as const }),
    };
    const writes: unknown[] = [
      {
        update: {
          name: fsDocumentName(settlementPath),
          fields: Object.fromEntries(Object.entries(record).map(([key, value]) => [key, fsEncode(value)])),
        },
        currentDocument: { exists: false },
      },
      settlementLedgerLockWrite(ledgerLockDoc),
    ];
    await commitFirestoreTransaction(transactionId, writes);
    return { settlementId };
  } catch (error) {
    try { await firestoreRequest(":rollback", { method: "POST", body: JSON.stringify({ transaction: transactionId }) }); } catch {}
    throw error;
  }
}

async function acceptFriendSettlement(
  uid: string,
  data: Record<string, unknown>,
): Promise<{ accepted: boolean }> {
  const settlementId = assertId(data.settlementId, "Settlement ID");
  const recipientProfileId = assertId(data.recipientProfileId, "Recipient profile ID");
  const recipientAccountId = assertId(data.recipientAccountId, "Recipient account ID");
  const settlementPath = `friendSettlements/${settlementId}`;
  const transactionId = await beginFirestoreTransaction();

  try {
    const ledgerLockDoc = await getFirestoreDocumentInTransaction(SETTLEMENT_LEDGER_LOCK_PATH, transactionId);
    const settlementDoc = await getFirestoreDocumentInTransaction(settlementPath, transactionId);
    if (!settlementDoc) throw new Error("Friend settlement request not found");
    const settlement = fsDocData(settlementDoc);
    if (settlement.status === "accepted") {
      await firestoreRequest(":rollback", { method: "POST", body: JSON.stringify({ transaction: transactionId }) });
      return { accepted: true };
    }
    if (settlement.status !== "pending") throw new Error("Only pending requests can be accepted");
    if (settlement.toUserId !== uid) throw new Error("Only the recipient can accept this request");

    const fromUserId = assertId(settlement.fromUserId, "Debtor user ID");
    const amountInPaise = assertPaise(settlement.amountInPaise, "Settlement amount");
    const fromProfileId = assertId(settlement.fromProfileId, "Payer profile ID");
    const fromAccountId = assertId(settlement.fromAccountId, "Payer account ID");
    await assertUsersAreFriendsInTransaction(fromUserId, uid, transactionId);
    const networkUserIds = await getConnectedNetworkUserIdsInTransaction(uid, transactionId);
    if (!networkUserIds.has(fromUserId)) throw new Error("The sender is no longer in your connected shared-expense network");

    const [payerProfileDoc, payerAccountDoc, recipientProfileDoc, recipientAccountDoc] = await Promise.all([
      getFirestoreDocumentInTransaction(`profiles/${fromProfileId}`, transactionId),
      getFirestoreDocumentInTransaction(`profiles/${fromProfileId}/accounts/${fromAccountId}`, transactionId),
      getFirestoreDocumentInTransaction(`profiles/${recipientProfileId}`, transactionId),
      getFirestoreDocumentInTransaction(`profiles/${recipientProfileId}/accounts/${recipientAccountId}`, transactionId),
    ]);
    if (!payerProfileDoc || fsDocData(payerProfileDoc).userId !== fromUserId) throw new Error("The selected payer profile no longer belongs to the sender");
    if (!payerAccountDoc) throw new Error("The selected payer account was not found");
    if (!recipientProfileDoc || fsDocData(recipientProfileDoc).userId !== uid) throw new Error("The selected receiving profile does not belong to you");
    if (!recipientAccountDoc) throw new Error("The selected receiving account was not found");

    // Exclude this request from pending reservations when validating acceptance.
    // The settlement mode was chosen on the server at request time and cannot be
    // downgraded or changed by the client.
    const settlementMode = settlement.settlementMode === "clique_net" ? "clique_net" : "bilateral";
    const validation = await getFriendSettlementValidationInTransaction(fromUserId, uid, transactionId, {
      excludePendingSettlementId: settlementId,
      mode: settlementMode,
      ...(settlementMode === "clique_net" ? {
        expectedGroupUserIds: Array.isArray(settlement.settlementGroupUserIds)
          ? settlement.settlementGroupUserIds.filter((id): id is string => typeof id === "string")
          : [],
      } : {}),
    });
    if (amountInPaise > validation.availableAmountInPaise) {
      throw new Error(settlementMode === "clique_net"
        ? "The group net balance changed. This request can no longer be accepted for that amount."
        : "The bilateral friend balance changed. This request can no longer be accepted for that amount.");
    }

    const payerAccount = fsDocData(payerAccountDoc);
    const recipientAccount = fsDocData(recipientAccountDoc);
    const payerBalance = Number(payerAccount.balance ?? 0);
    const recipientBalance = Number(recipientAccount.balance ?? 0);
    if (!Number.isFinite(payerBalance) || !Number.isFinite(recipientBalance)) {
      throw new Error("Both selected accounts must have valid numeric balances");
    }
    const payerBalancePaise = Math.round(payerBalance * 100);
    if (payerBalancePaise < amountInPaise) {
      const accountName = typeof payerAccount.name === "string" && payerAccount.name.trim()
        ? payerAccount.name.trim()
        : "selected account";
      throw new Error(`Insufficient balance in ${accountName}. Available ₹${(payerBalancePaise / 100).toFixed(2)}, required ₹${(amountInPaise / 100).toFixed(2)}. The sender must add funds or cancel and resend from a funded account.`);
    }
    const amount = amountInPaise / 100;
    const now = new Date().toISOString();
    const date = now.slice(0, 10);
    const payerAccountName = typeof payerAccount.name === "string" ? payerAccount.name : "selected account";
    const recipientAccountName = typeof recipientAccount.name === "string" ? recipientAccount.name : "selected account";
    const payerTxHash = await sha256Hex(`friend-settlement\u0000${settlementId}\u0000${fromUserId}`);
    const recipientTxHash = await sha256Hex(`friend-settlement\u0000${settlementId}\u0000${uid}`);
    const payerTransactionId = `friend_pay_${payerTxHash.slice(0, 40)}`;
    const recipientTransactionId = `friend_pay_${recipientTxHash.slice(0, 40)}`;
    const payerTransactionPath = `profiles/${fromProfileId}/transactions/${payerTransactionId}`;
    const recipientTransactionPath = `profiles/${recipientProfileId}/transactions/${recipientTransactionId}`;
    const payerTransaction = {
      profileId: fromProfileId, userId: fromUserId, type: "expense", amount, amountInPaise,
      currency: "INR", category: "Friend Settlement", categoryId: "friend-settlement",
      categoryIcon: "↗️", paymentMode: "friend-settlement", accountId: fromAccountId,
      notes: `Settlement payment via ${payerAccountName}`, date, kind: "repayment",
      settlementId, friendSettlementId: settlementId, counterpartyUserId: uid,
      sourceProfileId: fromProfileId, sourceTransactionId: null,
      createdAt: now, updatedAt: now, serverGenerated: true,
    };
    const recipientTransaction = {
      profileId: recipientProfileId, userId: uid, type: "income", amount, amountInPaise,
      currency: "INR", category: "Friend Settlement Received", categoryId: "friend-settlement",
      categoryIcon: "↙️", paymentMode: "friend-settlement", accountId: recipientAccountId,
      notes: `Settlement received via ${recipientAccountName}`, date, kind: "repayment",
      settlementId, friendSettlementId: settlementId, counterpartyUserId: fromUserId,
      sourceProfileId: recipientProfileId, sourceTransactionId: null,
      createdAt: now, updatedAt: now, serverGenerated: true,
    };

    await commitFirestoreTransaction(transactionId, [
      { update: { name: fsDocumentName(payerTransactionPath), fields: Object.fromEntries(Object.entries(payerTransaction).map(([key, value]) => [key, fsEncode(value)])) }, currentDocument: { exists: false } },
      { update: { name: fsDocumentName(recipientTransactionPath), fields: Object.fromEntries(Object.entries(recipientTransaction).map(([key, value]) => [key, fsEncode(value)])) }, currentDocument: { exists: false } },
      { update: { name: fsDocumentName(`profiles/${fromProfileId}/accounts/${fromAccountId}`), fields: { balance: fsEncode((payerBalancePaise - amountInPaise) / 100), updatedAt: fsEncode(now) } }, updateMask: { fieldPaths: ["balance", "updatedAt"] }, currentDocument: { exists: true } },
      { update: { name: fsDocumentName(`profiles/${recipientProfileId}/accounts/${recipientAccountId}`), fields: { balance: fsEncode(Math.round((recipientBalance + amount) * 100) / 100), updatedAt: fsEncode(now) } }, updateMask: { fieldPaths: ["balance", "updatedAt"] }, currentDocument: { exists: true } },
      { update: { name: fsDocumentName(settlementPath), fields: Object.fromEntries(Object.entries({ status: "accepted", acceptedAt: now, acceptedBy: uid, recipientProfileId, recipientAccountId, payerTransactionId, recipientTransactionId }).map(([key, value]) => [key, fsEncode(value)])) }, updateMask: { fieldPaths: ["status", "acceptedAt", "acceptedBy", "recipientProfileId", "recipientAccountId", "payerTransactionId", "recipientTransactionId"] }, currentDocument: { exists: true } },
      settlementLedgerLockWrite(ledgerLockDoc),
    ]);
    return { accepted: true };
  } catch (error) {
    try { await firestoreRequest(":rollback", { method: "POST", body: JSON.stringify({ transaction: transactionId }) }); } catch {}
    throw error;
  }
}

async function closeFriendSettlement(
  uid: string,
  data: Record<string, unknown>,
  terminalStatus: "rejected" | "cancelled",
): Promise<{ rejected?: boolean; cancelled?: boolean }> {
  const settlementId = assertId(data.settlementId, "Settlement ID");
  const settlementPath = `friendSettlements/${settlementId}`;
  const transactionId = await beginFirestoreTransaction();

  try {
    const ledgerLockDoc = await getFirestoreDocumentInTransaction(SETTLEMENT_LEDGER_LOCK_PATH, transactionId);
    const settlementDoc = await getFirestoreDocumentInTransaction(
      settlementPath,
      transactionId,
    );

    if (!settlementDoc) {
      throw new Error("Friend settlement request not found");
    }

    const settlement = fsDocData(settlementDoc);

    if (settlement.status === terminalStatus) {
      await firestoreRequest(":rollback", {
        method: "POST",
        body: JSON.stringify({ transaction: transactionId }),
      });

      return terminalStatus === "rejected"
        ? { rejected: true }
        : { cancelled: true };
    }

    if (settlement.status !== "pending") {
      throw new Error("Only pending requests can be closed");
    }

    const isAllowed =
      terminalStatus === "cancelled"
        ? settlement.fromUserId === uid
        : settlement.toUserId === uid;

    if (!isAllowed) {
      throw new Error(
        terminalStatus === "cancelled"
          ? "Only the sender can cancel this request"
          : "Only the recipient can reject this request",
      );
    }

    const timestampField =
      terminalStatus === "cancelled" ? "cancelledAt" : "rejectedAt";

    await commitFirestoreTransaction(transactionId, [
      {
        update: {
          name: fsDocumentName(settlementPath),
          fields: {
            status: fsEncode(terminalStatus),
            [timestampField]: fsEncode(new Date().toISOString()),
          },
        },
        updateMask: {
          fieldPaths: ["status", timestampField],
        },
        currentDocument: { exists: true },
      },
      settlementLedgerLockWrite(ledgerLockDoc),
    ]);

    return terminalStatus === "rejected"
      ? { rejected: true }
      : { cancelled: true };
  } catch (error) {
    try {
      await firestoreRequest(":rollback", {
        method: "POST",
        body: JSON.stringify({ transaction: transactionId }),
      });
    } catch {
      // Ignore cleanup error; preserve original error.
    }

    throw error;
  }
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
    const ledgerLockDoc = await getFirestoreDocumentInTransaction(SETTLEMENT_LEDGER_LOCK_PATH, transactionId);
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

    writes.push(settlementLedgerLockWrite(ledgerLockDoc));
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
    const ledgerLockDoc = await getFirestoreDocumentInTransaction(SETTLEMENT_LEDGER_LOCK_PATH, transactionId);
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

    await assertUsersAreFriendsInTransaction(uid, payerUid, transactionId);
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

    // Split-specific repayments and global friend-level settlements share one
    // net ledger. Reserve against the sender's current net debt so a prior or
    // pending global payment cannot be collected again through a split.
    const { balances } = await getFriendOnlyNetBalancesInTransaction(transactionId);
    const reservations = await getNetworkReservationsInTransaction(transactionId);
    const availableNetDebt = availableDebtorCapacity(uid, balances, reservations);
    if ((balances[uid] ?? 0) >= 0 || amountInPaise > availableNetDebt) {
      throw new Error(
        `Repayment exceeds your available net debt of ₹${(availableNetDebt / 100).toFixed(2)} after pending requests`,
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

    const writes: unknown[] = [
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

    writes.push(settlementLedgerLockWrite(ledgerLockDoc));
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
    const ledgerLockDoc = await getFirestoreDocumentInTransaction(SETTLEMENT_LEDGER_LOCK_PATH, tx);
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
    await assertUsersAreFriendsInTransaction(String(settlement.fromUserId), uid, tx);
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

    const { balances } = await getFriendOnlyNetBalancesInTransaction(tx);
    const reservations = await getNetworkReservationsInTransaction(tx, {
      splitRepayment: {
        splitId,
        fromUserId: String(settlement.fromUserId),
        toUserId: uid,
        amountInPaise: amount,
      },
    });
    const availableNetDebt = availableDebtorCapacity(String(settlement.fromUserId), balances, reservations);
    if ((balances[String(settlement.fromUserId)] ?? 0) >= 0 || amount > availableNetDebt) {
      throw new Error(
        `The sender's net debt changed. This repayment can no longer be accepted for that amount (available ₹${(availableNetDebt / 100).toFixed(2)}).`,
      );
    }

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

    writes.push(settlementLedgerLockWrite(ledgerLockDoc));
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
    const ledgerLockDoc = await getFirestoreDocumentInTransaction(SETTLEMENT_LEDGER_LOCK_PATH, tx);
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
      settlementLedgerLockWrite(ledgerLockDoc),
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
    const ledgerLockDoc = await getFirestoreDocumentInTransaction(SETTLEMENT_LEDGER_LOCK_PATH, tx);
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
    const acceptedFriendSettlementDocs = await queryEntireCollectionInTransaction("friendSettlements", tx);
    const splitObligations = Array.isArray(split.obligations)
      ? split.obligations as Array<Record<string, unknown>>
      : [];
    const hasAcceptedNetSettlement = acceptedFriendSettlementDocs.some((doc) => {
      const item = fsDocData(doc);
      if (item.status !== "accepted") return false;
      const fromUserId = typeof item.fromUserId === "string" ? item.fromUserId : "";
      const toUserId = typeof item.toUserId === "string" ? item.toUserId : "";
      if (!fromUserId || !toUserId) return false;
      if (item.settlementMode === "clique_net") {
        const group = Array.isArray(item.settlementGroupUserIds)
          ? item.settlementGroupUserIds.filter((id): id is string => typeof id === "string")
          : [];
        const members = new Set(group);
        return splitObligations.some((obligation) =>
          members.has(String(obligation.fromUserId ?? ""))
          && members.has(String(obligation.toUserId ?? "")),
        );
      }
      return splitObligations.some((obligation) =>
        (obligation.fromUserId === fromUserId && obligation.toUserId === toUserId)
        || (obligation.fromUserId === toUserId && obligation.toUserId === fromUserId),
      );
    });
    if (hasAcceptedNetSettlement) {
      throw new Error("This split is already associated with an accepted friend-level net settlement and cannot be cancelled while that settlement is being reconciled.");
    }
    // Friend-level settlements are global transfers, not written into this split.
    // Accepted transfers unrelated to this split remain in the network ledger; a
    // pending friend request must pass a fresh balance check before acceptance.
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
    writes.push(settlementLedgerLockWrite(ledgerLockDoc));
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

    if (req.method === 'POST' && url.pathname.endsWith('/request-friend-settlement')) {
      const body = await req.json() as Record<string, unknown>;
      const result = await requestFriendSettlement(uid, body);
      return Response.json(result, { status: 201, headers: corsHeaders });
    }

    if (req.method === 'POST' && url.pathname.endsWith('/accept-friend-settlement')) {
      const body = await req.json() as Record<string, unknown>;
      const result = await acceptFriendSettlement(uid, body);
      return Response.json(result, { status: 200, headers: corsHeaders });
    }

    if (req.method === 'POST' && url.pathname.endsWith('/reject-friend-settlement')) {
      const body = await req.json() as Record<string, unknown>;
      const result = await closeFriendSettlement(uid, body, 'rejected');
      return Response.json(result, { status: 200, headers: corsHeaders });
    }

    if (req.method === 'POST' && url.pathname.endsWith('/cancel-friend-settlement')) {
      const body = await req.json() as Record<string, unknown>;
      const result = await closeFriendSettlement(uid, body, 'cancelled');
      return Response.json(result, { status: 200, headers: corsHeaders });
    }

    if (req.method === "POST" && url.pathname.endsWith("/get-network-net-balances")) {
      const result = await getNetworkNetBalancesForUser(uid);
      return Response.json(result, { status: 200, headers: corsHeaders });
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

# Finance App

An Expo / React Native personal-finance app backed by Firebase Authentication and Cloud Firestore. It currently includes authentication, multiple finance profiles, dashboard insights, transactions, account records, friend requests, and shared-expense splits. Goal, budget, investment, and net-worth data services are also present.

## Run locally

1. Install Node.js 22 or newer and project dependencies with `npm install`.
2. Configure the Firebase client in `src/firebaseConfig.ts` for the Firebase project associated with this app. The client API key is not a server secret; restrict it in Google Cloud and rely on Authentication and Firestore Rules for data protection. Never place service-account credentials in the app.
3. Start Expo with `npm run dev`.
4. Use `npm run typecheck` and `npm run lint` to check the workspace.

## Architecture

- `app/` contains Expo Router routes; most route files delegate to screens in `src/screens/`.
- `src/context/` holds authentication and active-profile state.
- `src/services/firebase/` contains Firestore access functions.
- `src/services/ai/` contains locally generated financial insights; it is not a hosted AI integration.
- `functions/` contains Firebase Cloud Functions (Node.js 22).
- `types/finance.ts` and `src/utils/validation.ts` define shared data types and input validation.

## Firestore layout

Firestore is a document database. Important collections and current document fields are:

| Collection / path | Current purpose and fields |
| --- | --- |
| `users/{uid}` | User display name, email, and creation time. Firebase Auth stores credentials. |
| `profiles/{profileId}` | `userId`, `name`, normalized `nameLower`, `type`, `emoji`, `currency`, `isDefault`, timestamps. |
| `profiles/{profileId}/members/{uid}` | Membership role, inviter, creation time. |
| `profiles/{profileId}/transactions/{id}` | `profileId`, `userId`, `type`, positive rupee `amount`, `categoryId`, display `category`, `categoryIcon`, `paymentMode`, optional `accountId` and `notes`, local `date` in `YYYY-MM-DD`, `currency`, timestamps. Server-owned split rows additionally carry `amountInPaise`, `kind` (`allocation` or `repayment`), `splitId`, source references and transaction counterpart metadata. Repayment rows are excluded from income/expense and budget totals. |
| `profiles/{profileId}/accounts/{id}` | `name`, `type`, starting `balance`, optional `account_number`, `currency`, timestamps. |
| `profiles/{profileId}/budgets/{category_year_month}` | `categoryId`, `month`, `year`, `limitAmount`, timestamps. |
| `profiles/{profileId}/goals/{id}` | Caller-provided goal fields and timestamps. |
| `profiles/{profileId}/investments/{id}` | Caller-provided investment fields and timestamps. |
| `profiles/{profileId}/investments/{id}/transactions/{txId}` | Caller-provided investment transaction fields and creation time. |
| `profiles/{profileId}/netWorthSnapshots/{year_month}` | `month`, `year`, `assets`, `liabilities`, `netWorth`, creation time. |
| `categories/{id}` | Category ID, `name`, `type`, `icon`, `color`, and `parent_id`. IDs are shared with the transaction composer. |
| `friendRequests/{sender_uid}_{recipient_uid}` | `fromUserId`, `toUserId`, `status`, timestamps. Accepted requests remain as records. |
| `friends/{user_uid}_{friend_uid}` | One directional relationship (`userId`, `friendId`, `connectedAt`); accepted friendships have both directions. |
| `splits/{id}` | INR paise ledger: `createdBy === paidByUserId`, `sourceProfileId`, `sourceTransactionId`, `totalAmountInPaise`, participant allocation snapshots, per-debtor obligation summaries, `participantIds`, settlement/finalization statuses, source date/category snapshots and allocation transaction references. Creator may be excluded from allocation participants. |
| `splits/{id}/settlements/{id}` | Immutable repayment acknowledgment history with `fromUserId`, `toUserId`, `amountInPaise`, sender/recipient profile IDs, `pending`/`accepted`/`rejected`/`cancelled` status, idempotency key and counterpart transaction references. Only accepted acknowledgments reduce obligations. |
| `splitSourceLocks/{profileId}/transactions/{transactionId}` | Server-only claim preventing the same source expense from being linked to multiple non-cancelled splits. |

The split/settlement schema is defined in `types/finance.ts`. Existing pre-ledger split documents are ignored by calculations rather than interpreting legacy `participants[].paid` flags as payments; no historical split backfill is included.

## Shared expenses and settlements

- The split creator is the payer and must link an existing INR expense in their own active profile. The source transaction is not modified. A source expense can be claimed by only one non-cancelled split.
- Allocation participants may include or exclude the creator. Their integer-paise shares must sum exactly to the source expense. An excluded creator has zero consumption allocation; an included creator's share is handled like any other allocation and never creates a self-repayment.
- A debtor submits a pending acknowledgment. Only the creditor can accept or reject it; the sender may cancel while pending. Acceptance atomically creates one Split Income and one Split Expense repayment transaction. Transfers do not count as ordinary income, consumption, budget spending or savings income.
- Final Split Expense allocation transaction rows are written to each participant's default profile only when all required obligations have been accepted. They are written atomically with split finalization and retain their profile and source transaction references. Reports exclude the source gross when appropriate and count final allocations once.
- Split mutations and server-generated transaction classifications are Cloud Function-only. Configure the project credentials in `src/firebaseConfig.ts`; deploy the Functions and Firestore Rules before enabling split creation in production.

For local Rules tests, run `npm run test:rules`. For callable/Auth/Firestore integration tests, run `npm run test:functions`. To connect the Expo client to local emulators, set `EXPO_PUBLIC_USE_FIREBASE_EMULATORS=true`; optionally set `EXPO_PUBLIC_FIREBASE_EMULATOR_HOST` for a device-accessible host. Emulator use is opt-in and production remains the default.

## Firestore security and indexes

`firestore.rules` and `firestore.indexes.json` are connected in `firebase.json`. Review the rules against your Firebase project before deploying. Profile documents are readable to signed-in users for friend discovery; keep sensitive financial data in the protected profile subcollections. Category writes require an `admin` custom claim. Do not deploy the rules until the app workflows have been tested against the Firebase Emulator or a non-production project.

Deploy Functions, rules, and indexes with Firebase CLI using `firebase deploy --only functions,firestore:rules,firestore:indexes`. The split source lock, transaction write restrictions, and settlement authorization depend on these rules and callable functions. TypeScript checks cannot verify Firestore Rules.

## Existing-data notes

- The app backfills `nameLower` on the signed-in user's profiles while loading them. Other users need to open the app once before they appear in indexed friend search.
- Existing transactions without `categoryId` are interpreted by category label in insight generation. New transactions store both `categoryId` and the display label.
- Account `balance` is currently the starting value entered when creating an account; transaction writes do not yet maintain account balances.
- Deleting a profile document does not recursively delete its subcollections. Add a server-side cascade before enabling destructive profile deletion in production.
- Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build:web` before deployment. Rules tests are in `tests/firestoreRules.test.mts`; callable integration tests are in `functions/test/emulator.test.js`.

## Investments & Portfolio module

The Investments tab tracks assets independently from daily income/expense entries. Supported asset classes are Fixed Deposits, Recurring Deposits, Mutual Funds, Stocks, and Other. A holding can store its provider, symbol/folio, units, notes, current value, and net invested capital.

### Screens

- **Portfolio** (`/(tabs)/investments`): consolidated current portfolio value, net invested capital, estimated gain/loss, allocation by asset class, portfolio-value history, holdings, and recent activity.
- **Add investment** (`/investments/add`): creates a holding and opening ledger entry without changing a bank account or the daily finance ledger.
- **Holding details** (`/investments/[investmentId]`): current value, invested capital, recorded gain/loss, quick actions, and per-holding history.
- **Investment ledger** (`/investments/ledger`): chronological activity with holding selection, search, and filters.
- **Record activity** (`/investments/activity`): contributions, withdrawals, interest, gains, losses, and market-value updates. These operations only update the investment portfolio.
- **Transfer in** (`/investments/transfer`): moves funds from a linked bank-type account to a holding. The bank balance debit, primary finance expense (`Investment Transfer`), investment holding update, investment inflow ledger entry, and portfolio snapshot are committed in a single Firestore transaction. A failed write rejects the entire transfer.

### Firestore model

- `profiles/{profileId}/investments/{investmentId}` stores the holding.
- `profiles/{profileId}/investments/{investmentId}/transactions/{transactionId}` stores that holding's independent ledger.
- `profiles/{profileId}/investmentSnapshots/{snapshotId}` stores a portfolio-value and net-invested snapshot after each committed portfolio action.
- `profiles/{profileId}/transactions/{transactionId}` is written by the investment module **only** for a bank-to-investment transfer, as an expense/outflow paired with the portfolio inflow.

Values are stored in rupees for compatibility with the rest of the app and also in integer paise fields for arithmetic accuracy. The portfolio graph reflects values recorded in these snapshots; it is not a live brokerage/market-price integration. Stock and mutual-fund prices need periodic manual market-value updates unless a quote feed is added later.

### Security rules

`firestore.rules` now grants profile members read access to `investmentSnapshots`, with writes limited to profile editors/owners like the investment holding and ledger collections. Deploy the updated rules with:

```sh
firebase deploy --only firestore:rules
# Personal Finance & Shared Expenses

A cross-platform personal-finance application built with **Expo, React Native, TypeScript, Firebase Authentication, and Cloud Firestore**. It combines day-to-day money tracking, multiple finance profiles, accounts, shared expenses and settlements, investment tracking, portfolio analytics, and downloadable statements in one app.

> **Project status:** The repository contains the mobile/web client, Firestore rules and indexes, Supabase Edge Functions for protected split and stock-market operations, and automated calculation/validation tests. Some backend/deployment configuration still needs to be aligned before a clean production deployment; see [Known integration gaps](#known-integration-gaps).

---

## Contents

- [What the app does](#what-the-app-does)
- [Feature guide](#feature-guide)
- [Technology stack](#technology-stack)
- [Application architecture](#application-architecture)
- [Routes and screens](#routes-and-screens)
- [Data model](#data-model)
- [Shared expenses and settlements](#shared-expenses-and-settlements)
- [Investments and portfolio accounting](#investments-and-portfolio-accounting)
- [Market data](#market-data)
- [Authentication and security](#authentication-and-security)
- [Getting started](#getting-started)
- [Environment configuration](#environment-configuration)
- [Firebase setup and deployment](#firebase-setup-and-deployment)
- [Supabase Edge Functions](#supabase-edge-functions)
- [Development commands](#development-commands)
- [Testing](#testing)
- [Data and accounting rules](#data-and-accounting-rules)
- [Known integration gaps](#known-integration-gaps)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

---

## What the app does

The application is designed around a simple idea: a user's finances should be organized in one place without mixing unrelated kinds of money movement.

It separates:

1. **Personal finance activity** — income, expenses, accounts, budgets, and statements.
2. **Shared expenses** — amounts owed between friends, repayment requests, and settlement history.
3. **Investments** — holdings, contributions, withdrawals, market values, returns, and an independent investment ledger.
4. **Profiles** — separate personal, family, business, or other finance spaces.

A profile is the main data boundary for everyday financial records. A user can switch between profiles while remaining signed in to the same account.

## Feature guide

### Dashboard and insights

- Overview of the selected profile's financial activity.
- Income and expense summaries.
- Recent transactions and category-level information.
- Locally generated insights based on transaction and budget data.
- Goal-related insight generation is available in the insights calculation layer.

The insights engine is implemented in `src/services/ai/insightsEngine.ts`. It generates insights from data available to the app; it is **not** a call to a hosted generative-AI service.

### Transactions

- Record income and expenses.
- Categorize entries and retain a display label/icon.
- Record payment mode, date, currency, optional account, and notes.
- Browse transaction history and open transaction details.
- Filter transaction lists.
- Record transfers between the user's own accounts separately from normal spending.
- View a statement and use the platform's print/share capabilities where supported.

Amounts are represented as positive values alongside a transaction `type` (`income` or `expense`). A transaction's direction is determined by its type, not by storing a negative amount.

### Accounts

- Create and view financial accounts.
- Store account type, opening balance, currency, and optional account number/reference.
- Assign transactions to accounts.
- Support cash-account creation/backfill and historical transaction assignment utilities.

**Important:** The account `balance` field currently represents the opening/starting balance entered when the account is created. Do not assume that all ordinary transaction writes automatically maintain a live account balance. The investment transfer workflows have their own explicit account debit logic.

### Budgets and goals

- Budget records are stored by profile, category, month, and year.
- Goal creation and goal-related insight logic are present.
- Budget and goal services are small data-access layers; check the corresponding screens and service implementation before assuming a full recurring-budget or goal-management workflow is complete.

### Friends and shared expenses

- Search for other users by profile name.
- Send, accept, reject, and remove friend connections.
- Create a shared expense from an existing expense paid by the creator.
- Split the expense equally or with custom participant allocations.
- Track each participant's obligation.
- Request, accept, reject, or cancel repayment acknowledgements.
- Review friend-level net balances and settlement suggestions.
- Keep an auditable settlement history.

Shared-expense amounts are stored as integer paise to avoid floating-point rounding errors. See [Shared expenses and settlements](#shared-expenses-and-settlements).

### Investments and portfolio

Supported asset classes:

- Fixed Deposits (FD)
- Recurring Deposits (RD)
- Mutual Funds
- Stocks
- Other assets

The investment area includes:

- Portfolio overview and allocation by asset class.
- Total current value, invested capital, and estimated gain/loss.
- Individual holding details and activity history.
- Independent investment ledger.
- Contributions, withdrawals, interest, gains, losses, and market-value updates.
- Bank-account-to-investment transfers.
- Investment-to-bank-account withdrawals.
- Portfolio snapshots for historical value charts.
- Return calculations including CAGR, absolute/simple return, and XIRR utilities.

The investment ledger is separate from ordinary day-to-day income and expenses. Only an actual transfer between a bank-type account and an investment is represented in both systems, so the movement is visible in cash-flow records without treating the investment principal as consumption or salary income.

More details: [Investments and portfolio accounting](#investments-and-portfolio-accounting).

---

## Technology stack

| Area | Technology |
|---|---|
| App framework | Expo SDK 58 |
| UI | React Native 0.88, React 19 |
| Navigation | Expo Router 6 |
| Language | TypeScript 6 and JavaScript |
| Authentication | Firebase Authentication |
| Main database | Cloud Firestore |
| Server-side operations | Supabase Edge Functions (Deno) |
| Firebase server access | Firestore REST API using a Google service account from Supabase secrets |
| Stock market data | Alpha Vantage, called from a Supabase Edge Function |
| Mutual-fund NAV | MFAPI public API |
| Charts | `react-native-chart-kit`, `react-native-svg` |
| Icons | `lucide-react-native`, Expo vector icons |
| Secure local storage | `expo-secure-store` |
| Date selection | `@react-native-community/datetimepicker`, `react-native-calendars` |
| PDF/print/share support | `expo-print`, `expo-sharing` |
| Testing | Node test runner, Firebase Rules Unit Testing, Firebase Emulator Suite |

The app is configured for Expo Router and Metro web bundling. It uses the standard React Native component model and can be run through Expo on supported platforms.

---

## Application architecture

```text
app/
  Expo Router route definitions
  ├── (tabs)/              Main tab routes
  ├── auth/                Login and signup
  ├── accounts/            Account-related routes
  ├── friends/             Friend details and add-friend flow
  ├── investments/         Portfolio and investment routes
  ├── splits/              Shared-expense routes
  ├── transactions/        Transaction details and entry routes
  └── statement.tsx        Statement route

src/
  components/
    finance/               Reusable finance UI
    insights/              Insight UI
    ui/                    Shared UI primitives
  constants/               Categories, colors, and app constants
  context/                 Authentication and active-profile contexts
  screens/                 Screen-level UI implementations
  services/
    ai/                    Local insight generation
    calculations/          Investment and financial calculations
    firebase/              Firestore data-access services
    marketData/            Stock and mutual-fund market-data clients
  utils/                   Formatting, validation, dates, and split helpers

types/
  finance.ts               Shared finance and split domain types

supabase/
  functions/
    split-health/          Split creation, repayments, and friend settlements
    stock-quote/            Authenticated stock search, quotes, and history
    _shared/                Shared settlement and stock-history logic

tests/
  *.test.mts                Calculation, validation, and split tests

firestore.rules             Firestore authorization rules
firestore.indexes.json      Required composite indexes
firebase.json               Firebase CLI configuration
```

### Architectural responsibilities

- **`app/`** maps URLs/deep links to screens. Most route files are intentionally thin.
- **`src/screens/`** contains screen-level UI and interaction logic.
- **`src/components/`** contains reusable visual components.
- **`src/context/AuthContext.tsx`** exposes the Firebase user and authentication/PIN actions.
- **`src/context/ProfileContext.tsx`** loads profiles and tracks the currently selected profile.
- **`src/services/firebase/`** contains Firestore reads/writes and the split client that calls protected backend routes.
- **`src/services/calculations/`** contains pure calculations that can be tested independently from the UI.
- **`src/services/marketData/`** retrieves mutual-fund and stock prices.
- **`supabase/functions/`** performs privileged split/settlement mutations and authenticated stock-market requests.
- **`types/finance.ts`** is the shared domain contract for transactions, investments, splits, and settlements.

### State and data flow

1. Firebase Authentication establishes the signed-in user.
2. `AuthContext` exposes the user to the app.
3. `ProfileContext` loads the user's profiles and selects a default profile.
4. Screens call the relevant service layer.
5. Services read/write Firestore or call a protected Supabase Edge Function.
6. Calculation utilities derive display metrics from persisted records.

---

## Routes and screens

The following routes are present in the repository.

| Route | Purpose |
|---|---|
| `/(tabs)` | Main application tabs |
| `/(tabs)/index` | Dashboard |
| `/(tabs)/transactions` | Transaction list |
| `/(tabs)/friends` | Friends and shared expenses |
| `/(tabs)/investments` | Investment portfolio |
| `/(tabs)/accounts` | Accounts |
| `/(tabs)/settings` | Settings |
| `/auth/login` | Sign in |
| `/auth/signup` | Create account |
| `/accounts/add` | Add account |
| `/accounts/historical` | Historical account/transaction workflow |
| `/friends/add` | Find/add friends |
| `/friends/[friendId]` | Friend details |
| `/splits/create` | Create a shared expense |
| `/splits/[id]` | Shared expense details |
| `/transactions/add-expense` | Add an expense |
| `/transactions/self-transfer` | Transfer between own accounts |
| `/transactions/[id]` | Transaction details |
| `/statement` | Statement view |
| `/investments/add` | Add an investment holding |
| `/investments/[investmentId]` | Holding details |
| `/investments/[investmentId]/settings` | Holding settings |
| `/investments/activity` | Record investment activity |
| `/investments/ledger` | Investment activity ledger |
| `/investments/transfer` | Transfer money into an investment |
| `/investments/transfer-out` | Withdraw money from an investment |
| `/settings/account` | Account settings |
| `/settings/pin` | PIN settings |
| `/settings/profiles/new` | Create a finance profile |

---

## Data model

Cloud Firestore is a document database. The app uses collections and documents rather than relational SQL tables. The following describes the principal paths used by the code and rules; individual documents may contain additional optional fields.

| Collection / document path | Purpose |
|---|---|
| `users/{uid}` | User profile metadata such as name, email, and creation time. Firebase Authentication stores credentials. |
| `profiles/{profileId}` | Finance profile metadata: owner/user ID, name, normalized name, type, emoji, currency, default flag, timestamps. |
| `profiles/{profileId}/members/{uid}` | Profile membership and role metadata. |
| `profiles/{profileId}/transactions/{transactionId}` | Income, expense, split allocation/repayment, self-transfer, and investment-transfer records. |
| `profiles/{profileId}/accounts/{accountId}` | Account name, type, opening balance, currency, optional account number, timestamps. |
| `profiles/{profileId}/budgets/{budgetId}` | Category budget and month/year limit. |
| `profiles/{profileId}/goals/{goalId}` | Goal records. |
| `profiles/{profileId}/investments/{investmentId}` | Investment holding and current/invested-value metadata. |
| `profiles/{profileId}/investments/{investmentId}/transactions/{transactionId}` | Independent investment activity ledger. |
| `profiles/{profileId}/investmentSnapshots/{snapshotId}` | Portfolio value and invested-capital snapshots. |
| `profiles/{profileId}/netWorthSnapshots/{snapshotId}` | Net-worth snapshot records. |
| `categories/{categoryId}` | Shared category definitions, including name, type, icon, color, and parent category. |
| `friendRequests/{requestId}` | Friend request sender, recipient, status, and timestamps. |
| `friends/{relationshipId}` | Directional friend relationship; accepted relationships are represented in both directions. |
| `splits/{splitId}` | Shared expense, payer, source expense, participants, allocations, obligations, and status. |
| `splits/{splitId}/settlements/{settlementId}` | Repayment acknowledgement history. |
| `friendSettlements/{settlementId}` | Friend-to-friend net settlement requests. |
| `splitSourceLocks/{profileId}/transactions/{transactionId}` | Server-managed lock preventing one source expense from being attached to multiple active splits. |

### Transaction fields

A typical transaction includes:

- `profileId`
- `userId`
- `type` (`income` or `expense`)
- `amount` (positive rupee amount)
- `categoryId` and display `category`
- `categoryIcon`
- `paymentMode`
- optional `accountId`
- optional `notes`
- `date` (`YYYY-MM-DD`)
- `currency`
- timestamps

Special transaction rows can also contain classification and references such as `kind`, `splitId`, `sourceTransactionId`, `counterpartTransactionId`, and integer-paise amount fields.

### Investment fields

An investment holding can include:

- Asset class and holding name.
- Provider/issuer or market-data provider.
- Symbol, scheme code, folio, or other provider identifier.
- Units/quantity.
- Net invested capital.
- Current/recorded market value.
- Currency, notes, and date metadata.
- Investment-specific settings and calculation fields.

The exact optional fields depend on asset class and activity type. See `types/finance.ts` and `src/services/firebase/investmentsService.js` for the current implementation.

### Split and settlement fields

Split documents use integer-paise amounts and store source expense references, participant allocation snapshots, obligation summaries, participant IDs, lifecycle statuses, and transaction references. Settlement documents store sender/recipient IDs, amount in paise, profile references, status, idempotency information, and counterpart transaction references.

---

## Shared expenses and settlements

Shared expenses use a ledger model rather than treating a participant's “paid” flag as proof of repayment.

### Creating a split

1. The creator selects an existing INR expense in their own active profile.
2. The creator is the payer (`createdBy` / `paidByUserId`).
3. Participants receive equal or custom integer-paise allocations.
4. Participant allocations must add up exactly to the source expense.
5. The source expense is not edited.
6. A source expense can be claimed by only one non-cancelled split, enforced through a server-managed source lock.

The creator may be included or excluded from the participant allocation. If excluded, their consumption allocation is zero. If included, their share is treated like any other allocation. The creator does not owe a repayment to themselves.

### Repayment lifecycle

- A debtor submits a repayment acknowledgement/request.
- The creditor can accept or reject it.
- The sender can cancel while the request is pending.
- Only an accepted acknowledgement reduces the obligation.
- Acceptance creates the paired Split Income and Split Expense repayment records atomically.
- Repayments are transfers between people, not ordinary income, consumption, budget spending, or savings income.

### Finalization and reporting

Final allocation expense rows are written to each participant's default profile only when all required obligations have been accepted. Finalization and those writes are atomic. Reporting helpers avoid counting both the original gross source expense and the final participant allocations as separate consumption.

Friend-level net settlement suggestions are calculated by the trusted `get-network-net-balances` Edge Function. The current client requires **algorithm version 4** from `split-health`.

### Split backend endpoints

The client routes requests to the configured Supabase `split-health` function:

| Endpoint suffix | Purpose |
|---|---|
| `GET /split-health` | Authenticated health/profile/Firestore check |
| `POST /create-shared-expense` | Create a shared expense |
| `POST /cancel-shared-expense` | Cancel a split |
| `POST /get-network-net-balances` | Calculate friend net balances and suggestions |
| `POST /request-split-repayment` | Submit a repayment acknowledgement |
| `POST /accept-split-repayment` | Accept a repayment |
| `POST /reject-split-repayment` | Reject a repayment |
| `POST /cancel-split-repayment` | Cancel a pending repayment |
| `POST /request-friend-settlement` | Request a net friend settlement |
| `POST /accept-friend-settlement` | Accept a friend settlement |
| `POST /reject-friend-settlement` | Reject a friend settlement |
| `POST /cancel-friend-settlement` | Cancel a pending friend settlement |

The client sends the signed-in Firebase ID token in the `x-firebase-id-token` header. The Edge Function verifies the token before performing privileged operations.

---

## Investments and portfolio accounting

Investments have a ledger independent of the everyday finance transaction ledger.

### Supported investment activity

The investment service supports the following activity categories, depending on holding type and workflow:

- Initial investment/opening entry.
- Additional contribution or purchase.
- Withdrawal or sale.
- Interest.
- Gains and losses.
- Market-value updates.
- Transfer into an investment from a linked account.
- Transfer out of an investment to a linked account.

### Investment data paths

- Holding: `profiles/{profileId}/investments/{investmentId}`
- Holding ledger: `profiles/{profileId}/investments/{investmentId}/transactions/{transactionId}`
- Portfolio snapshot: `profiles/{profileId}/investmentSnapshots/{snapshotId}`

### Bank-to-investment transfer

A transfer into an investment links a bank-type account and an investment holding. The service commits the related writes in one Firestore transaction:

1. Debit the linked account.
2. Add the corresponding `Investment Transfer` expense to the primary finance ledger.
3. Increase the investment holding/portfolio.
4. Add an inflow entry to the investment ledger.
5. Write a portfolio snapshot.

If any required write fails, the Firestore transaction fails as a whole.

### Investment-to-bank transfer

The withdrawal workflow moves value from the investment side back to a linked bank account. Review the service implementation and the selected activity type to understand the exact treatment for a particular holding.

### Return and growth calculations

Calculation utilities are in `src/services/calculations/`:

- `cagr.ts` — CAGR, simple return, absolute return, return percentage, elapsed years.
- `returns.ts` — portfolio metrics and realized/unrealized gain calculations.
- `xirr.ts` — dated cash-flow XIRR and total return.
- `investmentGrowth.ts` — date keys, contribution schedules, compounding, accrued value, estimated daily growth.
- `marketInvestmentAccounting.ts` — market asset quantities, buys/sells, position values, and XIRR-related accounting.

For market-priced holdings, distinguish **invested capital**, **current market value**, **realized gain/loss**, and **unrealized gain/loss**. A price update changes the recorded valuation; it is not itself a deposit or withdrawal.

### Important accounting notes

- Investment activity does not automatically become salary/income or household expense.
- The investment ledger is the source of truth for holding activity.
- A bank transfer is mirrored in the ordinary finance ledger so cash movement is visible.
- Portfolio history charts are based on persisted snapshots, not reconstructed live brokerage history.
- Market prices are not guaranteed to be live or tick-by-tick.
- FD/RD estimated growth and maturity behaviour should be checked against the holding's configured terms and the calculation implementation; the app is not a bank's authoritative interest statement.

---

## Market data

### Mutual funds

- Scheme search and NAV retrieval use the MFAPI service.
- Historical NAV resolution is handled by `src/services/marketData/mutualFundNav.ts`.
- The market-data client in `investmentPrices.ts` can retrieve historical and latest mutual-fund NAV information.
- NAV is multiplied by the holding's units to estimate market value.

NAV is published periodically, not continuously. The latest available NAV date may be earlier than the current date.

### Stocks

Stock search, quote, and historical price requests are handled by the Supabase `stock-quote` Edge Function, which calls Alpha Vantage server-side.

Supported actions:

- `search` — symbol search, with India matches ranked ahead where applicable.
- `quote` — latest available global quote.
- `historical` — daily historical price for a requested date, resolved to an available trading session.

The client sends a Firebase ID token in `x-firebase-id-token`. The Alpha Vantage API key belongs in Supabase secrets and must not be embedded in the mobile app.

### Market-data limitations

- Market data depends on provider availability, API entitlements, and rate limits.
- A daily close is not an intraday quote.
- Historical dates falling on market holidays are resolved to a nearby available trading session by the server helper.
- A quote/NAV is a valuation input, not a brokerage transaction.
- The app does not connect to a brokerage account or execute trades.

---

## Authentication and security

### Authentication

- Email/password authentication is provided by Firebase Authentication.
- User metadata is stored under `users/{uid}`.
- Signup creates a default personal profile.
- Auth state is exposed through `AuthContext`.
- The app stores a local optional PIN using `expo-secure-store`.
- The PIN is a local app-lock convenience; it is not a replacement for Firebase authentication or server authorization.

### Firestore security

The primary security policy is in `firestore.rules`; indexes are in `firestore.indexes.json`.

Review the rules carefully before deployment. In particular:

- Profile financial subcollections should remain restricted to authorized profile members/roles.
- Friend discovery requires carefully scoped profile metadata access.
- Split and settlement mutations must go through the trusted Edge Function rather than direct client writes.
- Server-owned transaction classifications and source locks must not be writable by an untrusted client.
- Category writes are restricted by the rules' admin-claim requirement.
- Rules changes must be tested in the Firebase Emulator Suite or a non-production Firebase project.

### Secrets and environment files

Never commit any of the following:

- Google service-account JSON or its base64 representation.
- Alpha Vantage API keys.
- Production credentials, tokens, private keys, or `.env.local`.
- Database exports or user financial data.

The uploaded project archive included a local environment file. Before sharing or pushing the project, ensure `.env.local` is not tracked, remove any accidentally committed secrets from Git history, and rotate credentials that may have been exposed. A `.gitignore` entry does not remove a secret that was already committed.

The Firebase client configuration contains a Firebase web API key. Firebase client config is not a server credential, but it should be restricted appropriately in Google Cloud and protected by Authentication, Firestore Rules, and App Check where configured.

---

## Getting started

### Prerequisites

- Node.js **22 or newer**.
- npm.
- Expo-compatible development environment (Expo Go or a development build, depending on native modules and SDK support).
- A Firebase project with Authentication and Cloud Firestore enabled.
- Supabase CLI and a Supabase project for the Edge Functions.
- Alpha Vantage API key if stock search/quotes/history are required.

### 1. Install dependencies

```bash
git clone <your-repository-url>
cd <your-project-directory>
npm install
```

Use the Node/npm versions supported by the current Expo SDK and lockfile. Do not delete or regenerate the lockfile casually; commit dependency changes together with the lockfile.

### 2. Configure Firebase

Update `src/firebaseConfig.ts` with the Firebase client configuration from:

**Firebase Console → Project settings → Your apps → SDK setup and configuration**

Enable Email/Password under **Authentication → Sign-in method** and create a Cloud Firestore database.

The current project has a Firebase project association in `.firebaserc`. Confirm it points to the intended development/staging project before running any deploy command.

### 3. Configure local environment variables

Create `.env.local` in the project root. See [Environment configuration](#environment-configuration).

At minimum, configure the Supabase split function URL if you want shared-expense creation and settlement functionality.

### 4. Start the app

```bash
npm run dev
```

Expo prints the development server options and QR code. Use the appropriate device, simulator, or web target.

### 5. Run static checks

```bash
npm run typecheck
npm run lint
```

### 6. Configure backend services

Deploy Firestore rules/indexes and the Supabase Edge Functions to the intended non-production project first. Do not enable production split/settlement flows until the deployed backend version and Firestore rules match the client.

---

## Environment configuration

Create `.env.local` locally. Do not commit it.

| Variable | Required for | Description |
|---|---|---|
| `EXPO_PUBLIC_USE_FIREBASE_EMULATORS` | Optional | Set to `true` to connect the client to local Firebase emulators. |
| `EXPO_PUBLIC_FIREBASE_EMULATOR_HOST` | Optional | Emulator host reachable by the app/device; defaults to `127.0.0.1`. |
| `EXPO_PUBLIC_SUPABASE_SPLIT_FUNCTION_URL` | Splits/settlements | Full deployed URL of the Supabase `split-health` function, e.g. `https://<project-ref>.supabase.co/functions/v1/split-health`. |
| `EXPO_PUBLIC_SUPABASE_STOCK_QUOTE_FUNCTION_URL` | Stock data | Optional explicit URL of the Supabase `stock-quote` function. If omitted, the client derives it from the split function URL. |
| `FIREBASE_PROJECT_ID` | Supabase split function secret | Firebase project ID used for Firebase ID-token verification and Firestore REST requests. |
| `GOOGLE_SERVICE_ACCOUNT_JSON_B64` | Supabase split function secret | Base64-encoded service-account JSON with the required Firestore access. Keep server-side only. |
| `ALPHA_VANTAGE_API_KEY` | Supabase stock function secret | Alpha Vantage key used by the stock-data Edge Function. |
| `ALPHA_VANTAGE_HISTORICAL_OUTPUTSIZE` | Optional server secret | Use `full` only if the Alpha Vantage account has the required entitlement; otherwise the function uses `compact`. |

Only variables prefixed with `EXPO_PUBLIC_` are embedded/accessible in the client bundle. **Never put service-account credentials or private API keys in an `EXPO_PUBLIC_` variable.**

The client Firebase configuration is currently declared in `src/firebaseConfig.ts`; it is not read from environment variables in the checked-in implementation. If you change that design, update the setup instructions and app configuration together.

### Generate the service-account secret value

On a trusted local machine, base64-encode the service-account JSON without printing or committing it:

```bash
base64 < service-account.json | tr -d '\n'
```

Store the result as a Supabase secret. Do not paste the value into source code, tickets, chat, or a committed `.env` file.

---

## Firebase setup and deployment

### Firestore rules and indexes

The Firebase CLI configuration points to:

- `firestore.rules`
- `firestore.indexes.json`

After selecting the correct Firebase project, deploy:

```bash
firebase use <your-firebase-project-id>
firebase deploy --only firestore:rules,firestore:indexes
```

Review the rules before deploying. A successful TypeScript build does not validate Firestore Rules.

### Emulator configuration

The client supports opt-in emulator connections:

```env
EXPO_PUBLIC_USE_FIREBASE_EMULATORS=true
EXPO_PUBLIC_FIREBASE_EMULATOR_HOST=127.0.0.1
```

The configured default ports are:

| Emulator | Port |
|---|---:|
| Authentication | `9099` |
| Firestore | `8080` |
| Functions | `5001` |
| Emulator UI | `4000` |

For a physical device, `127.0.0.1` points to the device itself. Set `EXPO_PUBLIC_FIREBASE_EMULATOR_HOST` to a host address reachable from the device.

---

## Supabase Edge Functions

The repository contains two Edge Functions:

### `split-health`

Location: `supabase/functions/split-health/`

Responsibilities:

- Verify Firebase ID tokens.
- Access Firestore through the Firestore REST API using a server-side service account.
- Create/cancel shared expenses.
- Process split repayment requests and acknowledgements.
- Process friend net settlement requests.
- Calculate network net balances and settlement suggestions.
- Return algorithm version **4**, which is required by the current client.

### `stock-quote`

Location: `supabase/functions/stock-quote/`

Responsibilities:

- Verify Firebase ID tokens.
- Search stock symbols.
- Fetch latest quotes.
- Fetch daily historical prices.
- Call Alpha Vantage with a server-side API key.
- Resolve historical price dates to available trading sessions.

### Deploy

Link the Supabase project and deploy both functions:

```bash
supabase login
supabase link --project-ref <your-supabase-project-ref>

supabase functions deploy split-health
supabase functions deploy stock-quote
```

Set server-side secrets in the Supabase project:

```bash
supabase secrets set FIREBASE_PROJECT_ID=<your-firebase-project-id>
supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON_B64=<base64-service-account-json>
supabase secrets set ALPHA_VANTAGE_API_KEY=<your-alpha-vantage-key>
```

If using the full Alpha Vantage historical response and the account supports it:

```bash
supabase secrets set ALPHA_VANTAGE_HISTORICAL_OUTPUTSIZE=full
```

Configure the client with the deployed split URL:

```env
EXPO_PUBLIC_SUPABASE_SPLIT_FUNCTION_URL=https://<project-ref>.supabase.co/functions/v1/split-health
```

Optionally configure the stock function explicitly:

```env
EXPO_PUBLIC_SUPABASE_STOCK_QUOTE_FUNCTION_URL=https://<project-ref>.supabase.co/functions/v1/stock-quote
```

Restart Expo after changing environment variables:

```bash
npm run dev
```

### Backend deployment checklist

- [ ] Confirm the Firebase project ID matches the service account's `project_id`.
- [ ] Confirm the service account has only the Firestore permissions required by the backend.
- [ ] Set Supabase secrets; do not expose them to the client.
- [ ] Deploy `split-health` and `stock-quote`.
- [ ] Confirm `split-health` reports algorithm version 4.
- [ ] Deploy matching Firestore rules and indexes.
- [ ] Test split creation, cancellation, repayment acceptance/rejection, and friend settlements with test accounts.
- [ ] Test stock search, quote, and historical lookup.
- [ ] Verify that unauthorized users cannot read or mutate another user's financial data.

---

## Development commands

| Command | Description |
|---|---|
| `npm run dev` | Start the Expo development server. |
| `npm run build:web` | Export the web app using Expo. |
| `npm run lint` | Run Expo ESLint checks. |
| `npm run typecheck` | Run TypeScript without emitting files. |
| `npm test` | Run Node's test runner over `tests/*.test.mts`. |
| `npm run test:rules` | Run Firestore emulator rules tests (see known integration gap below). |
| `npm run test:functions` | Run Firebase Functions emulator tests (see known integration gap below). |

---

## Testing

The repository includes tests for:

| Test file | Area |
|---|---|
| `friendshipSettlement.test.mts` | Friendship-aware settlement calculations |
| `investmentGrowth.test.mts` | Contribution schedules and compounding |
| `marketInvestmentAccounting.test.mts` | Market investment buy/sell and position accounting |
| `mutualFundHistoricalNav.test.mts` | Historical mutual-fund NAV resolution |
| `splitReporting.test.mts` | Split-aware financial reporting |
| `splitUtils.test.mts` | Split allocation and settlement helpers |
| `stockHistoricalPrice.test.mts` | Historical stock-price date resolution |
| `validation.test.mts` | Input validation |

Run the unit tests:

```bash
npm test
```

Run the static checks:

```bash
npm run typecheck
npm run lint
```

For a release candidate, also build the web bundle:

```bash
npm run build:web
```

Use Firebase Emulator Suite tests for rules and any server-side Firebase integration tests once the corresponding test harness is present and configured.

---

## Data and accounting rules

These rules are important when changing services, reports, or UI totals.

1. **Use integer paise for split/settlement arithmetic.** Avoid floating-point rupee arithmetic for allocation and repayment balances.
2. **Do not mutate the original split source expense.** Link it to the split and account for allocations through the split ledger.
3. **Only accepted repayments settle obligations.** Pending, rejected, and cancelled requests must not reduce outstanding balances.
4. **Keep repayments out of ordinary income/expense analytics.** They are transfers between people.
5. **Avoid double-counting shared expenses.** Reporting must account for the source expense and final participant allocations correctly.
6. **Keep investment activity separate from consumption.** Buying an investment is not the same as spending on a household category.
7. **Mirror bank/investment transfers deliberately.** A transfer should be represented in both relevant ledgers without inflating income or consumption.
8. **Treat market prices as valuations.** A price update is not a buy, sell, deposit, or withdrawal.
9. **Use snapshots for historical portfolio charts.** Do not silently imply that snapshots are complete brokerage statements.
10. **Validate authorization on the server and in Firestore Rules.** Client-side checks are not a security boundary.

---

## Known integration gaps

The following items were identified in the supplied repository snapshot and should be checked before relying on the corresponding workflow:

1. **Firebase Functions configuration does not match the checked-in backend layout.** `firebase.json` references a top-level `functions` directory, but the supplied source tree contains the split and stock functions under `supabase/functions/`. The split client calls Supabase Edge Functions directly. Do not run `firebase deploy --only functions` expecting these Supabase functions to deploy.
2. **The Firebase test scripts refer to paths not present in this snapshot.** `test:rules` references `tests/firestoreRules.test.mts`, and `test:functions` references `functions/package.json` and `functions/test/emulator.test.js`; those paths were not present in the supplied archive. The scripts need to be updated or the missing test harness added.
3. **The `test:rules` and `test:functions` scripts should not be treated as passing until their target files and emulator setup exist.**
4. **The profile context currently selects the default/first profile when profiles load.** Confirm desired profile persistence/switching behaviour if users expect the last-selected profile to survive an app restart.
5. **Profile deletion is a document deletion in the current context implementation.** Firestore subcollections are not automatically recursively deleted. Add a protected server-side cascade and confirmation safeguards before exposing destructive deletion in production.
6. **Account balances need a clear source-of-truth policy.** The account service currently treats `balance` as an opening value; ordinary transaction writes do not universally maintain it. Avoid presenting it as a reconciled live balance unless the relevant workflow has been completed.
7. **Portfolio charts are based on stored snapshots.** They do not imply a continuous or broker-sourced valuation history.
8. **Market-data provider limits apply.** Alpha Vantage can throttle requests or restrict historical output size; MFAPI NAV availability follows publication schedules.
9. **The uploaded archive contains local development material.** It included `.env.local`, Git metadata, generated output, and debug artifacts. Keep local credentials and runtime artifacts out of public source control and distribute a clean source archive.

This section describes the supplied snapshot, not a guarantee that later branches or deployments have the same gaps. Re-check the current repository before release.

---

## Troubleshooting

### Split service says the backend is outdated

The current client checks for `algorithmVersion: 4`.

1. Confirm `EXPO_PUBLIC_SUPABASE_SPLIT_FUNCTION_URL` points to the deployed `split-health` function.
2. Deploy the current `supabase/functions/split-health` source.
3. Confirm the Firebase project ID and service-account secret are correct.
4. Restart Expo after changing client environment variables.
5. Sign in again and retry the health check.

Do not bypass the version check: it prevents the client from making settlement suggestions using an incompatible backend response.

### Missing Supabase function URL

Set `EXPO_PUBLIC_SUPABASE_SPLIT_FUNCTION_URL` to the complete function URL ending in `/split-health`. Restart the Expo development server after editing `.env.local`.

### Stock search or pricing is unavailable

- Confirm `stock-quote` is deployed.
- Confirm `ALPHA_VANTAGE_API_KEY` is configured as a Supabase secret.
- Confirm the client has the correct stock function URL (or the split URL from which it can derive it).
- Check Alpha Vantage rate limits and historical-data entitlements.
- Confirm the selected ticker is a valid provider symbol.

### Firestore permission denied

- Confirm the app is signed in to the intended Firebase project.
- Check the active profile and membership.
- Review `firestore.rules` for the exact collection path.
- Deploy the matching rules and indexes to the intended project.
- Use the Firebase Emulator Suite to reproduce rule behaviour before changing production rules.

### Emulator connection fails on a physical device

Set `EXPO_PUBLIC_FIREBASE_EMULATOR_HOST` to the development machine's LAN IP or another reachable hostname. `127.0.0.1` is only correct when the app and emulator share the same host network namespace.

### Expo does not pick up environment changes

Stop the development server and restart it. If stale bundler state remains, restart with a cleared Metro cache:

```bash
npx expo start --clear
```

---

## Contributing

1. Create a feature branch.
2. Keep UI, data access, and calculation logic in their intended layers.
3. Add or update tests for calculation and accounting changes.
4. Preserve Firestore Rules and backend authorization boundaries.
5. Update this README when routes, collections, environment variables, or deployment steps change.
6. Run:

   ```bash
   npm test
   npm run typecheck
   npm run lint
   npm run build:web
   ```

7. Test security-sensitive flows against emulators or a non-production project before merging.

### Suggested branch/PR checklist

- [ ] No secrets or local environment files are committed.
- [ ] Firestore rules and indexes match the data model.
- [ ] Split and investment accounting remains balanced and does not double-count.
- [ ] New backend endpoints validate Firebase identity and authorize every affected record.
- [ ] Tests cover success, rejection, cancellation, duplicate requests, and failure/rollback paths where applicable.
- [ ] README and environment examples are up to date.

---

## License

No license file was included in the supplied project snapshot. Add a `LICENSE` file before distributing or accepting external contributions, and specify the intended usage terms.

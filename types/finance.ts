export type TransactionType = 'income' | 'expense';
export type SplitTransactionKind = 'source' | 'allocation' | 'repayment';

export type SplitType = 'equal' | 'custom';
export type SplitStatus = 'pending_settlement' | 'partially_settled' | 'finalizing' | 'settled' | 'cancelled';
export type SettlementStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';

export interface SplitParticipant {
  userId: string;
  displayName?: string;
  shareAmountInPaise: number;
}

export interface SplitObligation {
  fromUserId: string;
  toUserId: string;
  amountInPaise: number;
  acceptedAmountInPaise: number;
  pendingAmountInPaise: number;
}

export interface SharedExpenseSplit {
  id: string;
  title: string;
  description?: string;
  createdBy: string;
  paidByUserId: string;
  sourceProfileId: string;
  sourceTransactionId: string;
  totalAmountInPaise: number;
  currency: 'INR';
  type: SplitType;
  participants: SplitParticipant[];
  participantIds: string[];
  obligations: SplitObligation[];
  allocationProfileIds?: Record<string, string>;
  allocationTransactionIds?: Record<string, string>;
  status: SplitStatus;
  finalizationStatus: 'not_started' | 'processing' | 'complete' | 'failed';
  sourceDate: string;
  sourceCategory: string;
  sourceCategoryId?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
  settledAt?: unknown;
  finalizedAt?: unknown;
}

export interface SplitSettlement {
  id: string;
  splitId: string;
  fromUserId: string;
  toUserId: string;
  amountInPaise: number;
  senderProfileId: string;
  recipientProfileId?: string;
  senderTransactionId?: string;
  recipientTransactionId?: string;
  status: SettlementStatus;
  idempotencyKey: string;
  createdAt?: unknown;
  acceptedAt?: unknown;
  rejectedAt?: unknown;
  cancelledAt?: unknown;
  acceptedBy?: string;
}

export interface FriendSettlement {
  id: string;
  fromUserId: string;
  toUserId: string;
  participantIds: string[];
  amountInPaise: number;
  status: SettlementStatus;
  idempotencyKey: string;
  fromProfileId?: string;
  fromAccountId?: string;
  recipientProfileId?: string;
  recipientAccountId?: string;
  payerTransactionId?: string;
  recipientTransactionId?: string;
  note?: string;
  createdAt?: string;
  acceptedAt?: string;
  rejectedAt?: string;
  cancelledAt?: string;
  acceptedBy?: string;
}

export interface FinanceTransaction {
  id: string;
  profileId: string;
  userId: string;
  type: TransactionType;
  /** `allocation` is consumption; `repayment` is a transfer, not consumption/income. */
  kind?: SplitTransactionKind;
  splitId?: string;
  settlementId?: string;
  friendSettlementId?: string;
  counterpartyUserId?: string;
  sourceProfileId?: string;
  sourceTransactionId?: string;
  sourceCategory?: string | null;
  sourceCategoryId?: string | null;
  amountInPaise?: number;
  amount: number;
  categoryId?: string;
  category: string;
  categoryIcon?: string;
  paymentMode: string;
  accountId: string | null;
  notes: string | null;
  /** Local calendar date in YYYY-MM-DD form, suitable for lexicographic queries. */
  date: string;
  currency: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface FinanceAccount {
  id: string;
  name: string;
  type: string;
  balance: number;
  account_number?: string | null;
  icon?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface FinanceBudget {
  id: string;
  categoryId: string;
  month: number;
  year: number;
  limitAmount: number;
}
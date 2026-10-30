import type { FinanceTransaction, SharedExpenseSplit } from '@/types/finance';

/**
 * Removes internal transfers from consumption/income reports and replaces a
 * source transaction only when the split's allocation treatment requires it.
 * Allocation transaction rows are persisted atomically with finalization.
 */
export function getReportableTransactions(
  transactions: FinanceTransaction[],
  splits: SharedExpenseSplit[],
  profileId: string,
): FinanceTransaction[] {
  const sourceTransactionsToExclude = new Set<string>();
  for (const split of splits) {
    if (split.status === 'cancelled' || split.sourceProfileId !== profileId) continue;
    const creatorIsParticipant = split.participants.some((participant) => participant.userId === split.paidByUserId);
    if (!creatorIsParticipant || split.finalizationStatus === 'complete') {
      sourceTransactionsToExclude.add(split.sourceTransactionId);
    }
  }

  return transactions.filter((transaction) => {
    if (transaction.profileId && transaction.profileId !== profileId) return false;
    // Transfers appear in transaction history but are not income or consumption.
    if (transaction.kind === 'repayment' || transaction.kind === 'investment-transfer' || Boolean((transaction as any).investmentTransferId)) return false;
    if (sourceTransactionsToExclude.has(transaction.id)) return false;
    return true;
  }).map((transaction) => transaction.kind === 'allocation'
    ? {
      ...transaction,
      category: transaction.sourceCategory || transaction.category,
      categoryId: transaction.sourceCategoryId || transaction.categoryId,
    }
    : transaction);
}

export function getExcludedSourceAmountInPaise(splits: SharedExpenseSplit[], profileId: string): number {
  const excludedSources = new Set<string>();
  let excludedTotal = 0;
  for (const split of splits) {
    if (split.status === 'cancelled' || split.sourceProfileId !== profileId
      || !Number.isSafeInteger(split.totalAmountInPaise) || split.totalAmountInPaise <= 0
      || !Array.isArray(split.participants)) continue;
    const creatorIsParticipant = split.participants.some((participant) => participant.userId === split.paidByUserId);
    if (creatorIsParticipant && split.finalizationStatus !== 'complete') continue;
    if (excludedSources.has(split.sourceTransactionId)) continue;
    excludedSources.add(split.sourceTransactionId);
    excludedTotal += split.totalAmountInPaise;
  }
  return excludedTotal;
}

export function isReportableIncomeOrExpense(transaction: FinanceTransaction): boolean {
  return transaction.kind !== 'repayment' && transaction.kind !== 'investment-transfer' && !Boolean((transaction as any).investmentTransferId) && (transaction.type === 'income' || transaction.type === 'expense');
}
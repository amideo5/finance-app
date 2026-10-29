import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/src/constants/categories';

/** Transactions are supplied as the current and previous calendar-month reportable rows. */
export interface InsightTransaction {
  type: string;
  kind?: string;
  amount: number;
  amountInPaise?: number;
  date: string;
  categoryId?: string;
  category_id?: string;
  category?: string;
  title?: string;
  notes?: string;
  paymentMode?: string;
  investmentTransferId?: string;
}

export interface InsightBudget {
  categoryId?: string;
  category_id?: string;
  category?: string;
  name?: string;
  limitAmount?: number;
  limit_amount?: number;
}

export interface Insight {
  id: string;
  type: 'info' | 'warning' | 'success' | 'tip';
  title: string;
  message: string;
  icon: string;
  /** Optional next step shown by InsightCard. */
  action?: string;
  /** Higher values are more important when the dashboard limits the number of cards. */
  priority?: number;
}

export interface InsightEngineOptions {
  /** Override the current date for tests or previews. Defaults to the device's current date. */
  asOfDate?: Date;
  /** Difference required before a spending-pace insight is emitted. Defaults to 15%. */
  spendingChangeThresholdPercent?: number;
  /** Savings rate below this level triggers a saving tip. Defaults to 20%. */
  savingsTargetPercent?: number;
  /** Savings rate at or above this level triggers a positive insight. Defaults to 30%. */
  healthySavingsPercent?: number;
  /** Upper bound for dashboard cards. Defaults to 8. */
  maxInsights?: number;
}

const ALL_CATEGORIES = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];
const categoryById = new Map(ALL_CATEGORIES.map((category) => [category.id.toLowerCase(), category]));
const categoryIdsByName = new Map(ALL_CATEGORIES.map((category) => [category.name.trim().toLowerCase(), category.id]));
const RECURRING_CATEGORY_IDS = new Set(['housing', 'bills', 'subscriptions', 'insurance', 'loan_emi']);
const TRANSFER_KINDS = new Set(['self-transfer', 'self_transfer', 'transfer', 'repayment', 'investment-transfer']);

function normalise(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function toPaise(value: unknown): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(Math.abs(amount) * 100) : 0;
}

function amountInPaise(transaction: InsightTransaction): number {
  if (Number.isSafeInteger(transaction.amountInPaise)) {
    return Math.abs(Number(transaction.amountInPaise));
  }
  return toPaise(transaction.amount);
}

function isIncluded(transaction: InsightTransaction): boolean {
  const type = normalise(transaction.type);
  return (type === 'income' || type === 'expense') && !TRANSFER_KINDS.has(normalise(transaction.kind)) && !transaction.investmentTransferId;
}

function transactionsOfType(
  transactions: InsightTransaction[],
  type: 'income' | 'expense'
): InsightTransaction[] {
  return transactions.filter((transaction) => isIncluded(transaction) && normalise(transaction.type) === type);
}

function sumPaise(transactions: InsightTransaction[]): number {
  return transactions.reduce((total, transaction) => total + amountInPaise(transaction), 0);
}

function formatRupees(paise: number, fractionDigits = 0): string {
  const value = paise / 100;
  return `₹${new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)}`;
}

function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function categoryFor(transaction: InsightTransaction): { id: string; name: string } {
  const rawCategory = String(transaction.category ?? '').trim();
  const explicitId = String(transaction.categoryId || transaction.category_id || '').trim();
  const idFromName = rawCategory ? categoryIdsByName.get(rawCategory.toLowerCase()) : undefined;
  const canonicalExplicitId = explicitId ? (categoryIdsByName.get(explicitId.toLowerCase()) || explicitId) : undefined;
  const id = canonicalExplicitId || idFromName || (rawCategory ? rawCategory.toLowerCase() : 'uncategorized');
  const category = categoryById.get(id.toLowerCase());
  return {
    id: id.toLowerCase(),
    name: category?.name || rawCategory || (id === 'uncategorized' ? 'Uncategorised' : id),
  };
}

function budgetCategoryId(budget: InsightBudget): string | null {
  const raw = String(budget.categoryId || budget.category_id || budget.category || '').trim();
  if (!raw) return null;
  return (categoryIdsByName.get(raw.toLowerCase()) || raw).toLowerCase();
}

function categoryTotals(transactions: InsightTransaction[]): Map<string, { amount: number; name: string }> {
  const totals = new Map<string, { amount: number; name: string }>();
  transactionsOfType(transactions, 'expense').forEach((transaction) => {
    const category = categoryFor(transaction);
    const current = totals.get(category.id);
    totals.set(category.id, {
      amount: (current?.amount || 0) + amountInPaise(transaction),
      name: current?.name || category.name,
    });
  });
  return totals;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function validDateKey(value: string | undefined): string | null {
  if (!value) return null;
  // The transaction schema stores YYYY-MM-DD. Validate the shape to avoid timezone shifts.
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(year, month - 1, day);
  if (candidate.getFullYear() !== year || candidate.getMonth() !== month - 1 || candidate.getDate() !== day) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function addInsight(
  insights: Insight[],
  insight: Insight
): void {
  if (!insights.some((existing) => existing.id === insight.id)) insights.push(insight);
}

/**
 * Generates deterministic, explainable insights from monthly transaction and budget data.
 * It does not fetch data, mutate transactions, or change account balances.
 */
export function generateInsights(
  transactions: InsightTransaction[],
  budgets: InsightBudget[],
  previousMonthTransactions: InsightTransaction[],
  options: InsightEngineOptions = {}
): Insight[] {
  const insights: Insight[] = [];
  const now = options.asOfDate && Number.isFinite(options.asOfDate.getTime()) ? options.asOfDate : new Date();
  const changeThreshold = options.spendingChangeThresholdPercent ?? 15;
  const savingsTarget = options.savingsTargetPercent ?? 20;
  const healthySavings = options.healthySavingsPercent ?? 30;
  const maxInsights = Math.max(1, Math.floor(options.maxInsights ?? 8));

  const expenses = transactionsOfType(transactions, 'expense');
  const income = transactionsOfType(transactions, 'income');
  const previousExpenses = transactionsOfType(previousMonthTransactions, 'expense');
  const previousIncome = transactionsOfType(previousMonthTransactions, 'income');
  const currentExpensePaise = sumPaise(expenses);
  const currentIncomePaise = sumPaise(income);
  const previousExpensePaise = sumPaise(previousExpenses);
  const previousIncomePaise = sumPaise(previousIncome);
  const netPaise = currentIncomePaise - currentExpensePaise;
  const savingsRate = currentIncomePaise > 0
    ? (netPaise / currentIncomePaise) * 100
    : null;

  // Forecast month-end spending from the elapsed days. The app passes month-to-date rows.
  const elapsedDays = Math.max(1, Math.min(now.getDate(), daysInMonth(now)));
  const monthDays = daysInMonth(now);
  const projectedExpenses = Math.round((currentExpensePaise / elapsedDays) * monthDays);

  if (currentIncomePaise > 0 && currentExpensePaise > currentIncomePaise) {
    addInsight(insights, {
      id: 'cashflow-negative',
      type: 'warning',
      title: 'Spending Is Above Income',
      message: `You've recorded ${formatRupees(currentExpensePaise - currentIncomePaise)} more in expenses than income so far this month.`,
      icon: '🚨',
      action: 'Review flexible spending and upcoming bills before making new commitments.',
      priority: 100,
    });
  } else if (currentIncomePaise === 0 && currentExpensePaise > 0) {
    addInsight(insights, {
      id: 'income-not-recorded',
      type: 'tip',
      title: 'No Income Recorded Yet',
      message: `You've recorded ${formatRupees(currentExpensePaise)} in expenses, but no income for this month. A savings rate can't be calculated until income is recorded.`,
      icon: '🧾',
      action: 'Check whether salary or other income entries are missing for this month.',
      priority: 70,
    });
  }

  if (previousExpensePaise > 0 && currentExpensePaise > 0 && elapsedDays >= 5) {
    const change = percentChange(projectedExpenses, previousExpensePaise);
    if (change !== null && change >= changeThreshold) {
      addInsight(insights, {
        id: 'expense-increase',
        type: 'warning',
        title: 'Spending Pace Is Up',
        message: `At the current pace, this month's spending could reach ${formatRupees(projectedExpenses)}, about ${change.toFixed(0)}% above last month's ${formatRupees(previousExpensePaise)}.`,
        icon: '⚠️',
        action: 'Check your largest categories and pause non-essential purchases if needed.',
        priority: 92,
      });
    } else if (change !== null && change <= -changeThreshold) {
      addInsight(insights, {
        id: 'expense-decrease',
        type: 'success',
        title: 'Spending Pace Is Lower',
        message: `At the current pace, spending could be about ${Math.abs(change).toFixed(0)}% lower than last month.`,
        icon: '🎉',
        action: 'Keep the habits that are helping you stay within your plan.',
        priority: 48,
      });
    }
  }
    if (currentIncomePaise > 0 && previousIncomePaise > 0 && now.getDate() >= 20) {
    const change = percentChange(currentIncomePaise, previousIncomePaise);
    if (change !== null && change <= -25) {
      addInsight(insights, {
        id: 'income-lower-than-last-month',
        type: 'info',
        title: 'Income Is Lower So Far',
        message: `Income recorded this month is ${Math.abs(change).toFixed(0)}% below last month's total. This may be timing-related.`,
        icon: '📉',
        action: 'Check whether all salary, freelance, reimbursement or other income entries have been recorded.',
        priority: 62,
      });
    } else if (change !== null && change >= 25) {
      addInsight(insights, {
        id: 'income-higher-than-last-month',
        type: 'success',
        title: 'Income Is Up',
        message: `Income recorded so far is ${change.toFixed(0)}% above last month's total.`,
        icon: '📈',
        action: 'Consider assigning the additional income to savings, debt repayment or a specific goal.',
        priority: 44,
      });
    }
  }

  if (savingsRate !== null) {
    // Negative cash flow is already surfaced above; avoid a second card for the same issue.
    if (savingsRate >= 0 && savingsRate < savingsTarget) {
      addInsight(insights, {
        id: 'low-savings',
        type: 'tip',
        title: 'Build Your Savings Buffer',
        message: `Your current savings rate is ${savingsRate.toFixed(1)}%. A target of ${savingsTarget}% would leave more room for emergencies and goals.`,
        icon: '💡',
        action: 'Set aside savings soon after income arrives and review recurring expenses.',
        priority: 66,
      });
    } else if (savingsRate >= healthySavings) {
      addInsight(insights, {
        id: 'good-savings',
        type: 'success',
        title: 'Strong Savings Rate',
        message: `You're retaining ${savingsRate.toFixed(1)}% of recorded income so far this month.`,
        icon: '🌟',
        action: 'Consider directing the surplus towards your emergency fund or a named savings goal.',
        priority: 42,
      });
    }
  }

  // Budget matching canonicalises both category IDs and category names.
  const categorySpend = categoryTotals(transactions);
  budgets.forEach((budget) => {
    const id = budgetCategoryId(budget);
    const limitMajor = Number(budget.limitAmount ?? budget.limit_amount ?? 0);
    if (!id || !Number.isFinite(limitMajor) || limitMajor <= 0) return;

    const limitPaise = toPaise(limitMajor);
    if (limitPaise <= 0) return;
    const spent = categorySpend.get(id);
    const spentPaise = spent?.amount || 0;
    const percentage = (spentPaise / limitPaise) * 100;
    const name = spent?.name || categoryById.get(id)?.name || budget.name || budget.category || id;
    if (percentage >= 100) {
      const overPaise = Math.max(0, spentPaise - limitPaise);
      addInsight(insights, {
        id: `budget-exceeded-${id}`,
        type: 'warning',
        title: percentage === 100 ? 'Budget Fully Used' : 'Budget Exceeded',
        message: percentage === 100
          ? `${name}: you've used 100% of your ${formatRupees(limitPaise)} budget.`
          : `${name}: you've spent ${formatRupees(overPaise)} over your ${formatRupees(limitPaise)} budget (${percentage.toFixed(0)}% used).`,
        icon: '🚨',
        action: `Review recent ${name.toLowerCase()} purchases or adjust the budget if your plan has changed.`,
        priority: percentage >= 120 ? 98 : 90,
      });
    } else if (percentage >= 80) {
      addInsight(insights, {
        id: `budget-warning-${id}`,
        type: 'warning',
        title: 'Budget Nearly Used',
        message: `${name}: ${percentage.toFixed(0)}% used, with ${formatRupees(limitPaise - spentPaise)} remaining.`,
        icon: '⚠️',
        action: 'Keep an eye on the remaining budget for the rest of the month.',
        priority: 78,
      });
    }
  });

  // Highlight the biggest category increase using a month-end pace estimate.
  if (elapsedDays >= 7 && previousExpensePaise > 0 && categorySpend.size > 0) {
    const previousCategorySpend = categoryTotals(previousMonthTransactions);
    const categoryChanges = [...categorySpend.entries()].map(([id, current]) => {
      const previous = previousCategorySpend.get(id)?.amount || 0;
      const projected = Math.round((current.amount / elapsedDays) * monthDays);
      const change = percentChange(projected, previous);
      return { id, name: current.name, current: current.amount, previous, projected, change };
    }).filter((entry) => entry.previous >= 50000 && entry.change !== null && entry.change >= 30 && entry.projected - entry.previous >= 50000)
      .sort((a, b) => (b.projected - b.previous) - (a.projected - a.previous));

    const largestIncrease = categoryChanges[0];
    if (largestIncrease && largestIncrease.change !== null) {
      addInsight(insights, {
        id: `category-spike-${largestIncrease.id}`,
        type: 'tip',
        title: `${largestIncrease.name} Spending Is Rising`,
        message: `At the current pace, ${largestIncrease.name.toLowerCase()} could reach ${formatRupees(largestIncrease.projected)}, ${largestIncrease.change.toFixed(0)}% above last month's ${formatRupees(largestIncrease.previous)}.`,
        icon: '📊',
        action: `Review the ${largestIncrease.name.toLowerCase()} transactions to see whether the increase is planned or one-off.`,
        priority: 72,
      });
    }
  }

  // Concentration insight: helps users understand what drives the total spend.
  if (currentExpensePaise > 0 && categorySpend.size > 0) {
    const topCategory = [...categorySpend.entries()].sort((a, b) => b[1].amount - a[1].amount)[0];
    if (topCategory) {
      const share = (topCategory[1].amount / currentExpensePaise) * 100;
      if (share >= 35 && topCategory[1].amount >= 100000) {
        addInsight(insights, {
          id: `top-spend-category-${topCategory[0]}`,
          type: 'info',
          title: 'Your Biggest Spending Category',
          message: `${topCategory[1].name} accounts for ${share.toFixed(0)}% of your recorded expenses (${formatRupees(topCategory[1].amount)}).`,
          icon: '🧭',
          action: 'Open this category in Transactions to review individual purchases.',
          priority: 45,
        });
      }
    }
  }

  // Unusually large purchase, based on the month’s own median rather than a fixed limit alone.
  const expenseAmounts = expenses.map((transaction) => amountInPaise(transaction)).filter((amount) => amount > 0);
  if (expenseAmounts.length >= 5) {
    const typical = median(expenseAmounts);
    const largestTransaction = expenses.reduce<InsightTransaction | null>((largest, transaction) => (
      !largest || amountInPaise(transaction) > amountInPaise(largest) ? transaction : largest
    ), null);
    if (largestTransaction) {
      const largestAmount = amountInPaise(largestTransaction);
      const share = currentExpensePaise > 0 ? (largestAmount / currentExpensePaise) * 100 : 0;
      if (largestAmount >= Math.max(typical * 3, 150000) && share >= 15) {
        const label = categoryFor(largestTransaction).name;
        addInsight(insights, {
          id: `large-transaction-${validDateKey(largestTransaction.date) || 'undated'}`,
          type: 'info',
          title: 'Large Transaction to Review',
          message: `Your largest expense is ${formatRupees(largestAmount)}${label ? ` (${label.toLowerCase()})` : ''}, about ${(largestAmount / Math.max(1, typical)).toFixed(1)}× your typical transaction amount.`,
          icon: '🔎',
          action: 'Confirm it is categorised correctly and account for it in your budget if it was planned.',
          priority: 60,
        });
      }
    }
  }
    // A peak day can explain a sudden monthly jump without labelling a single purchase as wrong.
  const spendByDay = new Map<string, number>();
  expenses.forEach((transaction) => {
    const date = validDateKey(transaction.date);
    if (!date) return;
    spendByDay.set(date, (spendByDay.get(date) || 0) + amountInPaise(transaction));
  });
  if (spendByDay.size >= 4) {
    const dayTotals = [...spendByDay.entries()].sort((a, b) => b[1] - a[1]);
    const peak = dayTotals[0];
    const averagePerActiveDay = currentExpensePaise / spendByDay.size;
    if (peak && peak[1] >= 100000 && peak[1] >= averagePerActiveDay * 2.2) {
      addInsight(insights, {
        id: `high-spend-day-${peak[0]}`,
        type: 'info',
        title: 'Highest-Spend Day',
        message: `${peak[0]} was your highest-spend day at ${formatRupees(peak[1])}, around ${(peak[1] / Math.max(1, averagePerActiveDay)).toFixed(1)}× your average active-day spend.`,
        icon: '📅',
        action: 'Review the transactions recorded on this date to understand the spike.',
        priority: 38,
      });
    }
  }

  // Flag only a small set of known bill categories, and phrase it as a possibility—not certainty.
  if (previousExpenses.length && expenses.length) {
    const previousCategorySpend = categoryTotals(previousMonthTransactions);
    const matchedCategory = [...categorySpend.entries()].find(([id, current]) => {
      if (!RECURRING_CATEGORY_IDS.has(id)) return false;
      const previous = previousCategorySpend.get(id)?.amount || 0;
      if (previous <= 0 || current.amount <= 0) return false;
      return Math.abs(current.amount - previous) / Math.max(current.amount, previous) <= 0.15;
    });
    if (matchedCategory) {
      const [id, current] = matchedCategory;
      addInsight(insights, {
        id: `possible-recurring-${id}`,
        type: 'tip',
        title: 'Possible Recurring Expense',
        message: `Your ${current.name.toLowerCase()} spending is similar to last month (${formatRupees(current.amount)} recorded this month).`,
        icon: '🔁',
        action: 'Check whether this is a regular bill and make sure its due date is covered in your plan.',
        priority: 34,
      });
    }
  }

  if (insights.length === 0) {
    addInsight(insights, {
      id: 'all-good',
      type: 'info',
      title: 'No Immediate Alerts',
      message: 'There are no major spending or budget alerts in the available data. Keep reviewing your finances as new transactions arrive.',
      icon: '✅',
      priority: 1,
    });
  }

  return insights
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .slice(0, maxInsights)
    .map(({ priority: _priority, ...insight }) => insight);
}

export function generateGoalInsight(
  goalName: string,
  currentAmount: number,
  targetAmount: number,
  targetDate: Date,
  monthlyContribution: number,
  asOfDate: Date = new Date()
): Insight | null {
  if (!Number.isFinite(targetAmount) || targetAmount <= 0 || !Number.isFinite(currentAmount) || currentAmount < 0) {
    return {
      id: 'goal-invalid-target',
      type: 'warning',
      title: 'Check Goal Target',
      message: `Add a valid target amount for "${goalName}" to track progress.`,
      icon: '🎯',
      action: 'Edit the goal and enter a target amount greater than zero.',
    };
  }

  const remaining = Math.max(0, targetAmount - currentAmount);
  if (remaining === 0) {
    return {
      id: 'goal-completed',
      type: 'success',
      title: 'Goal Reached',
      message: `You've reached your "${goalName}" goal.`,
      icon: '🏆',
      action: 'Celebrate the milestone, then decide whether to set a new goal.',
    };
  }

  if (!Number.isFinite(targetDate.getTime())) {
    return {
      id: 'goal-invalid-date',
      type: 'warning',
      title: 'Check Goal Deadline',
      message: `The deadline for "${goalName}" needs to be updated.`,
      icon: '📅',
      action: 'Choose a valid target date to calculate the required monthly contribution.',
    };
  }

  const daysRemaining = Math.ceil((targetDate.getTime() - asOfDate.getTime()) / (1000 * 60 * 60 * 24));
  if (daysRemaining <= 0) {
    return {
      id: 'goal-deadline-passed',
      type: 'warning',
      title: 'Deadline Passed',
      message: `The deadline for "${goalName}" has passed, with ${formatRupees(toPaise(remaining))} still to go.`,
      icon: '⏰',
      action: 'Choose a new deadline or revise the target/contribution to make the plan achievable.',
    };
  }

  const monthsRemaining = Math.max(1, Math.ceil(daysRemaining / 30.4375));
  const requiredMonthly = remaining / monthsRemaining;
  const safeContribution = Number.isFinite(monthlyContribution) ? Math.max(0, monthlyContribution) : 0;

  if (safeContribution >= requiredMonthly) {
    return {
      id: 'goal-on-track',
      type: 'success',
      title: 'Goal On Track',
      message: `You're on pace to reach "${goalName}" by the deadline with about ${monthsRemaining} month(s) remaining.`,
      icon: '🎯',
      action: `Keep contributing at least ${formatRupees(toPaise(requiredMonthly))} per month.`,
    };
  }

  const shortfall = requiredMonthly - safeContribution;
  return {
    id: 'goal-behind',
    type: 'warning',
    title: 'Goal Needs a Boost',
    message: `You're about ${formatRupees(toPaise(shortfall))} per month below the pace needed for "${goalName}".`,
    icon: '📉',
    action: `Aim for ${formatRupees(toPaise(requiredMonthly))} per month, or adjust the deadline.`,
  };
}
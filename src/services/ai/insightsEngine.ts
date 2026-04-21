interface Transaction {
  type: string;
  amount: number;
  date: string;
  category_id: string;
}

interface Budget {
  category_id: string;
  limit_amount: number;
}

export interface Insight {
  id: string;
  type: 'info' | 'warning' | 'success' | 'tip';
  title: string;
  message: string;
  icon: string;
}

export function generateInsights(
  transactions: Transaction[],
  budgets: Budget[],
  previousMonthTransactions: Transaction[]
): Insight[] {
  const insights: Insight[] = [];

  const currentMonthExpenses = transactions
    .filter(t => t.type === 'expense')
    .reduce((sum, t) => sum + t.amount, 0);

  const currentMonthIncome = transactions
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);

  const previousMonthExpenses = previousMonthTransactions
    .filter(t => t.type === 'expense')
    .reduce((sum, t) => sum + t.amount, 0);

  if (previousMonthExpenses > 0) {
    const changePercent = ((currentMonthExpenses - previousMonthExpenses) / previousMonthExpenses) * 100;

    if (changePercent > 15) {
      insights.push({
        id: 'expense-increase',
        type: 'warning',
        title: 'Spending Alert',
        message: `Your spending is ${changePercent.toFixed(1)}% higher than last month`,
        icon: '⚠️',
      });
    } else if (changePercent < -15) {
      insights.push({
        id: 'expense-decrease',
        type: 'success',
        title: 'Great Job',
        message: `Your spending is ${Math.abs(changePercent).toFixed(1)}% lower than last month`,
        icon: '🎉',
      });
    }
  }

  const savingsRate = currentMonthIncome > 0
    ? ((currentMonthIncome - currentMonthExpenses) / currentMonthIncome) * 100
    : 0;

  if (savingsRate < 20 && currentMonthIncome > 0) {
    insights.push({
      id: 'low-savings',
      type: 'tip',
      title: 'Savings Tip',
      message: `Your savings rate is ${savingsRate.toFixed(1)}%. Try to save at least 20% of your income`,
      icon: '💡',
    });
  } else if (savingsRate >= 30) {
    insights.push({
      id: 'good-savings',
      type: 'success',
      title: 'Excellent',
      message: `You're saving ${savingsRate.toFixed(1)}% of your income. Keep it up!`,
      icon: '🌟',
    });
  }

  const categoryExpenses = new Map<string, number>();
  transactions.filter(t => t.type === 'expense').forEach(t => {
    const current = categoryExpenses.get(t.category_id) || 0;
    categoryExpenses.set(t.category_id, current + t.amount);
  });

  budgets.forEach(budget => {
    const spent = categoryExpenses.get(budget.category_id) || 0;
    const percentage = (spent / budget.limit_amount) * 100;

    if (percentage >= 100) {
      insights.push({
        id: `budget-exceeded-${budget.category_id}`,
        type: 'warning',
        title: 'Budget Exceeded',
        message: `You've exceeded your budget by ${(percentage - 100).toFixed(0)}%`,
        icon: '🚨',
      });
    } else if (percentage >= 80) {
      insights.push({
        id: `budget-warning-${budget.category_id}`,
        type: 'warning',
        title: 'Budget Alert',
        message: `You've used ${percentage.toFixed(0)}% of your budget`,
        icon: '⚠️',
      });
    }
  });

  if (insights.length === 0) {
    insights.push({
      id: 'all-good',
      type: 'info',
      title: 'All Good',
      message: 'Your finances are looking healthy. Keep up the good work!',
      icon: '✅',
    });
  }

  return insights;
}

export function generateGoalInsight(
  goalName: string,
  currentAmount: number,
  targetAmount: number,
  targetDate: Date,
  monthlyContribution: number
): Insight | null {
  const remaining = targetAmount - currentAmount;
  const today = new Date();
  const monthsRemaining = Math.ceil((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24 * 30));

  if (monthsRemaining <= 0) {
    return {
      id: 'goal-deadline-passed',
      type: 'warning',
      title: 'Deadline Passed',
      message: `The deadline for "${goalName}" has passed`,
      icon: '⏰',
    };
  }

  const requiredMonthly = remaining / monthsRemaining;

  if (monthlyContribution >= requiredMonthly) {
    return {
      id: 'goal-on-track',
      type: 'success',
      title: 'On Track',
      message: `You'll reach your "${goalName}" goal in ${monthsRemaining} months`,
      icon: '🎯',
    };
  } else {
    const shortfall = requiredMonthly - monthlyContribution;
    return {
      id: 'goal-behind',
      type: 'warning',
      title: 'Goal Behind Schedule',
      message: `You need to save ₹${shortfall.toFixed(0)} more per month to reach "${goalName}"`,
      icon: '📉',
    };
  }
}

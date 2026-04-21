interface CashFlow {
  date: Date;
  amount: number;
}

const DAYS_IN_YEAR = 365;
const MAX_ITERATIONS = 100;
const TOLERANCE = 0.0001;

export function calculateXIRR(cashFlows: CashFlow[]): number | null {
  if (cashFlows.length < 2) {
    return null;
  }

  let guess = 0.1;
  let x0 = guess;
  let x1 = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const fValue = xNPV(x0, cashFlows);
    const fDerivative = xNPVDerivative(x0, cashFlows);

    if (Math.abs(fDerivative) < TOLERANCE) {
      return null;
    }

    x1 = x0 - fValue / fDerivative;

    if (Math.abs(x1 - x0) <= TOLERANCE) {
      return x1 * 100;
    }

    x0 = x1;
  }

  return null;
}

function xNPV(rate: number, cashFlows: CashFlow[]): number {
  const firstDate = cashFlows[0].date;
  let sum = 0;

  for (const cf of cashFlows) {
    const days = daysBetween(firstDate, cf.date);
    const years = days / DAYS_IN_YEAR;
    sum += cf.amount / Math.pow(1 + rate, years);
  }

  return sum;
}

function xNPVDerivative(rate: number, cashFlows: CashFlow[]): number {
  const firstDate = cashFlows[0].date;
  let sum = 0;

  for (const cf of cashFlows) {
    const days = daysBetween(firstDate, cf.date);
    const years = days / DAYS_IN_YEAR;
    sum -= (years * cf.amount) / Math.pow(1 + rate, years + 1);
  }

  return sum;
}

function daysBetween(date1: Date, date2: Date): number {
  const diff = date2.getTime() - date1.getTime();
  return Math.abs(diff / (1000 * 60 * 60 * 24));
}

export function calculateTotalReturn(cashFlows: CashFlow[]): number {
  const invested = cashFlows
    .filter(cf => cf.amount < 0)
    .reduce((sum, cf) => sum + Math.abs(cf.amount), 0);

  const returns = cashFlows
    .filter(cf => cf.amount > 0)
    .reduce((sum, cf) => sum + cf.amount, 0);

  if (invested === 0) return 0;
  return ((returns - invested) / invested) * 100;
}

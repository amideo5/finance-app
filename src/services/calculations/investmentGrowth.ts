export type CompoundingFrequency = 'daily' | 'monthly' | 'quarterly' | 'half_yearly' | 'annually';
export type ContributionFrequency = 'weekly' | 'monthly' | 'quarterly';

export interface InvestmentCashFlow {
  type?: string;
  date?: string;
  amountInPaise?: number;
  amount?: number;
  direction?: 'in' | 'out';
  newValueInPaise?: number;
}

const FREQUENCY_PERIODS: Record<CompoundingFrequency, number> = {
  daily: 365,
  monthly: 12,
  quarterly: 4,
  half_yearly: 2,
  annually: 1,
};

export const toDateKey = (date: Date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const isValidDateKey = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
};

export const addDaysToDateKey = (dateKey: string, days: number): string => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
};

/** Add calendar months while preserving the anchor day when possible (Jan 31 -> Feb 28 -> Mar 31). */
export const addMonthsFromAnchor = (anchorDateKey: string, months: number): string => {
  const [year, month, day] = anchorDateKey.split('-').map(Number);
  const targetMonthZeroBased = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthZeroBased / 12);
  const targetMonth = ((targetMonthZeroBased % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
};

export const addContributionInterval = (
  startDate: string,
  frequency: ContributionFrequency,
  intervalIndex: number,
): string => {
  const index = Math.max(0, Math.trunc(intervalIndex));
  if (frequency === 'weekly') return addDaysToDateKey(startDate, index * 7);
  return addMonthsFromAnchor(startDate, index * (frequency === 'quarterly' ? 3 : 1));
};

/** First anchored installment strictly after a date, without creating old catch-up payments. */
export const getNextContributionSchedule = (
  startDate: string,
  frequency: ContributionFrequency,
  afterDate: string,
): { index: number; date: string } => {
  let index = 1;
  let date = addContributionInterval(startDate, frequency, index);
  while (date <= afterDate && index < 12000) {
    index += 1;
    date = addContributionInterval(startDate, frequency, index);
  }
  return { index, date };
};

/**
 * Return the first installment that has not been accounted for yet. The first
 * recurring installment is one interval after the RD start date. When no
 * installment has been posted, the cursor is therefore the day before the
 * start date; otherwise it is the last successfully posted installment date.
 * This deliberately does not compare with today so backdated schedules can be
 * caught up instead of silently skipping missed installments.
 */
export const getNextUnprocessedContributionSchedule = (
  startDate: string,
  frequency: ContributionFrequency,
  lastContributionDate?: string | null,
): { index: number; date: string } => {
  const cursorDate = lastContributionDate && isValidDateKey(lastContributionDate)
    ? lastContributionDate
    : addDaysToDateKey(startDate, -1);
  return getNextContributionSchedule(startDate, frequency, cursorDate);
};

export const getDaysBetween = (startDate: string, endDate: string): number => {
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const start = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  return Math.max(0, Math.floor((end - start) / 86_400_000));
};

export const compoundPrincipal = (
  principalInPaise: number,
  annualRatePercent: number,
  days: number,
  frequency: CompoundingFrequency = 'quarterly',
): number => {
  if (!Number.isFinite(principalInPaise) || !Number.isFinite(annualRatePercent) || days <= 0) {
    return Math.round(principalInPaise || 0);
  }
  if (annualRatePercent <= 0 || principalInPaise === 0) return Math.round(principalInPaise || 0);
  const periodsPerYear = FREQUENCY_PERIODS[frequency] ?? 4;
  const rate = annualRatePercent / 100;
  const factor = Math.pow(1 + rate / periodsPerYear, (periodsPerYear * days) / 365);
  return Math.round(principalInPaise * factor);
};

const flowAmountInPaise = (flow: InvestmentCashFlow): number => {
  if (Number.isSafeInteger(flow.amountInPaise)) return Number(flow.amountInPaise);
  return Math.round(Number(flow.amount || 0) * 100);
};

/**
 * Compute an FD/RD estimate from dated ledger cash flows. This is derived on read;
 * it intentionally does not write a daily ledger row. Product-specific bank rules,
 * taxes, premature-withdrawal penalties and rounding can differ.
 */
export const calculateAccruedValueInPaise = (
  flows: InvestmentCashFlow[],
  annualRatePercent: number,
  asOfDate: string,
  frequency: CompoundingFrequency = 'quarterly',
): number => {
  const rate = Number(annualRatePercent);
  if (!Number.isFinite(rate) || rate < 0) {
    return 0;
  }

  const total = flows.reduce((sum, flow) => {
    const flowDate = typeof flow.date === 'string' && isValidDateKey(flow.date) ? flow.date : asOfDate;
    if (flowDate > asOfDate) return sum;

    const eventType = String(flow.type || '');
    let signedAmount = flowAmountInPaise(flow);

    if (eventType === 'withdrawal' && signedAmount > 0) signedAmount *= -1;
    if (eventType === 'loss' && signedAmount > 0) signedAmount *= -1;
    if (eventType === 'bank_transfer' && flow.direction === 'out' && signedAmount > 0) signedAmount *= -1;
    if (eventType === 'bank_transfer' && flow.direction === 'in' && signedAmount < 0) signedAmount *= -1;

    // Older market-value entries store the change from the previous valuation.
    // Treating the signed adjustment as a dated cash flow preserves subsequent accrual.
    const days = getDaysBetween(flowDate, asOfDate);
    const accrued = compoundPrincipal(signedAmount, rate, days, frequency);
    return sum + accrued;
  }, 0);

  return Math.max(0, Math.round(total));
};

export const calculateEstimatedDailyGrowthInPaise = (
  flows: InvestmentCashFlow[],
  annualRatePercent: number,
  asOfDate: string,
  frequency: CompoundingFrequency = 'quarterly',
): number => {
  const yesterday = addDaysToDateKey(asOfDate, -1);
  const flowsBeforeToday = flows.filter((flow) => {
    const date = typeof flow.date === 'string' && isValidDateKey(flow.date) ? flow.date : asOfDate;
    return date < asOfDate;
  });
  const todayValue = calculateAccruedValueInPaise(flowsBeforeToday, annualRatePercent, asOfDate, frequency);
  const priorValue = calculateAccruedValueInPaise(flowsBeforeToday, annualRatePercent, yesterday, frequency);
  return Math.max(0, todayValue - priorValue);
};

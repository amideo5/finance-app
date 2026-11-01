export type HistoricalCloseMatch = 'exact' | 'next_trading_day' | 'previous_close';

export interface ResolvedHistoricalClose {
  date: string;
  price: number;
  matchType: HistoricalCloseMatch;
}

const dateDistanceDays = (left: string, right: string): number => {
  const leftUtc = Date.parse(`${left}T00:00:00Z`);
  const rightUtc = Date.parse(`${right}T00:00:00Z`);
  return Math.round((leftUtc - rightUtc) / 86_400_000);
};

/**
 * Resolve a user-selected calendar date to an actual exchange close.
 * Prefer the selected session, then the next session (for past holidays),
 * and finally the previous completed close (for weekends/current dates).
 */
export const resolveHistoricalClose = (
  series: Record<string, Record<string, string>>,
  requestedDate: string,
): ResolvedHistoricalClose => {
  const tradingDates = Object.keys(series).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
  const nextDate = tradingDates
    .filter((date) => date >= requestedDate && dateDistanceDays(date, requestedDate) <= 7)
    .sort()[0];
  const previousDate = tradingDates
    .filter((date) => date < requestedDate && dateDistanceDays(requestedDate, date) <= 7)
    .sort()
    .reverse()[0];
  const date = nextDate || previousDate;
  if (!date) {
    const oldestAvailableDate = tradingDates.sort()[0];
    if (oldestAvailableDate && requestedDate < oldestAvailableDate) {
      const distance = dateDistanceDays(oldestAvailableDate, requestedDate);
      if (distance > 7) {
        throw new Error(
          `The selected date is older than the historical prices available from the configured provider plan (available from ${oldestAvailableDate}). Enter the broker contract-note price or enable Alpha Vantage full historical data.`,
        );
      }
    }
    throw new Error(`No trading-day closing price was found within seven days of ${requestedDate}.`);
  }
  const price = Number(series[date]?.['4. close']);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`The historical closing price for ${date} is invalid.`);
  }
  const matchType: HistoricalCloseMatch = date === requestedDate
    ? 'exact'
    : date > requestedDate
      ? 'next_trading_day'
      : 'previous_close';
  return { date, price, matchType };
};

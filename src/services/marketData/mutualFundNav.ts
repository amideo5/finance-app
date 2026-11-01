export interface MutualFundNavPoint {
  date: string;
  nav: string | number;
}

export type MutualFundNavMatchType = 'exact' | 'next_available' | 'latest_available';

export interface ResolvedMutualFundNav {
  date: string;
  nav: number;
  matchType: MutualFundNavMatchType;
}

export const parseMfApiDate = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!match) return null;
  const day = match[1].padStart(2, '0');
  const month = match[2].padStart(2, '0');
  const dateKey = `${match[3]}-${month}-${day}`;
  const parsed = new Date(`${dateKey}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== dateKey
  ) return null;
  return dateKey;
};

const daysBetween = (from: string, to: string): number => {
  const fromTime = Date.parse(`${from}T00:00:00.000Z`);
  const toTime = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((toTime - fromTime) / 86_400_000);
};

/**
 * Resolve a useful historical NAV around the transaction date.
 * Exact date wins; for a past weekend/holiday use the next published NAV;
 * when the selected date is recent and its NAV is not published yet, retain
 * the latest published NAV as an explicitly labelled estimate.
 */
export const resolveHistoricalMutualFundNav = (
  records: MutualFundNavPoint[],
  requestedDate: string,
  maxCalendarDayDistance = 7,
): ResolvedMutualFundNav => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    throw new Error('Choose a valid mutual-fund purchase date.');
  }

  const valid = records
    .map((record) => ({
      date: parseMfApiDate(record?.date),
      nav: Number(record?.nav),
    }))
    .filter((record): record is { date: string; nav: number } =>
      Boolean(record.date) && Number.isFinite(record.nav) && record.nav > 0,
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!valid.length) {
    throw new Error('No valid historical NAV records were returned for this scheme.');
  }

  const exact = valid.find((record) => record.date === requestedDate);
  if (exact) return { ...exact, matchType: 'exact' };

  const next = valid.find((record) => {
    const distance = daysBetween(requestedDate, record.date);
    return distance > 0 && distance <= maxCalendarDayDistance;
  });
  if (next) return { ...next, matchType: 'next_available' };

  const previous = [...valid].reverse().find((record) => {
    const distance = daysBetween(record.date, requestedDate);
    return distance >= 0 && distance <= maxCalendarDayDistance;
  });
  if (previous) return { ...previous, matchType: 'latest_available' };

  throw new Error(
    `No published NAV was found within ${maxCalendarDayDistance} days of ${requestedDate}. Check the scheme and date, or enter the actual allotment NAV from your AMC statement.`,
  );
};

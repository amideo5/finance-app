import { auth } from '@/src/firebaseConfig';
import { addDaysToDateKey, isValidDateKey } from '@/src/services/calculations/investmentGrowth';
import { resolveHistoricalMutualFundNav } from '@/src/services/marketData/mutualFundNav';

export interface MarketPriceResult {
  price: number;
  date: string;
  provider: 'mfapi' | 'alpha_vantage';
  label: string;
}

export interface MarketDataHolding {
  assetClass: string;
  marketDataProvider?: string | null;
  marketDataId?: string | null;
  symbol?: string | null;
  units?: number | null;
}

const parseDmyDate = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!match) return null;
  const day = match[1].padStart(2, '0');
  const month = match[2].padStart(2, '0');
  return `${match[3]}-${month}-${day}`;
};

const requestJson = async (url: string): Promise<any> => {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Price provider returned HTTP ${response.status}.`);
  return response.json();
};

const getStockQuoteFunctionUrl = (): string | null => {
  const explicit = process.env.EXPO_PUBLIC_SUPABASE_STOCK_QUOTE_FUNCTION_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const splitHealthUrl = process.env.EXPO_PUBLIC_SUPABASE_SPLIT_FUNCTION_URL?.trim();
  if (!splitHealthUrl) return null;
  return splitHealthUrl.replace(/\/+$/, '').replace(/\/split-health$/i, '/stock-quote');
};

/** Retained for the UI warning; the Alpha Vantage key now lives server-side. */
export const hasStockMarketApiKey = (): boolean => Boolean(getStockQuoteFunctionUrl());

const postStockDataRequest = async (body: Record<string, unknown>): Promise<any> => {
  const url = getStockQuoteFunctionUrl();
  if (!url) {
    throw new Error('Stock search and historical pricing need the Supabase stock-quote Edge Function URL. Configure EXPO_PUBLIC_SUPABASE_STOCK_QUOTE_FUNCTION_URL and deploy the updated function.');
  }
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to search stocks or retrieve historical prices.');
  const idToken = await user.getIdToken();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-firebase-id-token': idToken,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(payload?.error || `Stock data service returned HTTP ${response.status}.`));
  }
  return payload;
};

export interface StockSearchResult {
  symbol: string;
  name: string;
  region: string;
  type: string;
  currency: string;
  exchange: string;
  matchScore: number;
}

export const searchStocks = async (query: string): Promise<StockSearchResult[]> => {
  const cleanQuery = query.trim();
  if (cleanQuery.length < 2) throw new Error('Enter at least two characters to search stocks.');
  const payload = await postStockDataRequest({ action: 'search', query: cleanQuery });
  return Array.isArray(payload?.results)
    ? payload.results.filter((item: any) => item?.symbol && item?.name)
    : [];
};

export const fetchStockHistoricalPrice = async (
  symbol: string,
  requestedDate: string,
): Promise<MarketPriceResult> => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    throw new Error('Choose a valid investment date before loading the historical stock price.');
  }
  const payload = await postStockDataRequest({ action: 'historical', symbol, date: requestedDate });
  const price = Number(payload?.price);
  const date = String(payload?.date || '');
  if (!Number.isFinite(price) || price <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('The stock history service returned an invalid price or trading date.');
  }
  return {
    price,
    date,
    provider: 'alpha_vantage',
    label: String(payload?.label || `Historical close · ${date}`),
  };
};

const fetchStockQuote = async (symbol: string): Promise<MarketPriceResult> => {
  const payload = await postStockDataRequest({ action: 'quote', symbol });
  const price = Number(payload?.price);
  const date = String(payload?.date || '');
  if (!Number.isFinite(price) || price <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('The stock quote service returned an invalid price or trading date.');
  }
  return {
    price,
    date,
    provider: 'alpha_vantage',
    label: String(payload?.label || `Alpha Vantage quote · ${date}`),
  };
};

const mutualFundHistoricalNavCache = new Map<string, { result: MarketPriceResult; cachedAt: number }>();

export const fetchMutualFundHistoricalNav = async (
  schemeCode: string,
  requestedDate: string,
): Promise<MarketPriceResult> => {
  const cleanCode = String(schemeCode || '').trim();
  if (!/^\d+$/.test(cleanCode)) {
    throw new Error('Select a valid MFAPI scheme code before loading historical NAV.');
  }
  if (!isValidDateKey(requestedDate)) {
    throw new Error('Choose a valid mutual-fund purchase date before loading NAV.');
  }

  const cacheKey = `${cleanCode}:${requestedDate}`;
  const cached = mutualFundHistoricalNavCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < 5 * 60 * 1000) return cached.result;

  // Fetch a narrow window. Exact NAV is preferred; non-business dates can
  // resolve to the next published NAV. A recent date can use the last
  // published NAV as a clearly labelled estimate until the actual NAV appears.
  const startDate = addDaysToDateKey(requestedDate, -7);
  const endDate = addDaysToDateKey(requestedDate, 7);
  const url = `https://api.mfapi.in/mf/${encodeURIComponent(cleanCode)}?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
  const payload = await requestJson(url);
  const records = Array.isArray(payload?.data) ? payload.data : [];
  const resolved = resolveHistoricalMutualFundNav(records, requestedDate);

  const label = resolved.matchType === 'exact'
    ? `NAV for selected date · ${resolved.date}`
    : resolved.matchType === 'next_available'
      ? `Next available NAV after selected date · ${resolved.date}`
      : `Latest published NAV reference · ${resolved.date}`;

  const result: MarketPriceResult = {
    price: resolved.nav,
    date: resolved.date,
    provider: 'mfapi',
    label,
  };
  mutualFundHistoricalNavCache.set(cacheKey, { result, cachedAt: Date.now() });
  return result;
};

export const searchMutualFundSchemes = async (query: string): Promise<Array<{ schemeCode: number; schemeName: string }>> => {
  const cleanQuery = query.trim();
  if (cleanQuery.length < 2) throw new Error('Enter at least two characters to search mutual funds.');
  const payload = await requestJson(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(cleanQuery)}`);
  if (!Array.isArray(payload)) return [];
  return payload
    .filter((item: any) => Number.isFinite(Number(item?.schemeCode)) && typeof item?.schemeName === 'string')
    .slice(0, 8)
    .map((item: any) => ({ schemeCode: Number(item.schemeCode), schemeName: item.schemeName }));
};

export const fetchLatestInvestmentPrice = async (holding: MarketDataHolding): Promise<MarketPriceResult> => {
  const lookupId = String(holding.marketDataId || '').trim();
  if (!lookupId) throw new Error('Add a market data code before refreshing this investment.');

  if (holding.assetClass === 'mutual_fund' && (holding.marketDataProvider === 'mfapi' || !holding.marketDataProvider)) {
    if (!/^\d+$/.test(lookupId)) throw new Error('Mutual fund market data code must be the MFAPI scheme code (numbers only).');
    const payload = await requestJson(`https://api.mfapi.in/mf/${encodeURIComponent(lookupId)}/latest`);
    const first = Array.isArray(payload?.data) ? payload.data[0] : null;
    const price = Number(first?.nav);
    const date = parseDmyDate(first?.date);
    if (!Number.isFinite(price) || price <= 0 || !date) throw new Error('The mutual fund provider did not return a valid NAV.');
    return { price, date, provider: 'mfapi', label: `MFAPI NAV · ${date}` };
  }

  if (holding.assetClass === 'stock' && (holding.marketDataProvider === 'alpha_vantage' || !holding.marketDataProvider)) {
    return fetchStockQuote(lookupId);
  }

  throw new Error('No automatic price provider is configured for this asset type.');
};

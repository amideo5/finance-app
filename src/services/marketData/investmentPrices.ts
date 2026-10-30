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

export const hasStockMarketApiKey = (): boolean =>
  Boolean(process.env.EXPO_PUBLIC_ALPHA_VANTAGE_API_KEY?.trim());

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
    const apiKey = process.env.EXPO_PUBLIC_ALPHA_VANTAGE_API_KEY?.trim();
    if (!apiKey) throw new Error('Stock auto-valuation needs EXPO_PUBLIC_ALPHA_VANTAGE_API_KEY in your local environment.');
    const payload = await requestJson(
      `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(lookupId)}&apikey=${encodeURIComponent(apiKey)}`,
    );
    const quote = payload?.['Global Quote'];
    const price = Number(quote?.['05. price']);
    const date = String(quote?.['07. latest trading day'] || '');
    if (payload?.Note || payload?.Information) {
      throw new Error(String(payload.Note || payload.Information));
    }
    if (!Number.isFinite(price) || price <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(String(payload?.['Error Message'] || 'No valid stock quote was returned. Check the ticker symbol and provider quota.'));
    }
    return { price, date, provider: 'alpha_vantage', label: `Alpha Vantage quote · ${date}` };
  }

  throw new Error('No automatic price provider is configured for this asset type.');
};

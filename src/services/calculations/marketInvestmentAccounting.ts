/**
 * Transaction math for exchange-traded stocks and mutual funds.
 * Money is represented in integer paise; quantities retain up to 6 decimals
 * (mutual funds may be fractional, ordinary cash-equity shares may not).
 */

export type MarketAssetClass = 'stock' | 'mutual_fund';

export interface MarketBuyResult {
  quantity: number;
  unitPrice: number;
  tradeValueInPaise: number;
  chargesInPaise: number;
  totalCostInPaise: number;
  unspentBudgetInPaise: number;
}

export interface MarketSellResult {
  quantity: number;
  unitPrice: number;
  grossProceedsInPaise: number;
  chargesInPaise: number;
  netProceedsInPaise: number;
  costBasisSoldInPaise: number;
  realizedGainLossInPaise: number;
  remainingQuantity: number;
  remainingCostBasisInPaise: number;
}

/** Amount actually debited when a new holding is funded from a tracked bank account.
 * For market assets this is the executed trade cost plus charges (not the whole
 * budget, because unused whole-share stock budget stays in the bank). For other
 * asset classes it is the initial principal/deposit.
 */
export const calculateInitialFundingDebitInPaise = (input: {
  assetClass: unknown;
  initialPrincipalInPaise: number;
  marketPurchase?: Pick<MarketBuyResult, 'totalCostInPaise'> | null;
}): number => {
  if (isMarketAssetClass(input.assetClass)) {
    const cost = Number(input.marketPurchase?.totalCostInPaise);
    if (!Number.isSafeInteger(cost) || cost <= 0) {
      throw new Error('A valid market purchase is required to calculate the bank debit.');
    }
    return cost;
  }
  const principal = Number(input.initialPrincipalInPaise);
  if (!Number.isSafeInteger(principal) || principal <= 0) {
    throw new Error('Initial investment principal must be a positive amount in paise.');
  }
  return principal;
};

const QUANTITY_SCALE = 1_000_000;

export const toQuantityMicros = (value: number): number =>
  Math.round(value * QUANTITY_SCALE);

export const fromQuantityMicros = (value: number): number =>
  value / QUANTITY_SCALE;

export const isMarketAssetClass = (value: unknown): value is MarketAssetClass =>
  value === 'stock' || value === 'mutual_fund';

export const normalizeMarketQuantity = (
  assetClass: MarketAssetClass,
  quantity: number,
): number => {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  if (assetClass === 'stock') return Math.floor(quantity + Number.EPSILON);
  return fromQuantityMicros(toQuantityMicros(quantity));
};

/**
 * Calculate units for a buy. `budgetInPaise` is the maximum cash available,
 * not necessarily the amount that will be invested (whole-share stocks can
 * leave an unspent balance).
 */
export const calculateMarketBuy = (input: {
  assetClass: MarketAssetClass;
  budgetInPaise: number;
  unitPrice: number;
  quantity?: number | null;
  chargesInPaise?: number;
}): MarketBuyResult => {
  // Keep the full supplied unit price. Mutual-fund NAVs are commonly quoted
  // to four decimal places, so rounding prices to paise would misstate units.
  const unitPrice = Number(input.unitPrice);
  const budgetInPaise = Math.round(input.budgetInPaise);
  const chargesInPaise = Math.max(0, Math.round(input.chargesInPaise || 0));
  if (!Number.isSafeInteger(budgetInPaise) || budgetInPaise <= 0) {
    throw new Error('Enter a purchase amount greater than zero.');
  }
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    throw new Error('Enter a valid execution price or applicable NAV.');
  }

  const quantity = input.quantity == null || input.quantity === 0
    ? normalizeMarketQuantity(input.assetClass, ((budgetInPaise - chargesInPaise) / 100) / unitPrice)
    : normalizeMarketQuantity(input.assetClass, Number(input.quantity));
  if (quantity <= 0) {
    throw new Error(input.assetClass === 'stock'
      ? 'This amount is not enough to purchase one whole share at the entered price.'
      : 'The amount does not produce any mutual-fund units.');
  }
  if (input.assetClass === 'stock' && !Number.isInteger(Number(input.quantity ?? quantity))) {
    throw new Error('Stock quantity must be a whole number of shares.');
  }

  const tradeValueInPaise = Math.round(quantity * unitPrice * 100);
  const totalCostInPaise = tradeValueInPaise + chargesInPaise;
  if (totalCostInPaise > budgetInPaise) {
    throw new Error('The purchase cost including charges exceeds the available amount.');
  }
  return {
    quantity,
    unitPrice,
    tradeValueInPaise,
    chargesInPaise,
    totalCostInPaise,
    unspentBudgetInPaise: budgetInPaise - totalCostInPaise,
  };
};

/**
 * Calculate a sale/redemption at an entered execution price. For stocks the
 * requested amount is converted to whole shares; for funds it becomes
 * fractional units (6 decimal places). Cost basis is reduced proportionally
 * to the units sold, not by the redemption proceeds.
 */
export const calculateMarketSell = (input: {
  assetClass: MarketAssetClass;
  requestedProceedsInPaise: number;
  unitPrice: number;
  heldQuantity: number;
  costBasisInPaise: number;
  chargesInPaise?: number;
}): MarketSellResult => {
  const unitPrice = Number(input.unitPrice);
  const requestedProceedsInPaise = Math.round(input.requestedProceedsInPaise);
  const heldMicros = toQuantityMicros(input.heldQuantity);
  const chargesInPaise = Math.max(0, Math.round(input.chargesInPaise || 0));
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    throw new Error('A valid sale price or redemption NAV is required.');
  }
  if (requestedProceedsInPaise <= 0 || heldMicros <= 0) {
    throw new Error('Enter a valid sale amount and ensure units are available.');
  }

  const maxProceeds = Math.round((heldMicros / QUANTITY_SCALE) * unitPrice * 100);
  if (requestedProceedsInPaise > maxProceeds + 1) {
    throw new Error('Sale amount exceeds the current value of the holding.');
  }

  let quantity = normalizeMarketQuantity(
    input.assetClass,
    (requestedProceedsInPaise / 100) / unitPrice,
  );
  if (input.assetClass === 'stock' && quantity === 0) {
    throw new Error('The sale amount is not enough to sell one whole share.');
  }
  quantity = Math.min(quantity, fromQuantityMicros(heldMicros));
  const soldMicros = toQuantityMicros(quantity);
  const grossProceedsInPaise = Math.round(quantity * unitPrice * 100);
  const netProceedsInPaise = grossProceedsInPaise - chargesInPaise;
  if (netProceedsInPaise <= 0) throw new Error('Sale charges exceed the sale proceeds.');

  const totalCostBasis = Math.max(0, Math.round(input.costBasisInPaise));
  const costBasisSoldInPaise = soldMicros >= heldMicros
    ? totalCostBasis
    : Math.min(totalCostBasis, Math.round(totalCostBasis * soldMicros / heldMicros));
  const remainingQuantity = fromQuantityMicros(Math.max(0, heldMicros - soldMicros));
  const remainingCostBasisInPaise = Math.max(0, totalCostBasis - costBasisSoldInPaise);

  return {
    quantity,
    unitPrice,
    grossProceedsInPaise,
    chargesInPaise,
    netProceedsInPaise,
    costBasisSoldInPaise,
    realizedGainLossInPaise: netProceedsInPaise - costBasisSoldInPaise,
    remainingQuantity,
    remainingCostBasisInPaise,
  };
};

export const calculateMarketPositionValueInPaise = (
  quantity: number,
  unitPrice: number,
): number => {
  if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new Error('Invalid quantity or market price.');
  }
  // Preserve sub-paise NAV precision until the final currency value is rounded.
  return Math.round(quantity * unitPrice * 100);
};


export interface XirrCashFlow {
  date: string;
  amountInPaise: number;
}

const dateOrdinal = (date: string): number | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return Math.floor(parsed.getTime() / 86_400_000);
};

/** Annualized money-weighted return using dated net cash flows and a terminal value. */
export const calculateXirrPercent = (
  cashFlows: XirrCashFlow[],
  asOfDate: string,
  terminalValueInPaise: number,
): number | null => {
  const terminalDay = dateOrdinal(asOfDate);
  if (terminalDay === null || !Number.isFinite(terminalValueInPaise) || terminalValueInPaise < 0) return null;
  const flows = cashFlows
    .map((flow) => ({ day: dateOrdinal(flow.date), amount: Number(flow.amountInPaise) }))
    .filter((flow): flow is { day: number; amount: number } => flow.day !== null && Number.isFinite(flow.amount) && flow.amount !== 0 && flow.day <= terminalDay);
  if (!flows.some((flow) => flow.amount < 0)) return null;
  flows.push({ day: terminalDay, amount: terminalValueInPaise });
  if (!flows.some((flow) => flow.amount > 0)) return null;
  const origin = Math.min(...flows.map((flow) => flow.day));
  if (terminalDay <= origin) return null;

  const npv = (rate: number): number => flows.reduce((total, flow) => {
    const years = (flow.day - origin) / 365;
    return total + flow.amount / Math.pow(1 + rate, years);
  }, 0);

  let low = -0.9999;
  let high = 1;
  let lowValue = npv(low);
  let highValue = npv(high);
  while (Number.isFinite(highValue) && lowValue * highValue > 0 && high < 1_000_000) {
    high = high * 2 + 1;
    highValue = npv(high);
  }
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue * highValue > 0) return null;

  for (let iteration = 0; iteration < 160; iteration += 1) {
    const middle = (low + high) / 2;
    const middleValue = npv(middle);
    if (!Number.isFinite(middleValue)) return null;
    if (Math.abs(middleValue) < 0.01) return middle * 100;
    if (lowValue * middleValue <= 0) {
      high = middle;
      highValue = middleValue;
    } else {
      low = middle;
      lowValue = middleValue;
    }
  }
  return ((low + high) / 2) * 100;
};

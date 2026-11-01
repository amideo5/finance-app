import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateInitialFundingDebitInPaise,
  calculateMarketBuy,
  calculateMarketPositionValueInPaise,
  calculateMarketSell,
  calculateXirrPercent,
} from '../src/services/calculations/marketInvestmentAccounting.ts';

test('stock buy uses whole shares and retains unspent budget', () => {
  const buy = calculateMarketBuy({
    assetClass: 'stock',
    budgetInPaise: 1_000_000,
    unitPrice: 1_207.30,
  });
  assert.equal(buy.quantity, 8);
  assert.equal(buy.tradeValueInPaise, 965_840);
  assert.equal(buy.totalCostInPaise, 965_840);
  assert.equal(buy.unspentBudgetInPaise, 34_160);
});

test('new stock funding debits executed trade cost and leaves unused budget in the bank', () => {
  const purchase = calculateMarketBuy({
    assetClass: 'stock',
    budgetInPaise: 1_000_000,
    unitPrice: 1_207.30,
    chargesInPaise: 250,
  });
  assert.equal(purchase.quantity, 8);
  assert.equal(calculateInitialFundingDebitInPaise({
    assetClass: 'stock',
    initialPrincipalInPaise: 1_000_000,
    marketPurchase: purchase,
  }), 966_090);
  assert.equal(purchase.unspentBudgetInPaise, 33_910);
});

test('new mutual-fund funding debits allotted units plus charges', () => {
  const purchase = calculateMarketBuy({
    assetClass: 'mutual_fund',
    budgetInPaise: 1_000_000,
    unitPrice: 100.1234,
    chargesInPaise: 100,
  });
  assert.equal(calculateInitialFundingDebitInPaise({
    assetClass: 'mutual_fund',
    initialPrincipalInPaise: 1_000_000,
    marketPurchase: purchase,
  }), purchase.totalCostInPaise);
});

test('new term investment funding debits the initial principal', () => {
  assert.equal(calculateInitialFundingDebitInPaise({
    assetClass: 'fixed_deposit',
    initialPrincipalInPaise: 500_000,
  }), 500_000);
  assert.throws(() => calculateInitialFundingDebitInPaise({
    assetClass: 'recurring_deposit',
    initialPrincipalInPaise: 0,
  }), /positive amount/);
});

test('stock buy rejects fractional share quantity', () => {
  assert.throws(() => calculateMarketBuy({
    assetClass: 'stock',
    budgetInPaise: 1_000_000,
    unitPrice: 1_000,
    quantity: 1.5,
  }), /whole number/);
});

test('mutual fund buy calculates fractional units to six decimal places', () => {
  const buy = calculateMarketBuy({
    assetClass: 'mutual_fund',
    budgetInPaise: 1_000_000,
    unitPrice: 100.25,
  });
  assert.equal(buy.quantity, 99.750623);
  assert.equal(buy.tradeValueInPaise, 1_000_000);
  assert.equal(buy.unspentBudgetInPaise, 0);
});

test('mutual fund NAV precision is retained beyond two decimal places', () => {
  const buy = calculateMarketBuy({
    assetClass: 'mutual_fund',
    budgetInPaise: 1_100_000,
    unitPrice: 100.1234,
    quantity: 10,
  });
  assert.equal(buy.unitPrice, 100.1234);
  assert.equal(buy.tradeValueInPaise, 100_123);
  assert.equal(calculateMarketPositionValueInPaise(10, 100.1234), 100_123);
});

test('additional market buys are additive and valuation multiplies all held units', () => {
  const first = calculateMarketBuy({ assetClass: 'stock', budgetInPaise: 100_000, unitPrice: 100 });
  const second = calculateMarketBuy({ assetClass: 'stock', budgetInPaise: 120_000, unitPrice: 120 });
  assert.equal(first.quantity + second.quantity, 20);
  assert.equal(calculateMarketPositionValueInPaise(20, 125), 250_000);
});

test('sale removes proportional average cost basis rather than proceeds', () => {
  const sale = calculateMarketSell({
    assetClass: 'mutual_fund',
    requestedProceedsInPaise: 600_000,
    unitPrice: 120,
    heldQuantity: 100,
    costBasisInPaise: 1_000_000,
  });
  assert.equal(sale.quantity, 50);
  assert.equal(sale.grossProceedsInPaise, 600_000);
  assert.equal(sale.costBasisSoldInPaise, 500_000);
  assert.equal(sale.realizedGainLossInPaise, 100_000);
  assert.equal(sale.remainingQuantity, 50);
  assert.equal(sale.remainingCostBasisInPaise, 500_000);
});

test('whole-share sale rounds down to executable quantity', () => {
  const sale = calculateMarketSell({
    assetClass: 'stock',
    requestedProceedsInPaise: 250_000,
    unitPrice: 1_200,
    heldQuantity: 10,
    costBasisInPaise: 200_000,
  });
  assert.equal(sale.quantity, 2);
  assert.equal(sale.grossProceedsInPaise, 240_000);
});

test('mutual fund redemption keeps the full NAV precision', () => {
  const sale = calculateMarketSell({
    assetClass: 'mutual_fund',
    requestedProceedsInPaise: 100_123,
    unitPrice: 100.1234,
    heldQuantity: 20,
    costBasisInPaise: 200_000,
  });
  assert.ok(Math.abs(sale.quantity - 9.99996) < 0.000001);
  assert.equal(sale.grossProceedsInPaise, 100_123);
});


test('XIRR uses dated contributions and terminal portfolio value', () => {
  const annualized = calculateXirrPercent([
    { date: '2025-01-01', amountInPaise: -1_000_000 },
  ], '2026-01-01', 1_100_000);
  assert.ok(annualized !== null);
  assert.ok(Math.abs(annualized - 10) < 0.2);
});

test('XIRR incorporates later buys and realized sale proceeds', () => {
  const annualized = calculateXirrPercent([
    { date: '2025-01-01', amountInPaise: -1_000_000 },
    { date: '2025-07-01', amountInPaise: -500_000 },
    { date: '2025-10-01', amountInPaise: 300_000 },
  ], '2026-01-01', 1_300_000);
  assert.ok(annualized !== null);
  assert.ok(Number.isFinite(annualized));
});

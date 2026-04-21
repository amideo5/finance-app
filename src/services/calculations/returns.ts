interface Investment {
  totalInvested: number;
  currentValue: number;
  realizedGains: number;
  unrealizedGains: number;
}

export function calculatePortfolioMetrics(investments: Investment[]) {
  const totalInvested = investments.reduce((sum, inv) => sum + inv.totalInvested, 0);
  const totalCurrentValue = investments.reduce((sum, inv) => sum + inv.currentValue, 0);
  const totalRealizedGains = investments.reduce((sum, inv) => sum + inv.realizedGains, 0);
  const totalUnrealizedGains = investments.reduce((sum, inv) => sum + inv.unrealizedGains, 0);
  const totalGains = totalRealizedGains + totalUnrealizedGains;

  const returnPercentage = totalInvested > 0
    ? ((totalCurrentValue - totalInvested) / totalInvested) * 100
    : 0;

  return {
    totalInvested,
    totalCurrentValue,
    totalRealizedGains,
    totalUnrealizedGains,
    totalGains,
    returnPercentage,
  };
}

export function calculateUnrealizedGains(
  totalInvested: number,
  currentValue: number,
  realizedGains: number
): number {
  return currentValue - totalInvested + realizedGains;
}

export function calculateRealizedGains(
  sellAmount: number,
  costBasis: number
): number {
  return sellAmount - costBasis;
}

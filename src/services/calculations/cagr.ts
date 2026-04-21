export function calculateCAGR(
  initialValue: number,
  finalValue: number,
  years: number
): number | null {
  if (initialValue <= 0 || finalValue <= 0 || years <= 0) {
    return null;
  }

  const cagr = (Math.pow(finalValue / initialValue, 1 / years) - 1) * 100;
  return cagr;
}

export function calculateSimpleReturn(
  initialValue: number,
  finalValue: number
): number {
  if (initialValue === 0) return 0;
  return ((finalValue - initialValue) / initialValue) * 100;
}

export function calculateAbsoluteReturn(
  invested: number,
  currentValue: number
): number {
  return currentValue - invested;
}

export function calculateReturnPercentage(
  invested: number,
  currentValue: number
): number {
  if (invested === 0) return 0;
  return ((currentValue - invested) / invested) * 100;
}

export function calculateYearsBetween(startDate: Date, endDate: Date): number {
  const diff = endDate.getTime() - startDate.getTime();
  return diff / (1000 * 60 * 60 * 24 * 365);
}

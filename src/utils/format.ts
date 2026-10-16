export const formatCurrency = (amount: number, currency: string = 'INR'): string => {
  if (currency === 'INR') {
    return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 })}`;
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
  }).format(amount);
};

const parseDisplayDate = (date: Date | string): Date => {
  if (date instanceof Date) return date;
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T00:00:00`)
    : new Date(date);
};

export const formatDate = (date: Date | string): string => {
  const d = parseDisplayDate(date);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

export const formatShortDate = (date: Date | string): string => {
  const d = parseDisplayDate(date);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
  });
};

export const formatPercent = (value: number): string => {
  return `${value.toFixed(2)}%`;
};

export const formatNumber = (value: number): string => {
  return value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

export const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
};

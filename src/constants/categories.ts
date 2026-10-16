export const EXPENSE_CATEGORIES = [
  { id: 'food', name: 'Food & Dining', icon: '🍽️', color: '#EF4444' },
  { id: 'transportation', name: 'Transportation', icon: '🚗', color: '#F59E0B' },
  { id: 'shopping', name: 'Shopping', icon: '🛍️', color: '#8B5CF6' },
  { id: 'entertainment', name: 'Entertainment', icon: '🎬', color: '#EC4899' },
  { id: 'bills', name: 'Bills & Utilities', icon: '📋', color: '#3B82F6' },
  { id: 'health', name: 'Healthcare', icon: '⚕️', color: '#10B981' },
  { id: 'education', name: 'Education', icon: '📚', color: '#6366F1' },
  { id: 'travel', name: 'Travel', icon: '✈️', color: '#14B8A6' },
  { id: 'personal_care', name: 'Personal Care', icon: '💆', color: '#F97316' },
  { id: 'misc', name: 'Other', icon: '📦', color: '#6B7280' },
];

export const INCOME_CATEGORIES = [
  { id: 'salary', name: 'Salary', icon: '💼', color: '#10B981' },
  { id: 'business_income', name: 'Business', icon: '🏢', color: '#3B82F6' },
  { id: 'investments', name: 'Investments', icon: '📈', color: '#8B5CF6' },
  { id: 'other_income', name: 'Other Income', icon: '💰', color: '#6B7280' },
];

export const ACCOUNT_TYPES = [
  { type: 'upi', name: 'UPI', icon: '💳' },
  { type: 'bank', name: 'Bank Account', icon: '🏦' },
  { type: 'credit_card', name: 'Credit Card', icon: '💳' },
  { type: 'debit_card', name: 'Debit Card', icon: '💳' },
  { type: 'wallet', name: 'Wallet', icon: '👛' },
  { type: 'cash', name: 'Cash', icon: '💵' },
];

export const PAYMENT_MODES = [
  { value: 'upi', label: 'UPI' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'wallet', label: 'Wallet' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
];

export const INVESTMENT_TYPES = [
  { type: 'stocks', name: 'Stocks', icon: '📈' },
  { type: 'mutual_funds', name: 'Mutual Funds', icon: '📊' },
  { type: 'fd', name: 'Fixed Deposit', icon: '🏦' },
  { type: 'gold', name: 'Gold', icon: '🪙' },
  { type: 'crypto', name: 'Cryptocurrency', icon: '₿' },
  { type: 'property', name: 'Property', icon: '🏠' },
];

export const GOAL_TYPES = [
  { type: 'savings', name: 'Savings Goal', icon: '🎯' },
  { type: 'loan_payoff', name: 'Loan Payoff', icon: '💰' },
  { type: 'purchase', name: 'Large Purchase', icon: '🛒' },
  { type: 'vacation', name: 'Vacation', icon: '✈️' },
  { type: 'emergency_fund', name: 'Emergency Fund', icon: '🆘' },
];

export const PROFILE_TYPES = [
  { type: 'personal', name: 'Personal', emoji: '👤' },
  { type: 'business', name: 'Business', emoji: '💼' },
  { type: 'family', name: 'Family', emoji: '👨‍👩‍👧‍👦' },
  { type: 'custom', name: 'Custom', emoji: '⭐' },
];

// utils/splitUtils.ts

export const calculateNetBalances = (splits: any[]) => {
  const balanceMap: Record<string, number> = {};

  splits.forEach((split) => {
    const payer = split.participants.find((p: any) => p.paid === true);
    if (!payer) return;

    const totalAmount = Number(split.totalAmount) || 0;

    split.participants.forEach((p: any) => {
      const userId = p.userId;
      const share = Number(p.amount) || 0;

      if (!balanceMap[userId]) balanceMap[userId] = 0;

      if (userId === payer.userId) {
        balanceMap[userId] += totalAmount - share;
      } else {
        balanceMap[userId] -= share;
      }
    });
  });

  return balanceMap;
};

export const simplifyDebts = (balances: Record<string, number>) => {
  const creditors: { user: string; amount: number }[] = [];
  const debtors: { user: string; amount: number }[] = [];

  for (const [user, amount] of Object.entries(balances)) {
    if (amount > 0.01) creditors.push({ user, amount });
    if (amount < -0.01) debtors.push({ user, amount: -amount });
  }

  const settlements: { from: string; to: string; amount: number }[] = [];

  let i = 0, j = 0;

  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];

    const min = Math.min(d.amount, c.amount);

    settlements.push({
      from: d.user,
      to: c.user,
      amount: min,
    });

    d.amount -= min;
    c.amount -= min;

    if (d.amount < 0.01) i++;
    if (c.amount < 0.01) j++;
  }

  return settlements;
};

export const buildMaps = (
  settlements: { from: string; to: string; amount: number }[],
  currentUser: string
) => {
  const oweMap: Record<string, number> = {};
  const getMap: Record<string, number> = {};

  settlements.forEach((s) => {
    if (s.from === currentUser) {
      oweMap[s.to] = (oweMap[s.to] || 0) + s.amount;
    } else if (s.to === currentUser) {
      getMap[s.from] = (getMap[s.from] || 0) + s.amount;
    }
  });

  return { oweMap, getMap };
};
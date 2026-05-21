export const calcIncome = (transactions) =>
  transactions
    .filter((t) => t.type === "income")
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);

export const calcExpense = (transactions) =>
  transactions
    .filter((t) => t.type === "expense")
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);

export const calcBalance = (transactions) =>
  calcIncome(transactions) - calcExpense(transactions);
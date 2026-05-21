export const isTransferTransaction = (transaction) =>
  Boolean(transaction?.transfer_group_id);

export const calcIncome = (transactions) =>
  transactions
    .filter((t) => t.type === "income" && !isTransferTransaction(t))
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);

export const calcExpense = (transactions) =>
  transactions
    .filter((t) => t.type === "expense" && !isTransferTransaction(t))
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);

export const calcBalance = (transactions) =>
  calcIncome(transactions) - calcExpense(transactions);

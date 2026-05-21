function TransactionList({ transactions }) {
  return (
    <div style={styles.card}>
      <h3>Transactions list</h3>
      <ul style={styles.list}>
        {transactions.map((t) => (
          <li key={t.id} style={styles.item}>
            <span>{t.category}</span>
            <span>{t.amount}€</span>
            <span>{t.type}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const styles = {
  card: {
    background: "#fff",
    padding: "16px",
    borderRadius: "16px",
    border: "1px solid #e5e7eb",
  },
  list: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "grid",
    gap: "10px",
  },
  item: {
    display: "grid",
    gridTemplateColumns: "1fr auto auto",
    gap: "12px",
    padding: "12px 0",
    borderBottom: "1px solid #e5e7eb",
  },
};

export default TransactionList;
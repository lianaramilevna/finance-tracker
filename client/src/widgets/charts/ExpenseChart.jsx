import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatMoney } from "../../shared/lib/format";
import { isTransferTransaction } from "../../shared/lib/calc";

const COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f97316",
  "#14b8a6",
  "#22c55e",
  "#eab308",
  "#06b6d4",
  "#ef4444",
  "#3b82f6",
  "#84cc16",
  "#a855f7",
];

// Цвет для категории "Прочее"
const OTHER_COLOR = "#94a3b8";

function ExpenseChart({ transactions, currency = "RUB" }) {
  const data = useMemo(() => {
    // 1. Агрегируем расходы по категориям
    const map = new Map();

    transactions
      .filter((t) => t.type === "expense" && !isTransferTransaction(t))
      .forEach((t) => {
        const name = t.category || "Без категории";
        const amount = Number(t.amount || 0);
        map.set(name, (map.get(name) || 0) + amount);
      });

    // 2. Превращаем в массив и сортируем по убыванию суммы
    let items = [...map.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

    // 3. Выделяем топ-6 и остальное
    const TOP_LIMIT = 6;
    const topItems = items.slice(0, TOP_LIMIT);
    const otherItems = items.slice(TOP_LIMIT);

    if (otherItems.length === 0) {
      // Если остальных нет, возвращаем топ (может быть меньше 6)
      return topItems;
    }

    // 4. Суммируем остальные в "Прочее"
    const otherSum = otherItems.reduce((sum, item) => sum + item.value, 0);
    const result = [...topItems, { name: "Прочее", value: otherSum }];

    return result;
  }, [transactions]);

  const total = useMemo(() => {
    return data.reduce((sum, item) => sum + item.value, 0);
  }, [data]);

  if (data.length === 0) {
    return <p className="empty-state">Нет расходов для отображения</p>;
  }

  // Функция для получения цвета элемента
  const getColor = (index, name) => {
    if (name === "Прочее") return OTHER_COLOR;
    return COLORS[index % COLORS.length];
  };

  return (
    <div className="expense-chart-wrap">
      <div className="expense-chart-legend">
        {data.map((item, index) => {
          const share = total > 0 ? Math.round((item.value / total) * 100) : 0;
          const color = getColor(index, item.name);

          return (
            <div key={item.name} className="expense-legend-item" title={`${item.name} — ${share}%`}>
              <span
                className="expense-legend-dot"
                style={{ backgroundColor: color }}
              />
              <span className="expense-legend-name">{item.name}</span>
              <span className="expense-legend-percent">{share}%</span>
            </div>
          );
        })}
      </div>

      <div className="expense-chart-pie">
        <ResponsiveContainer width="100%" height={340}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={72}
              outerRadius={112}
              paddingAngle={3}
              stroke="#ffffff"
              strokeWidth={3}
            >
              {data.map((entry, index) => (
                <Cell
                  key={`${entry.name}-${index}`}
                  fill={getColor(index, entry.name)}
                />
              ))}
            </Pie>

            <Tooltip
              formatter={(value) => formatMoney(value, currency)}
              contentStyle={{
                borderRadius: "14px",
                border: "1px solid #e2e8f0",
                boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default ExpenseChart;
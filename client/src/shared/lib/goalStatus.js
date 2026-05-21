export const GOAL_STATUS_OPTIONS = [
  { value: "active", label: "Активна" },
  { value: "paused", label: "На паузе" },
  { value: "completed", label: "Выполнена" },
];

export function formatGoalStatus(status) {
  const option = GOAL_STATUS_OPTIONS.find((item) => item.value === status);
  return option?.label || "Активна";
}

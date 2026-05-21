-- Глобальные категории по умолчанию (user_id IS NULL)

INSERT INTO categories (user_id, type, name) VALUES
  (NULL, 'expense', 'Продукты'),
  (NULL, 'expense', 'Кафе и рестораны'),
  (NULL, 'expense', 'Транспорт'),
  (NULL, 'expense', 'Дом'),
  (NULL, 'expense', 'Подписки'),
  (NULL, 'expense', 'Развлечения'),
  (NULL, 'expense', 'Здоровье'),
  (NULL, 'expense', 'Красота'),
  (NULL, 'expense', 'Образование'),
  (NULL, 'expense', 'Одежда и обувь'),
  (NULL, 'expense', 'Техника'),
  (NULL, 'income', 'Зарплата'),
  (NULL, 'income', 'Фриланс'),
  (NULL, 'income', 'Инвестиции'),
  (NULL, 'income', 'Подарки'),
  (NULL, 'income', 'Проценты')
ON CONFLICT DO NOTHING;

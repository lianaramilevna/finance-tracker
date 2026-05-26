-- Принудительно фиксируем валюту на RUB
-- (упрощение: приложение одновалютное, без конвертации)

UPDATE users
SET currency = 'RUB'
WHERE currency IS DISTINCT FROM 'RUB';

UPDATE accounts
SET currency = 'RUB'
WHERE currency IS DISTINCT FROM 'RUB';


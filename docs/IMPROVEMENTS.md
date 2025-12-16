# Шпаргалка по улучшениям индексера

## Что было добавлено

### ✅ 1. Улучшен Dockerfile
- Health checks через wget вместо node
- Прямой запуск `node dist/index.js` вместо `yarn start`
- Увеличен start-period до 60s

### ✅ 2. Docker Compose
- Добавлены зависимости от postgres для всех сервисов
- Параметризованы хосты через переменные окружения
- Улучшен restart policy для migrations (on-failure)
- **Опциональные лимиты ресурсов** (закомментированы в docker-compose.yml)

### ✅ 3. Race Condition Fix
**Файл:** `services/aztec-listener/src/svcs/poller/network-client/pool.ts`

Функции `getRpcNode()` и `setNodeOffline()` теперь используют Mutex для thread-safety.

### ✅ 4. Rate Limiter
**Файл:** `services/aztec-listener/src/svcs/poller/network-client/rate-limiter.ts`

500 запросов/сек для вашей RPC ноды. Использование:

```typescript
import { callRpcMethod } from "./pool.js";

// Вместо: node.instance.getBlock(height)
const block = await callRpcMethod('getBlock', height);
```

### ✅ 5. Database Transactions
**Файл:** `services/aztec-listener/src/svcs/database/transactions.ts`

Для атомарных операций:

```typescript
import { withTransaction } from "./svcs/database/index.js";

await withTransaction(async (tx) => {
  await tx.insert(blocks).values(blockData);
  await tx.insert(transactions).values(txsData);
});
```

**Документация:** [docs/TRANSACTIONS.md](../docs/TRANSACTIONS.md)

### ✅ 6. PostgreSQL Pool Optimization
**Файл:** `packages/postgres-helper/src/svc.ts`

- min: 5 → max: 50 (вместо 20)
- idleTimeout: 120 сек (вместо 30)
- Логирование событий пула

**Переменные окружения:**
```bash
POSTGRES_POOL_MIN=5
POSTGRES_POOL_MAX=50
POSTGRES_POOL_IDLE_TIMEOUT_MS=120000
```

### ✅ 7. Health Endpoints

**aztec-listener:**
```bash
curl http://localhost:8000/health
```

**explorer-api:**
```bash
curl http://localhost:8000/health
```

**Формат:**
```json
{
  "status": "healthy",
  "checks": {
    "postgres": true,
    "rpcNodes": true
  }
}
```

### ✅ 8. Prometheus Metrics

```bash
curl http://localhost:8000/metrics
```

**Интеграция:** [MONITORING.md](../MONITORING.md)

### ✅ 9. Graceful Shutdown

Оба сервиса корректно обрабатывают SIGTERM/SIGINT:
- Остановка новых запросов
- Завершение активных операций
- Закрытие пула БД

### ✅ 10. Environment Variables

Все новые параметры в `.env.indexer.example`:

```bash
# PostgreSQL Pool
POSTGRES_POOL_MIN=5
POSTGRES_POOL_MAX=50
POSTGRES_POOL_IDLE_TIMEOUT_MS=120000

# RPC Rate Limiting
RPC_RATE_LIMIT_RPS=500
RPC_RATE_LIMIT_MAX_CONCURRENT=50

# Health & Monitoring
HEALTH_PORT=8000
SHUTDOWN_TIMEOUT_SEC=30
LOG_LEVEL=info
```

### ✅ 11. Universal Dockerfile

**Файл:** `docker/universal.Dockerfile`

Один Dockerfile для всех сервисов:

```bash
docker build --build-arg SERVICE=aztec-listener \
  -f docker/universal.Dockerfile -t aztec-listener .
```

## Быстрая проверка

### 1. Установка зависимостей

```bash
cd services/aztec-listener
yarn install  # установит async-mutex, express
```

### 2. Сборка

```bash
yarn build:packages
cd services/aztec-listener && yarn build
cd ../explorer-api && yarn build
```

### 3. Docker

```bash
./run-indexer.sh start
```

### 4. Проверка health

```bash
# Должен вернуть {"status":"healthy"}
curl http://localhost:8000/health
```

### 5. Prometheus metrics

```bash
# Должен вернуть метрики в формате Prometheus
curl http://localhost:8000/metrics
```

## Миграция с текущего кода

### Где использовать транзакции

Найдите все места с множественными вставками:

```bash
grep -r "db.insert" services/*/src --include="*.ts" -B 2 -A 2
```

Замените на:

```typescript
// Было:
await db.insert(table1).values(data1);
await db.insert(table2).values(data2);

// Стало:
import { withTransaction } from "./svcs/database/index.js";
await withTransaction(async (tx) => {
  await tx.insert(table1).values(data1);
  await tx.insert(table2).values(data2);
});
```

### Где использовать callRpcMethod

Найдите прямые вызовы RPC:

```bash
grep -r "node.instance\." services/aztec-listener/src --include="*.ts"
```

Замените на:

```typescript
// Было:
const node = getRpcNode();
const block = await node.instance.getBlock(height);

// Стало:
import { callRpcMethod } from "./network-client/pool.js";
const block = await callRpcMethod('getBlock', height);
```

## Мониторинг

### Docker stats

```bash
docker stats aztec-indexer-listener aztec-indexer-api aztec-indexer-postgres
```

### Логи с фильтрацией

```bash
# Только ошибки
docker logs aztec-indexer-listener 2>&1 | grep -i error

# Health check статус
docker logs aztec-indexer-listener 2>&1 | grep -i health

# PostgreSQL pool статистика
docker logs aztec-indexer-listener 2>&1 | grep -i postgres
```

### Проверка graceful shutdown

```bash
# Остановить контейнер (отправит SIGTERM)
docker stop aztec-indexer-listener

# Проверить логи - должно быть "Graceful shutdown completed"
docker logs aztec-indexer-listener --tail 50
```

## Troubleshooting

### Health check не работает

```bash
# Проверить что Express запущен в aztec-listener
docker exec -it aztec-indexer-listener wget -O- http://localhost:8000/health
```

### Race condition ошибки

Если видите ошибки типа "Cannot read property of undefined":
- Проверьте что async-mutex установлен
- Проверьте что используете `await getRpcNode()` (не `getRpcNode()`)

### Транзакции не работают

Убедитесь что импортируете правильно:

```typescript
// ✅ Правильно
import { withTransaction } from "./svcs/database/index.js";

// ❌ Неправильно
import { withTransaction } from "./svcs/database/transactions";  // нет .js
```

## Полезные ссылки

- [INDEXER.md](../INDEXER.md) - Основная документация
- [MONITORING.md](../MONITORING.md) - Prometheus/Grafana
- [docs/TRANSACTIONS.md](../docs/TRANSACTIONS.md) - Транзакции БД
- [.env.indexer.example](../.env.indexer.example) - Все переменные окружения

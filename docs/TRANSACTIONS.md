# Использование транзакций в базе данных

## Зачем нужны транзакции?

**Проблема без транзакций:**
```typescript
// ❌ БЕЗ ТРАНЗАКЦИИ - опасно!
await db.insert(blocks).values(blockData);
await db.insert(transactions).values(txsData); // ← СБОЙ здесь
// Результат: блок записан, но транзакции потеряны!
```

**С транзакцией:**
```typescript
// ✅ С ТРАНЗАКЦИЕЙ - безопасно!
await withTransaction(async (tx) => {
  await tx.insert(blocks).values(blockData);
  await tx.insert(transactions).values(txsData); // ← СБОЙ здесь
  // Результат: rollback обеих операций, можно переиндексировать
});
```

## Импорт

```typescript
import { withTransaction } from "./svcs/database/index.js";
// или
import { withTransaction } from "./svcs/database/transactions.js";
```

## Примеры использования

### Пример 1: Запись блока с транзакциями

```typescript
// services/aztec-listener/src/svcs/poller/process-block.ts
import { withTransaction } from "../database/index.js";
import { getDb } from "../database/index.js";
import { blocks, transactions } from "../database/schema.js";

async function saveBlock(blockData: BlockData) {
  await withTransaction(async (tx) => {
    // Вставка блока
    await tx.insert(blocks).values({
      height: blockData.height,
      hash: blockData.hash,
      timestamp: blockData.timestamp,
      // ... другие поля
    });

    // Вставка всех транзакций этого блока
    if (blockData.txs.length > 0) {
      await tx.insert(transactions).values(
        blockData.txs.map(t => ({
          hash: t.hash,
          blockHeight: blockData.height,
          status: t.status,
          // ... другие поля
        }))
      );
    }

    // Обновление processed height
    await tx.insert(processedHeights).values({
      processorName: 'block-indexer',
      height: blockData.height,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: processedHeights.processorName,
      set: { height: blockData.height, updatedAt: new Date() }
    });
  });
}
```

### Пример 2: Обновление нескольких таблиц

```typescript
// services/explorer-api/src/events/received/on-block.ts
import { withTransaction } from "../../svcs/database/transactions.js";

async function processBlockEvent(event: BlockEvent) {
  await withTransaction(async (tx) => {
    // 1. Сохранить блок
    await tx.insert(l2Blocks).values({
      height: event.block.number,
      hash: event.block.hash,
      // ...
    });

    // 2. Сохранить tx effects
    await tx.insert(l2TxEffects).values(event.txEffects);

    // 3. Сохранить contract instances
    if (event.contractInstances.length > 0) {
      await tx.insert(l2ContractInstances).values(event.contractInstances);
    }

    // 4. Обновить статистику
    await tx.insert(l2Stats).values({
      totalBlocks: event.block.number,
      lastUpdated: new Date(),
    }).onConflictDoUpdate({
      target: l2Stats.id,
      set: { totalBlocks: event.block.number }
    });
  });
}
```

### Пример 3: Условная логика в транзакции

```typescript
async function processWithCondition(data: Data) {
  await withTransaction(async (tx) => {
    // Проверка существования
    const existing = await tx
      .select()
      .from(blocks)
      .where(eq(blocks.hash, data.hash))
      .limit(1);

    if (existing.length > 0) {
      // Обновление
      await tx
        .update(blocks)
        .set({ status: 'confirmed' })
        .where(eq(blocks.hash, data.hash));
    } else {
      // Вставка
      await tx.insert(blocks).values(data);
    }
  });
}
```

### Пример 4: Обработка ошибок

```typescript
async function processWithErrorHandling(data: BlockData) {
  try {
    await withTransaction(async (tx) => {
      await tx.insert(blocks).values(data);
      
      // Валидация
      if (data.height < 0) {
        throw new Error("Invalid block height");
      }
      
      await tx.insert(transactions).values(data.txs);
    });
    
    logger.info(`Block ${data.height} saved successfully`);
  } catch (error) {
    // Транзакция автоматически откатилась
    logger.error(`Failed to save block ${data.height}: ${error.message}`);
    // Можно попробовать снова или пропустить
    throw error;
  }
}
```

### Пример 5: Batch операции в транзакции

```typescript
async function saveMultipleBlocks(blocks: BlockData[]) {
  await withTransaction(async (tx) => {
    // Вставка всех блоков одним запросом
    await tx.insert(l2Blocks).values(blocks);

    // Сбор всех транзакций из всех блоков
    const allTxs = blocks.flatMap(b => b.txs);
    
    if (allTxs.length > 0) {
      // Вставка всех транзакций одним запросом
      await tx.insert(l2TxEffects).values(allTxs);
    }
  });
}
```

## Когда НЕ использовать транзакции

### ❌ Не нужно для одиночных операций

```typescript
// НЕ НУЖНО - одна операция итак атомарна
await withTransaction(async (tx) => {
  await tx.update(blocks).set({ status: 'confirmed' });
});

// ЛУЧШЕ - напрямую
const db = getDb();
await db.update(blocks).set({ status: 'confirmed' });
```

### ❌ Не нужно для SELECT запросов

```typescript
// НЕ НУЖНО - чтение не требует транзакции
await withTransaction(async (tx) => {
  return await tx.select().from(blocks).limit(10);
});

// ЛУЧШЕ - напрямую
const db = getDb();
const result = await db.select().from(blocks).limit(10);
```

## Вложенные транзакции

**НЕ ПОДДЕРЖИВАЮТСЯ!** Drizzle ORM не поддерживает вложенные транзакции.

```typescript
// ❌ НЕ ДЕЛАЙТЕ ТАК!
await withTransaction(async (tx1) => {
  await tx1.insert(blocks).values(data);
  
  await withTransaction(async (tx2) => { // ← ОШИБКА!
    await tx2.insert(transactions).values(data.txs);
  });
});

// ✅ ПРАВИЛЬНО - одна транзакция
await withTransaction(async (tx) => {
  await tx.insert(blocks).values(data);
  await tx.insert(transactions).values(data.txs);
});
```

## Best Practices

### 1. Группируйте связанные операции

```typescript
// ✅ ХОРОШО - логически связанные операции в одной транзакции
await withTransaction(async (tx) => {
  await tx.insert(blocks).values(blockData);
  await tx.insert(transactions).values(blockData.txs);
  await tx.update(processedHeights).set({ height: blockData.height });
});
```

### 2. Делайте транзакции короткими

```typescript
// ❌ ПЛОХО - долгие операции в транзакции
await withTransaction(async (tx) => {
  const data = await fetchFromRPC(); // ← Долгий RPC запрос!
  await tx.insert(blocks).values(data);
});

// ✅ ХОРОШО - только операции с БД в транзакции
const data = await fetchFromRPC(); // Сначала получаем данные
await withTransaction(async (tx) => {
  await tx.insert(blocks).values(data); // Потом быстро пишем
});
```

### 3. Обрабатывайте ошибки

```typescript
// ✅ ХОРОШО - явная обработка ошибок
try {
  await withTransaction(async (tx) => {
    await tx.insert(blocks).values(data);
  });
} catch (error) {
  logger.error(`Transaction failed: ${error.message}`);
  // Решаем что делать: retry, skip, alert и т.д.
}
```

### 4. Используйте для критичных операций

**Всегда используйте транзакции для:**
- Сохранения блока с транзакциями
- Обновления связанных таблиц (block + txs + contracts)
- Миграции данных
- Любых операций, где важна консистентность

**Можно не использовать для:**
- Одиночных INSERT/UPDATE
- SELECT запросов
- Логирования
- Обновления статистики (не критично)

## Мониторинг транзакций

Добавьте логирование для отслеживания долгих транзакций:

```typescript
export async function withTransaction<T>(
  callback: (tx: ReturnType<typeof getDb>) => Promise<T>,
): Promise<T> {
  const db = getDb();
  const startTime = Date.now();

  try {
    const result = await db.transaction(async (tx) => {
      return await callback(tx as any);
    });

    const duration = Date.now() - startTime;
    logger.debug(`Transaction committed in ${duration}ms`);
    
    // Алерт если транзакция слишком долгая
    if (duration > 5000) {
      logger.warn(`Slow transaction detected: ${duration}ms`);
    }
    
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(
      `Transaction rolled back after ${duration}ms: ${(error as Error).message}`,
    );
    throw error;
  }
}
```

## Примеры из реального кода

Найдите примеры использования в проекте:

```bash
# Поиск мест, где нужны транзакции
grep -r "db.insert" services/*/src --include="*.ts" -A 2

# Примеры критичных операций
grep -r "onConflictDoUpdate" services/*/src --include="*.ts"
```

## Резюме

✅ **Используйте транзакции когда:**
- Пишете в несколько связанных таблиц
- Важна атомарность (всё или ничего)
- Обновляете критичные данные

❌ **НЕ используйте когда:**
- Одиночная операция
- Только SELECT
- Некритичные обновления

🎯 **Правило большого пальца:**
> Если операция может оставить БД в некорректном состоянии при частичном выполнении - используйте транзакцию!

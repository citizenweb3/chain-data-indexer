import { getDb } from "@chicmoz-pkg/postgres-helper";
import { logger } from "../../logger.js";

/**
 * Выполняет callback в рамках транзакции PostgreSQL
 * Если callback бросает ошибку - транзакция откатывается (rollback)
 * Если callback успешно выполняется - транзакция фиксируется (commit)
 * 
 * @param callback - Функция для выполнения в транзакции
 * @returns Promise с результатом callback
 * 
 * @example
 * await withTransaction(async (tx) => {
 *   await tx.insert(blocks).values(blockData);
 *   await tx.insert(transactions).values(txsData);
 * });
 */
export async function withTransaction<T>(
  callback: (tx: any) => Promise<T>,
): Promise<T> {
  const db = getDb();

  try {
    const result = await db.transaction(async (tx) => {
      return await callback(tx);
    });

    logger.debug("Database transaction committed successfully");
    return result;
  } catch (error) {
    logger.error(
      `Database transaction rolled back due to error: ${(error as Error).message}`,
    );
    throw error;
  }
}

/**
 * Проверяет, активна ли транзакция в данный момент
 * Полезно для отладки и предотвращения вложенных транзакций
 */
export function isInTransaction(): boolean {
  // В Drizzle ORM нет прямого способа проверить это
  // Это больше для документации и будущего использования
  return false;
}

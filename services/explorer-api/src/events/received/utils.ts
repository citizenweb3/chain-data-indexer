import { logger } from "../../logger.js";

export type PartialDbError = {
  code: string;
  detail: string;
};

export const handleDuplicateBlockError = async (
  e: Error | PartialDbError,
  additionalInfo: string,
  deleteBlockCallback: () => Promise<void>,
  unOrphanCallback?: () => Promise<void>,
): Promise<boolean> => {
  if ((e as PartialDbError).code === "23505") {
    const detail = (e as PartialDbError).detail;
    if (detail.includes("(hash)")) {
      if (unOrphanCallback) {
        logger.info(
          `DB duplicate hash for "${additionalInfo}": attempting to un-orphan existing block. [${detail}]`,
        );
        await unOrphanCallback();
      } else {
        logger.warn(`DB duplicate for "${additionalInfo}" skipping... [${detail}]`);
      }
    } else if (detail.includes("(tx_hash)") || detail.includes("(height)")) {
      logger.warn(
        `DB duplicate for "${additionalInfo}": deleting block at height and retrying. [${detail}]`,
      );
      await deleteBlockCallback();
      return true;
    } else {
      logger.warn(`DB duplicate for "${additionalInfo}" skipping... [${detail}]`);
    }
  } else {
    handleOtherError(e as Error, additionalInfo);
  }
  return false;
};

export const handleDuplicateError = (
  e: Error | PartialDbError,
  additionalInfo: string,
) => {
  if ((e as PartialDbError).code === "23505") {
    logger.warn(`DB Duplicate: ${additionalInfo}`);
    return;
  }
  handleOtherError(e as Error, additionalInfo);
};

const handleOtherError = (e: Error, additionalInfo: string) => {
  if (e.stack) {
    logger.error(
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      `Failed to store ${additionalInfo}: ${e?.stack}`,
    );
    return;
  }
  logger.warn(JSON.stringify(e));
  logger.error(new Error(`Failed to store ${additionalInfo}`).stack);
};

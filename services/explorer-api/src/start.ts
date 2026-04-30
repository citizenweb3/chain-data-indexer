import {
  AZTEC_SCAN_MANUAL_SOURCE_CODE_URLS,
  AZTEC_SCAN_NOTES,
} from "./constants.js";
import { L2_NETWORK_ID } from "./environment.js";
import { subscribeHandlers } from "./events/received/index.js";
import { logger } from "./logger.js";
import { startMetricsSampler } from "./metrics/sampler.js";
import { removeDroppedThatHaveTxEffects } from "./svcs/database/controllers/dropped-tx/remove.js";
import { updateContractInstanceAztecScanNotes } from "./svcs/database/controllers/l2/aztec-scan-notes.js";
import { initializeRollupVersionCache } from "./svcs/database/controllers/l2/chain-info/rollup-version-cache.js";
import { deleteAllTxs } from "./svcs/database/controllers/l2Tx/delete-all-txs.js";
import { updateContractClassManualSourceCodeUrl } from "./svcs/database/controllers/l2contract/update.js";
import { initializeProtocolContracts } from "./utils/protocol-contracts.js";

export const start = async () => {
  await deleteAllTxs(); // TODO: perhaps a more specific deleteAllTxs should be created, also some logs could be good.
  await removeDroppedThatHaveTxEffects();
  await initializeRollupVersionCache();
  // initializeProtocolContracts() uses @aztec/bb.js (Poseidon2 + VK hashing) which requires
  // the native barretenberg binary or a WASM backend with CRS data.
  // On VMs without AVX2 support (or arm64 images under QEMU), this may fail.
  // Wrap in try-catch so the service continues — protocol contract metadata will be absent
  // but core block/tx indexing is unaffected.
  try {
    await initializeProtocolContracts();
  } catch (e) {
    logger.warn(
      `⚠️  initializeProtocolContracts failed (bb.js backend unavailable): ${(e as Error).message}. Protocol contract metadata will be missing.`,
    );
  }
  const aztecScanNotes = AZTEC_SCAN_NOTES[L2_NETWORK_ID];
  if (aztecScanNotes) {
    for (const [contractInstanceAddress, notes] of Object.entries(
      aztecScanNotes,
    )) {
      logger.info(`Updating with hardcoded aztec scan notes for contract: ${contractInstanceAddress}
ORIGIN: ${notes.origin}`);
      await updateContractInstanceAztecScanNotes({
        contractInstanceAddress,
        aztecScanNotes: notes,
      });
    }
  }
  const aztecScanManualSourceCodeUrls =
    AZTEC_SCAN_MANUAL_SOURCE_CODE_URLS[L2_NETWORK_ID];
  if (aztecScanManualSourceCodeUrls) {
    for (const [contractClassId, sourceCodeUrl] of Object.entries(
      aztecScanManualSourceCodeUrls,
    )) {
      logger.info(`Updating with hardcoded aztec scan manual source code urls for contract: ${contractClassId}
URL: ${sourceCodeUrl}`);
      await updateContractClassManualSourceCodeUrl({
        contractClassId,
        sourceCodeUrl,
      });
    }
  }

  await subscribeHandlers();
  startMetricsSampler();
};

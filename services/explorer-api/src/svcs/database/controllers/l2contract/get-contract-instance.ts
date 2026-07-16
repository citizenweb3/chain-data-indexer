import { getDb as db } from "@chicmoz-pkg/postgres-helper";
import { ChicmozL2ContractInstanceDeluxe, HexString } from "@chicmoz-pkg/types";
import { and, desc, eq, getTableColumns, isNotNull } from "drizzle-orm";
import { CURRENT_ROLLUP_VERSION } from "../../../../constants/versions.js";
import { l2Block } from "../../schema/index.js";
import {
  l2ContractClassRegistered,
  l2ContractInstanceAztecScanNotes,
  l2ContractInstanceDeployed,
  l2ContractInstanceDeployerMetadataTable,
  l2ContractInstanceVerifiedDeploymentArguments,
} from "../../schema/l2contract/index.js";
import { getContractClassRegisteredColumns, parseDeluxe } from "./utils.js";

export const getL2DeployedContractInstanceByAddress = async (
  address: HexString,
  includeArtifactJson?: boolean,
): Promise<ChicmozL2ContractInstanceDeluxe | null> => {
  const result = await db()
    .select({
      instance: getTableColumns(l2ContractInstanceDeployed),
      class: getContractClassRegisteredColumns(includeArtifactJson),
      verifiedDeploymentArguments: getTableColumns(
        l2ContractInstanceVerifiedDeploymentArguments,
      ),
      deployerMetadata: getTableColumns(
        l2ContractInstanceDeployerMetadataTable,
      ),
      aztecScanNotes: getTableColumns(l2ContractInstanceAztecScanNotes),
      isOrphaned: isNotNull(l2Block.orphan_timestamp),
    })
    .from(l2ContractInstanceDeployed)
    .innerJoin(l2Block, eq(l2ContractInstanceDeployed.blockHash, l2Block.hash))
    .innerJoin(
      l2ContractClassRegistered,
      and(
        eq(
          l2ContractInstanceDeployed.currentContractClassId,
          l2ContractClassRegistered.contractClassId,
        ),
        eq(
          l2ContractInstanceDeployed.version,
          l2ContractClassRegistered.version,
        ),
      ),
    )
    .leftJoin(
      l2ContractInstanceVerifiedDeploymentArguments,
      and(
        eq(
          l2ContractInstanceDeployed.address,
          l2ContractInstanceVerifiedDeploymentArguments.address,
        ),
      ),
    )
    .leftJoin(
      l2ContractInstanceDeployerMetadataTable,
      eq(
        l2ContractInstanceDeployed.address,
        l2ContractInstanceDeployerMetadataTable.address,
      ),
    )
    .leftJoin(
      l2ContractInstanceAztecScanNotes,
      eq(
        l2ContractInstanceDeployed.address,
        l2ContractInstanceAztecScanNotes.address,
      ),
    )
    .where(
      and(
        eq(l2ContractInstanceDeployed.address, address),
        eq(l2Block.version, parseInt(CURRENT_ROLLUP_VERSION)),
      ),
    )
    .orderBy(desc(l2ContractInstanceDeployed.version))
    .limit(1);

  if (result.length === 0) {
    return null;
  }

  const {
    instance,
    class: contractClass,
    verifiedDeploymentArguments,
    deployerMetadata,
    aztecScanNotes,
    isOrphaned,
  } = result[0];

  return parseDeluxe({
    contractClass,
    instance,
    verifiedDeploymentArguments,
    deployerMetadata,
    aztecScanNotes,
    isOrphaned: Boolean(isOrphaned),
  });
};

// v5 migration (S3): immutablesHash is required to verify a contract
// instance deployment (see @chicmoz-pkg/contract-verification), but it must
// never be surfaced on /l2/* responses (see chicmozL2ContractInstanceDeluxeSchema,
// which explicitly omits it). This dedicated, internal-only query is the
// sanctioned way to source it server-side, instead of round-tripping it
// through the already-serialized (and intentionally immutablesHash-less)
// Deluxe API object.
export const getL2ContractInstanceImmutablesHash = async (
  address: HexString,
): Promise<string | null> => {
  const result = await db()
    .select({ immutablesHash: l2ContractInstanceDeployed.immutablesHash })
    .from(l2ContractInstanceDeployed)
    .where(eq(l2ContractInstanceDeployed.address, address))
    .orderBy(desc(l2ContractInstanceDeployed.version))
    .limit(1);

  return result[0]?.immutablesHash ?? null;
};

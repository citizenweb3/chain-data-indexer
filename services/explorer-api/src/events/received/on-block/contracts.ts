import { ContractClassPublishedEvent } from "@aztec/protocol-contracts/class-registry";
import {
  ContractInstancePublishedEvent,
  ContractInstanceUpdatedEvent,
} from "@aztec/protocol-contracts/instance-registry";
import {
  chicmozL2ContractClassRegisteredEventSchema,
  chicmozL2ContractInstanceDeployedEventSchema,
  ChicmozL2ContractInstanceUpdatedEvent,
  chicmozL2ContractInstanceUpdatedEventSchema,
  type ChicmozL2ContractClassRegisteredEvent,
  type ChicmozL2ContractInstanceDeployedEvent,
} from "@chicmoz-pkg/types";
import { z } from "zod";
import { logger } from "../../../logger.js";
import { controllers } from "../../../svcs/database/index.js";
import { handleDuplicateError } from "../utils.js";
import { L2Block } from "@aztec/aztec.js/block";

const parseObjs = <ParsedType, AztecType>(
  blockHash: string,
  objs: AztecType[],
  parseFn: (obj: AztecType, blockHash?: string) => ParsedType,
) => {
  const parsedObjs: ParsedType[] = [];
  for (const obj of objs) {
    try {
      const parsed = parseFn(obj, blockHash);
      parsedObjs.push(parsed);
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      logger.error(`Failed to parse object: ${e}`);
      logger.error((e as Error).stack);
    }
  }
  return parsedObjs;
};

const storeObj = async <T>(
  objs: T[],
  storeFn: (obj: T) => Promise<void>,
  objType: string,
  objId: keyof T,
) => {
  for (const obj of objs) {
    await storeFn(obj).catch((e) => {
      const duplicateErrorId = obj[objId] as string;
      handleDuplicateError(e as Error, `${objType} ${duplicateErrorId}`);
    });
  }
};

// NOTE: reference for parsing in aztec-packages: yarn-project/archiver/src/archiver/archiver.ts
export const storeContracts = async (b: L2Block, blockHash: string) => {
  const privateLogs = b.body.txEffects.flatMap(
    (txEffect) => txEffect.privateLogs,
  );

  const publicLogs = b.body.txEffects.flatMap(
    (txEffect) => txEffect.publicLogs,
  );

  // TODO: link contract instances & contract classes to blocks & txs: https://github.com/aztlan-labs/chicmoz/issues/285

  const contractInstanceDeployed = privateLogs
    .filter((log) =>
      ContractInstancePublishedEvent.isContractInstancePublishedEvent(log),
    )
    .map((log) => ContractInstancePublishedEvent.fromLog(log))
    .map((e) => e.toContractInstance());

  const contractInstanceUpdated = publicLogs
    .filter((log) =>
      ContractInstanceUpdatedEvent.isContractInstanceUpdatedEvent(log),
    )
    .map((log) => ContractInstanceUpdatedEvent.fromLog(log))
    .map((e) => e.toContractInstanceUpdate());

  const contractClassLogs = b.body.txEffects
    .flatMap((txEffect) => (txEffect ? [txEffect.contractClassLogs] : []))
    .flat();

  const contractClassRegisteredEvents = contractClassLogs
    .filter((log) =>
      ContractClassPublishedEvent.isContractClassPublishedEvent(log),
    )
    .map((log) => ContractClassPublishedEvent.fromLog(log));

  // toContractClassPublic() invokes Poseidon2 via bb.js (native barretenberg).
  // Use allSettled so a single failing entry does not abort processing of the whole block.
  const contractClassSettled = await Promise.allSettled(
    contractClassRegisteredEvents.map((e) => e.toContractClassPublic()),
  );
  const contractClasses = contractClassSettled.flatMap((r) => {
    if (r.status === "rejected") {
      logger.error(
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        `Failed to compute contract class for block ${blockHash}: ${(r.reason as Error)?.stack ?? r.reason}`,
      );
      return [];
    }
    return [r.value];
  });

  // NOTE (v5 migration, S3): `PrivateFunctionBroadcastedEvent` and
  // `UtilityFunctionBroadcastedEvent` no longer exist in
  // `@aztec/protocol-contracts/class-registry` - v5 does not broadcast
  // individual private/utility functions as separate on-chain events
  // anymore (only `ContractClassPublishedEvent` remains, and
  // `toContractClassPublic()` no longer exposes `privateFunctions`/
  // `utilityFunctions`). This is a genuine capability removal upstream,
  // not a rename - confirmed by diffing the package's exports, not
  // inferred. The `l2_private_function` / `l2_utility_function` tables
  // hold zero rows in prod (this path was never populated even on v4),
  // so this is a clean removal of dead code, not a behavior change.
  // The GET endpoints reading those tables (get-class-functions.ts) are
  // left untouched; they will simply keep returning empty results.

  if (contractClasses.length > 0) {
    logger.info(
      `📜 Parsing and storing ${contractClasses.length} contract classes`,
    );
  }
  if (contractInstanceDeployed.length > 0) {
    logger.info(
      `📖 Parsing and storing ${contractInstanceDeployed.length} contract instances deployed`,
    );
  }
  if (contractInstanceUpdated.length > 0) {
    logger.info(
      `⬆️ Parsing and storing ${contractInstanceUpdated.length} contract instances updated`,
    );
  }

  const contractClassesWithId = contractClasses.map((contractClass) => {
    return {
      ...contractClass,
      contractClassId: contractClass.id,
    };
  });

  const parsedContractClasses: ChicmozL2ContractClassRegisteredEvent[] =
    parseObjs(blockHash, contractClassesWithId, (contractClass, blockHash) =>
      chicmozL2ContractClassRegisteredEventSchema.parse({
        ...contractClass,
        blockHash,
        contractClassId: contractClass.contractClassId.toString(),
        artifactHash: contractClass.artifactHash.toString(),
        privateFunctionsRoot: contractClass.privateFunctionsRoot.toString(),
      } as ChicmozL2ContractClassRegisteredEvent),
    );
  const parsedContractInstancesDeployed: ChicmozL2ContractInstanceDeployedEvent[] =
    parseObjs(
      blockHash,
      contractInstanceDeployed,
      (contractInstance, blockHash) =>
        chicmozL2ContractInstanceDeployedEventSchema.parse({
          ...contractInstance,
          blockHash,
          address: contractInstance.address.toString(),
          salt: contractInstance.salt.toString(),
          currentContractClassId:
            contractInstance.currentContractClassId.toString(),
          originalContractClassId:
            contractInstance.originalContractClassId.toString(),
          initializationHash: contractInstance.initializationHash.toString(),
          deployer: contractInstance.deployer.toString(),
          // v5 PublicKeys shape (see AZTEC_V5_MIGRATION.md §3.5 RESOLVED
          // decision): only ivpkM remains a curve point, the rest are hash
          // digests. Emitted as-is - the six real v5 fields, no fabricated
          // data.
          publicKeys: {
            npkMHash: contractInstance.publicKeys.npkMHash.toString(),
            ivpkM: contractInstance.publicKeys.ivpkM.toString(),
            ovpkMHash: contractInstance.publicKeys.ovpkMHash.toString(),
            tpkMHash: contractInstance.publicKeys.tpkMHash.toString(),
            mspkMHash: contractInstance.publicKeys.mspkMHash.toString(),
            fbpkMHash: contractInstance.publicKeys.fbpkMHash.toString(),
          },
          // v5: new required ContractInstance preimage field. Stored, but
          // never surfaced on /l2/* responses (see l2Contract.ts /
          // special.ts).
          immutablesHash: contractInstance.immutablesHash.toString(),
        } as ChicmozL2ContractInstanceDeployedEvent),
    );
  const parsedContractInstanceUpdate: ChicmozL2ContractInstanceUpdatedEvent[] =
    parseObjs(blockHash, contractInstanceUpdated, (contractInstance) =>
      chicmozL2ContractInstanceUpdatedEventSchema.parse({
        ...contractInstance,
        timestampOfChange: z.number().parse(contractInstance.timestampOfChange),
        blockHash,
        address: contractInstance.address.toString(),
        prevContractClassId: contractInstance.prevContractClassId.toString(),
        newContractClassId: contractInstance.newContractClassId.toString(),
      } as ChicmozL2ContractInstanceUpdatedEvent),
    );
  await storeObj(
    parsedContractClasses,
    controllers.l2Contract.storeContractClass,
    "contractClass",
    "contractClassId",
  );
  await storeObj(
    parsedContractInstancesDeployed,
    controllers.l2Contract.storeContractInstanceDeployed,
    "contractInstanceDeployed",
    "address",
  );
  await storeObj(
    parsedContractInstanceUpdate,
    controllers.l2Contract.storeContractInstanceUpdated,
    "contractInstanceUpdated",
    "address",
  );
  // NOTE (v5 migration, S3): no longer storing private/utility function
  // broadcast events - see the comment above `contractClassLogs` parsing.
  // `controllers.l2Contract.storePrivateFunction` / `storeUtilityFunction`
  // are intentionally left in place (dead code, unused by this path) since
  // the DB tables/read paths (`get-class-functions.ts`) are untouched.
};

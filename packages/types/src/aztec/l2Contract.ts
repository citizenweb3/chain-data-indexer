import { z } from "zod";
import { aztecAddressSchema } from "../general.js";
import { chicmozL2BlockSchema } from "./l2Block.js";
import { aztecScanNoteSchema } from "./special.js";
import {
  bufferSchema,
  concatFrPointSchema,
  frSchema,
  frTimestampSchema,
} from "./utils.js";

export const chicmozL2ContractInstanceDeployedEventSchema = z.object({
  address: aztecAddressSchema,
  blockHash: chicmozL2BlockSchema.shape.hash,
  version: z.number(), // TODO: rename to contractClassVersion
  salt: frSchema,
  currentContractClassId: frSchema,
  originalContractClassId: frSchema,
  initializationHash: frSchema,
  deployer: aztecAddressSchema,
  aztecScanNotes: aztecScanNoteSchema.optional(),
  // v5: only `ivpkM` remains a curve point; the other master keys are now
  // exposed as their hash digests only (see AZTEC_V5_MIGRATION.md §3.5,
  // the "publicKeys" RESOLVED decision). This is a deliberate, sanctioned
  // /l2/* response shape change.
  // NULLABLE (§3.6): prod has 52 pre-existing v4 rows with no v5-shaped key
  // data - NULL is the honest value for those. Every v5-ingested instance
  // always populates real values (see contracts.ts / store.ts); old v4
  // instances leave the API on the rollup-version flip anyway.
  publicKeys: z.object({
    npkMHash: frSchema.nullish(),
    ivpkM: concatFrPointSchema.nullish(),
    ovpkMHash: frSchema.nullish(),
    tpkMHash: frSchema.nullish(),
    mspkMHash: frSchema.nullish(),
    fbpkMHash: frSchema.nullish(),
  }),
  // v5: new required preimage field (ContractInstance address-preimage
  // version 1->2). Stored for correctness/verification, but intentionally
  // NOT surfaced on /l2/* responses (see chicmozL2ContractInstanceDeluxeSchema,
  // which explicitly omits it). Nullish here for two reasons: (1) this
  // schema is also reused internally to re-parse the already-serialized
  // Deluxe API object, which does not carry this field, and (2) the 52
  // pre-existing v4 rows on prod genuinely have no v5 preimage data (§3.6).
  immutablesHash: frSchema.nullish(),
});

export type ChicmozL2ContractInstanceDeployedEvent = z.infer<
  typeof chicmozL2ContractInstanceDeployedEventSchema
>;

export const chicmozL2ContractInstanceUpdatedEventSchema = z.object({
  address: aztecAddressSchema,
  prevContractClassId: frSchema,
  newContractClassId: frSchema,
  timestampOfChange: frTimestampSchema,
  blockHash: chicmozL2BlockSchema.shape.hash,
});

export type ChicmozL2ContractInstanceUpdatedEvent = z.infer<
  typeof chicmozL2ContractInstanceUpdatedEventSchema
>;

export const chicmozL2ContractInstanceVerifiedDeploymentArgumentsSchema =
  z.object({
    id: z.string().uuid().optional(),
    address: aztecAddressSchema,
    salt: frSchema,
    deployer: aztecAddressSchema,
    publicKeysString: z.string(),
    constructorArgs: z.string().array(),
  });

export type ChicmozL2ContractInstanceVerifiedDeploymentArgumnetsSchema =
  z.infer<typeof chicmozL2ContractInstanceVerifiedDeploymentArgumentsSchema>;

export const chicmozL2ContractClassRegisteredEventSchema = z.object({
  blockHash: chicmozL2BlockSchema.shape.hash,
  contractClassId: frSchema,
  version: z.number(),
  artifactHash: frSchema,
  privateFunctionsRoot: frSchema,
  packedBytecode: bufferSchema,
  artifactJson: z.string().nullable().optional(),
  artifactContractName: z.string().nullable().optional(),
  standardContractType: z.string().nullable().optional(),
  standardContractVersion: z.string().nullable().optional(),
  sourceCodeUrl: z.string().nullable().optional(),
});

export type ChicmozL2ContractClassRegisteredEvent = z.infer<
  typeof chicmozL2ContractClassRegisteredEventSchema
>;

const functionSelectorSchema = z.object({
  value: z.number(),
});

export const chicmozL2PrivateFunctionBroadcastedEventSchema = z.object({
  contractClassId:
    chicmozL2ContractClassRegisteredEventSchema.shape.contractClassId,
  artifactMetadataHash: frSchema,
  utilityFunctionsTreeRoot: frSchema,
  privateFunctionTreeSiblingPath: z.array(frSchema), // TODO: is it fixed size?
  privateFunctionTreeLeafIndex: z.number(),
  artifactFunctionTreeSiblingPath: z.array(frSchema), // TODO: is it fixed size?
  artifactFunctionTreeLeafIndex: z.number(),
  privateFunction: z.object({
    selector: functionSelectorSchema,
    metadataHash: frSchema,
    vkHash: frSchema,
    bytecode: bufferSchema,
  }),
});

export type ChicmozL2PrivateFunctionBroadcastedEvent = z.infer<
  typeof chicmozL2PrivateFunctionBroadcastedEventSchema
>;

export const chicmozL2UtilityFunctionBroadcastedEventSchema = z.object({
  contractClassId:
    chicmozL2ContractClassRegisteredEventSchema.shape.contractClassId,
  artifactMetadataHash: frSchema,
  privateFunctionsArtifactTreeRoot: frSchema,
  artifactFunctionTreeSiblingPath: z.array(frSchema), // TODO: is it fixed size?
  artifactFunctionTreeLeafIndex: z.number(),
  utilityFunction: z.object({
    selector: functionSelectorSchema,
    metadataHash: frSchema,
    bytecode: bufferSchema,
  }),
});

export type ChicmozL2UtilityFunctionBroadcastedEvent = z.infer<
  typeof chicmozL2UtilityFunctionBroadcastedEventSchema
>;

export const CONTRACT_STANDARDS = {
  "4.1.0-rc.2": [
    "token",
    "dripper",
    "escrow",
    "nft",
    "generic_proxy",
    "test_logic",
  ],
};

export const contractStandardVersionSchema = z.enum(
  Object.keys(CONTRACT_STANDARDS) as [keyof typeof CONTRACT_STANDARDS],
);

export type ContractStandardVersion = keyof typeof CONTRACT_STANDARDS;

export const contractStandardNameSchema = <V extends ContractStandardVersion>(
  version: V,
) => z.enum(CONTRACT_STANDARDS[version] as [string, ...string[]]);

export const contractStandardSchema = z
  .object({
    version: contractStandardVersionSchema,
    name: z.string(),
  })
  .refine(
    (data) =>
      CONTRACT_STANDARDS[data.version as ContractStandardVersion].includes(
        data.name,
      ),
    {
      message: "Contract name is not valid for the specified version",
      path: ["name"],
    },
  );

export type ContractStandardName<V extends ContractStandardVersion> =
  (typeof CONTRACT_STANDARDS)[V][number];

export type ContractStandard = z.infer<typeof contractStandardSchema>;

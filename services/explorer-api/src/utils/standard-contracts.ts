import {
  ContractStandard,
  ContractStandardName,
  ContractStandardVersion,
} from "@chicmoz-pkg/types";
import DripperContractJson from "@defi-wonderland/aztec-standards/target/dripper-Dripper.json" with { type: "json" };
import TokenContractJson from "@defi-wonderland/aztec-standards/target/token_contract-Token.json" with { type: "json" };
import EscrowContractJson from "@defi-wonderland/aztec-standards/target/escrow_contract-Escrow.json" with { type: "json" };
import NftContractJson from "@defi-wonderland/aztec-standards/target/nft_contract-NFT.json" with { type: "json" };
import GenericProxyContractJson from "@defi-wonderland/aztec-standards/target/generic_proxy-GenericProxy.json" with { type: "json" };
import TestLogicContractJson from "@defi-wonderland/aztec-standards/target/test_logic_contract-TestLogic.json" with { type: "json" };
import { NoirCompiledContract } from "@aztec/aztec.js/abi";

const contracts: Record<
  ContractStandardVersion,
  Record<ContractStandardName<ContractStandardVersion>, NoirCompiledContract>
> = {
  // v4-era artifacts (@defi-wonderland/aztec-standards@4.0.0-devnet.2-patch.1): the bundled
  // JSON lacks the v5 `aztec_version` field NoirCompiledContract now requires, hence the
  // `as unknown as` escape hatch below. Standard-contract identification will NOT match
  // v5-deployed standards until aztec-standards ships a stable 5.0.0 (5.0.0-rc.2 exists but
  // is not stable — do not pull it in). TODO: bump to that stable 5.0.0 and add a `5.0.0`
  // ContractStandardVersion key here.
  "4.1.0-rc.2": {
    // TODO: these types are not actually checked
    token: TokenContractJson as unknown as NoirCompiledContract,
    dripper: DripperContractJson as unknown as NoirCompiledContract,
    escrow: EscrowContractJson as unknown as NoirCompiledContract,
    nft: NftContractJson as unknown as NoirCompiledContract,
    generic_proxy: GenericProxyContractJson as unknown as NoirCompiledContract,
    test_logic: TestLogicContractJson as unknown as NoirCompiledContract,
  },
};

export const getContractJson = (
  args: ContractStandard,
): NoirCompiledContract => {
  const { name, version } = args;
  const contract = contracts[version]?.[name];
  if (!contract) {
    throw new Error(`Contract ${name} version ${version} not found`);
  }
  return contract;
};

export const getVersions = () => {
  return Object.keys(contracts).map((version) => ({
    version,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    contracts: Object.keys(contracts[version as ContractStandardVersion]),
  }));
};

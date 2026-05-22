import type { ChainName } from "@/lib/chains";

interface ExplorerConfig {
  blocksUrl: (height: string) => string;
  addressUrl: (address: string) => string;
}

const validatorInfo = (network: string): ExplorerConfig => ({
  blocksUrl: (height) =>
    `https://validatorinfo.com/en/networks/${network}/blocks/${encodeURIComponent(height)}`,
  addressUrl: (address) =>
    `https://validatorinfo.com/en/networks/${network}/address/${encodeURIComponent(address)}/passport`,
});

const EXPLORERS: Record<ChainName, ExplorerConfig> = {
  cosmoshub: validatorInfo("cosmoshub"),
  atomone: validatorInfo("atomone"),
};

export const getExplorer = (chain: ChainName): ExplorerConfig => EXPLORERS[chain];

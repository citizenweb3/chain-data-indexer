import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

type AssetSeed = {
  symbol: string;
  coingeckoId: string;
  decimals: number;
  nativeDenom: string;
};

const ASSETS: AssetSeed[] = [
  { symbol: 'ATOM',    coingeckoId: 'cosmos',                  decimals: 6,  nativeDenom: 'uatom' },
  { symbol: 'OSMO',    coingeckoId: 'osmosis',                 decimals: 6,  nativeDenom: 'uosmo' },
  { symbol: 'USDC',    coingeckoId: 'usd-coin',                decimals: 6,  nativeDenom: 'uusdc' },
  { symbol: 'IRIS',    coingeckoId: 'iris-network',            decimals: 6,  nativeDenom: 'uiris' },
  { symbol: 'stATOM',  coingeckoId: 'stride-staked-atom',      decimals: 6,  nativeDenom: 'stuatom' },
  { symbol: 'KUJI',    coingeckoId: 'kujira',                  decimals: 6,  nativeDenom: 'ukuji' },
  { symbol: 'ISLM',    coingeckoId: 'islamic-coin',            decimals: 18, nativeDenom: 'aISLM' },
  { symbol: 'KOPI',    coingeckoId: 'kopi',                    decimals: 6,  nativeDenom: 'ukopi' },
  { symbol: 'WBTC',    coingeckoId: 'wrapped-bitcoin',         decimals: 8,  nativeDenom: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599' },
  { symbol: 'WETH',    coingeckoId: 'weth',                    decimals: 18, nativeDenom: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' },
  { symbol: 'USDT',    coingeckoId: 'tether',                  decimals: 6,  nativeDenom: '0xdac17f958d2ee523a2206206994597c13d831ec7' },
  { symbol: 'PAXG',    coingeckoId: 'pax-gold',                decimals: 18, nativeDenom: '0x45804880de22913dafe09f4980848ece6ecbaf78' },
  { symbol: 'XPRT',    coingeckoId: 'persistence',             decimals: 6,  nativeDenom: 'uxprt' },
  { symbol: 'STRD',    coingeckoId: 'stride',                  decimals: 6,  nativeDenom: 'ustrd' },
  { symbol: 'EVMOS',   coingeckoId: 'evmos',                   decimals: 18, nativeDenom: 'aevmos' },
  { symbol: 'NTRN',    coingeckoId: 'neutron-3',               decimals: 6,  nativeDenom: 'untrn' },
  { symbol: 'STARS',   coingeckoId: 'stargaze',                decimals: 6,  nativeDenom: 'ustars' },
  { symbol: 'AKT',     coingeckoId: 'akash-network',           decimals: 6,  nativeDenom: 'uakt' },
  { symbol: 'INJ',     coingeckoId: 'injective-protocol',      decimals: 18, nativeDenom: 'inj' },
  { symbol: 'JUNO',    coingeckoId: 'juno-network',            decimals: 6,  nativeDenom: 'ujuno' },
  { symbol: 'DVPN',    coingeckoId: 'sentinel',                decimals: 6,  nativeDenom: 'udvpn' },
  { symbol: 'CORE',    coingeckoId: 'coreum',                  decimals: 6,  nativeDenom: 'ucore' },
  { symbol: 'SEDA',    coingeckoId: 'seda-2',                  decimals: 18, nativeDenom: 'aseda' },
  { symbol: 'ZIG',     coingeckoId: 'zignaly',                 decimals: 6,  nativeDenom: 'uzig' },
  { symbol: 'stOSMO',  coingeckoId: 'stride-staked-osmo',      decimals: 6,  nativeDenom: 'stuosmo' },
  { symbol: 'stINJ',   coingeckoId: 'stride-staked-injective', decimals: 18, nativeDenom: 'stinj' },
  { symbol: 'stSTARS', coingeckoId: 'stride-staked-stars',     decimals: 6,  nativeDenom: 'stustars' },
  { symbol: 'stJUNO',  coingeckoId: 'stride-staked-juno',      decimals: 6,  nativeDenom: 'stujuno' },
  { symbol: 'USDT.n',  coingeckoId: 'tether',                  decimals: 6,  nativeDenom: 'uusdt' },
  { symbol: 'USDT.s',  coingeckoId: 'tether',                  decimals: 6,  nativeDenom: 'erc20/tether/usdt' },
  { symbol: 'USDT.a',  coingeckoId: 'tether',                  decimals: 6,  nativeDenom: 'factory/osmo1em6xs47hd82806f5cxgyufguxrrc7l0aqx7nzzptjuqgswczk8csavdxek/alloyed/allUSDT' },
  { symbol: 'ARCH',    coingeckoId: 'archway',                 decimals: 18, nativeDenom: 'aarch' },
  { symbol: 'DYM',     coingeckoId: 'dymension',               decimals: 18, nativeDenom: 'adym' },
  { symbol: 'ORAI',    coingeckoId: 'oraichain-token',         decimals: 6,  nativeDenom: 'orai' },
  { symbol: 'UMEE',    coingeckoId: 'umee',                    decimals: 6,  nativeDenom: 'uumee' },
  { symbol: 'CRO',     coingeckoId: 'crypto-com-chain',        decimals: 8,  nativeDenom: 'basecro' },
  { symbol: 'FET',     coingeckoId: 'fetch-ai',                decimals: 18, nativeDenom: 'afet' },
  { symbol: 'BBN',     coingeckoId: 'babylon',                 decimals: 6,  nativeDenom: 'ubbn' },
  { symbol: 'ELYS',    coingeckoId: 'elys-network',            decimals: 6,  nativeDenom: 'uelys' },
  { symbol: 'AUTO',    coingeckoId: 'auto-2',                  decimals: 6,  nativeDenom: 'factory:kujira13x2l25mpkhwnwcwdzzd34cr8fyht9jlj7xu9g4uffe36g3fmln8qkvm3qn:uauto' },
  { symbol: 'MNTA',    coingeckoId: 'mantadao',                decimals: 6,  nativeDenom: 'factory:kujira1643jxg8wasy5cfcn7xm8rd742yeazcksqlg4d7:umnta' },
  { symbol: 'NAMI',    coingeckoId: 'nami-protocol',           decimals: 6,  nativeDenom: 'factory:kujira13x2l25mpkhwnwcwdzzd34cr8fyht9jlj7xu9g4uffe36g3fmln8qkvm3qn:unami' },
  { symbol: 'FUZN',    coingeckoId: 'fuzion',                  decimals: 6,  nativeDenom: 'factory:kujira1sc6a0347cc5q3k890jj0pf3ylx2s38rh4sza4t:ufuzn' },
  { symbol: 'dATOM',   coingeckoId: 'drop-staked-atom',        decimals: 6,  nativeDenom: 'factory/neutron1k6hr0f83e7un2wjf29cspk7j69jrnskk65k3ek2nj9dztrlzpj6q00rtsa/udatom' },
  { symbol: 'milkTIA', coingeckoId: 'milkyway-staked-tia',     decimals: 6,  nativeDenom: 'factory/osmo1f5vfcph2dvfeqcqkhetwv75fda69z7e5c2dldm3kvgj23crkv6wqcn47a0/umilkTIA' },
  { symbol: 'stLUNA',  coingeckoId: 'stride-staked-luna',      decimals: 6,  nativeDenom: 'stuluna' },
  { symbol: 'stEVMOS', coingeckoId: 'stride-staked-evmos',     decimals: 18, nativeDenom: 'staevmos' },
  { symbol: 'stUMEE',  coingeckoId: 'stride-staked-umee',      decimals: 6,  nativeDenom: 'stuumee' },
  { symbol: 'ALLO',    coingeckoId: 'allora',                  decimals: 18, nativeDenom: 'uallo' },
  { symbol: 'NEWT',    coingeckoId: 'newton-protocol',         decimals: 18, nativeDenom: 'factory/neutron1p8d89wvxyjcnawmgw72klknr3lg9gwwl6ypxda/newt' },
  { symbol: 'SAUCE',   coingeckoId: 'saucerswap',              decimals: 6,  nativeDenom: 'factory/neutron133xakkrfksq39wxy575unve2nyehg5npx75nph/sauce' },
  { symbol: 'ROWAN',   coingeckoId: 'sifchain',                decimals: 18, nativeDenom: 'rowan' },
  { symbol: 'allXRP',  coingeckoId: 'ripple',                  decimals: 6,  nativeDenom: 'factory/osmo1qnglc04tmhg32uc4kxlxh55a5cmhj88cpa3rmtly484xqu82t79sfv94w0/alloyed/allXRP' },
  { symbol: 'AVAX',    coingeckoId: 'avalanche-2',             decimals: 18, nativeDenom: 'wavax-wei' },
  { symbol: 'USDY',    coingeckoId: 'ondo-us-dollar-yield',    decimals: 18, nativeDenom: 'ausdy' },
  { symbol: 'BLD',     coingeckoId: 'agoric',                  decimals: 6,  nativeDenom: 'ubld' },
  { symbol: 'stkATOM', coingeckoId: 'stkatom',                 decimals: 6,  nativeDenom: 'stk/uatom' },
];

type IbcChannelSeed = {
  channelIdSrc: string;
  portIdSrc: string;
  counterpartyChainId: string;
  counterpartyChainName: string;
  counterpartyChannelId?: string | null;
  counterpartyPortId?: string | null;
  clientId?: string | null;
  status?: string | null;
};

// Generated from cosmos/chain-registry `_IBC/*cosmoshub*.json` (mainnet only).
// One row per ICS-20 transfer channel on cosmoshub-4. `counterpartyChainName`
// is the registry slug (lowercase); UI is responsible for display formatting.
// Regenerate with `prisma/scripts/extract-ibc-channels.sh` (TODO) when the
// registry adds new pairs — never hand-edit individual rows.
const IBC_CHANNELS: IbcChannelSeed[] = [
  { channelIdSrc: "channel-457", portIdSrc: "transfer", counterpartyChainId: "acre_9052-1", counterpartyChainName: "acrechain", counterpartyChannelId: "channel-8", counterpartyPortId: "transfer", clientId: "07-tendermint-1002", status: "ACTIVE" },
  { channelIdSrc: "channel-405", portIdSrc: "transfer", counterpartyChainId: "agoric-3", counterpartyChainName: "agoric", counterpartyChannelId: "channel-5", counterpartyPortId: "transfer", clientId: "07-tendermint-927", status: "ACTIVE" },
  { channelIdSrc: "channel-567", portIdSrc: "transfer", counterpartyChainId: "aioz_168-1", counterpartyChainName: "aioz", counterpartyChannelId: "channel-0", counterpartyPortId: "transfer", clientId: "07-tendermint-1121", status: "ACTIVE" },
  { channelIdSrc: "channel-184", portIdSrc: "transfer", counterpartyChainId: "akashnet-2", counterpartyChainName: "akash", counterpartyChannelId: "channel-17", counterpartyPortId: "transfer", clientId: "07-tendermint-385", status: null },
  { channelIdSrc: "channel-1353", portIdSrc: "transfer", counterpartyChainId: "allora-mainnet-1", counterpartyChainName: "allora", counterpartyChannelId: "channel-2", counterpartyPortId: "transfer", clientId: "07-tendermint-1384", status: null },
  { channelIdSrc: "channel-623", portIdSrc: "transfer", counterpartyChainId: "archway-1", counterpartyChainName: "archway", counterpartyChannelId: "channel-0", counterpartyPortId: "transfer", clientId: "07-tendermint-1152", status: "ACTIVE" },
  { channelIdSrc: "channel-646", portIdSrc: "transfer", counterpartyChainId: "aura_6322-2", counterpartyChainName: "aura", counterpartyChannelId: "channel-6", counterpartyPortId: "transfer", clientId: "07-tendermint-1158", status: "ACTIVE" },
  { channelIdSrc: "channel-293", portIdSrc: "transfer", counterpartyChainId: "axelar-dojo-1", counterpartyChainName: "axelar", counterpartyChannelId: "channel-2", counterpartyPortId: "transfer", clientId: "07-tendermint-622", status: "ACTIVE" },
  { channelIdSrc: "channel-1341", portIdSrc: "transfer", counterpartyChainId: "bbn-1", counterpartyChainName: "babylon", counterpartyChannelId: "channel-0", counterpartyPortId: "transfer", clientId: "07-tendermint-1381", status: "ACTIVE" },
  { channelIdSrc: "channel-1420", portIdSrc: "transfer", counterpartyChainId: "bitbadges-1", counterpartyChainName: "bitbadges", counterpartyChannelId: "channel-3", counterpartyPortId: "transfer", clientId: "07-tendermint-1428", status: "ACTIVE" },
  { channelIdSrc: "channel-232", portIdSrc: "transfer", counterpartyChainId: "bitcanna-1", counterpartyChainName: "bitcanna", counterpartyChannelId: "channel-3", counterpartyPortId: "transfer", clientId: "07-tendermint-490", status: "ACTIVE" },
  { channelIdSrc: "channel-229", portIdSrc: "transfer", counterpartyChainId: "bitsong-2b", counterpartyChainName: "bitsong", counterpartyChannelId: "channel-1", counterpartyPortId: "transfer", clientId: "07-tendermint-481", status: "ACTIVE" },
  { channelIdSrc: "channel-1556", portIdSrc: "transfer", counterpartyChainId: "bitway-1", counterpartyChainName: "bitway", counterpartyChannelId: "channel-14", counterpartyPortId: "transfer", clientId: "07-tendermint-1440", status: "ACTIVE" },
  { channelIdSrc: "channel-341", portIdSrc: "transfer", counterpartyChainId: "bostrom", counterpartyChainName: "bostrom", counterpartyChannelId: "channel-8", counterpartyPortId: "transfer", clientId: "07-tendermint-764", status: "ACTIVE" },
  { channelIdSrc: "channel-358", portIdSrc: "transfer", counterpartyChainId: "canto_7700-1", counterpartyChainName: "canto", counterpartyChannelId: "channel-2", counterpartyPortId: "transfer", clientId: "07-tendermint-873", status: "ACTIVE" },
  { channelIdSrc: "channel-342", portIdSrc: "transfer", counterpartyChainId: "carbon-1", counterpartyChainName: "carbon", counterpartyChannelId: "channel-3", counterpartyPortId: "transfer", clientId: "07-tendermint-765", status: "ACTIVE" },
  { channelIdSrc: "channel-831", portIdSrc: "transfer", counterpartyChainId: "cifer-2", counterpartyChainName: "cifer", counterpartyChannelId: "channel-0", counterpartyPortId: "transfer", clientId: "07-tendermint-1301", status: "ACTIVE" },
  { channelIdSrc: "channel-617", portIdSrc: "transfer", counterpartyChainId: "centauri-1", counterpartyChainName: "composable", counterpartyChannelId: "channel-4", counterpartyPortId: "transfer", clientId: "07-tendermint-1150", status: "ACTIVE" },
  { channelIdSrc: "channel-660", portIdSrc: "transfer", counterpartyChainId: "coreum-mainnet-1", counterpartyChainName: "coreum", counterpartyChannelId: "channel-9", counterpartyPortId: "transfer", clientId: "07-tendermint-1162", status: "ACTIVE" },
  { channelIdSrc: "channel-326", portIdSrc: "transfer", counterpartyChainId: "crescent-1", counterpartyChainName: "crescent", counterpartyChannelId: "channel-1", counterpartyPortId: "transfer", clientId: "07-tendermint-724", status: "ACTIVE" },
  { channelIdSrc: "channel-187", portIdSrc: "transfer", counterpartyChainId: "crypto-org-chain-mainnet-1", counterpartyChainName: "cryptoorgchain", counterpartyChannelId: "channel-27", counterpartyPortId: "transfer", clientId: "07-tendermint-389", status: null },
  { channelIdSrc: "channel-1749", portIdSrc: "transfer", counterpartyChainId: "divine-1", counterpartyChainName: "divine", counterpartyChannelId: "channel-1", counterpartyPortId: "transfer", clientId: "07-tendermint-1469", status: "ACTIVE" },
  { channelIdSrc: "channel-750", portIdSrc: "transfer", counterpartyChainId: "vota-ash", counterpartyChainName: "doravota", counterpartyChannelId: "channel-4", counterpartyPortId: "transfer", clientId: "07-tendermint-1191", status: "ACTIVE" },
  { channelIdSrc: "channel-1560", portIdSrc: "transfer", counterpartyChainId: "dungeon-1", counterpartyChainName: "dungeon", counterpartyChannelId: "channel-5308", counterpartyPortId: "transfer", clientId: "07-tendermint-1441", status: "ACTIVE" },
  { channelIdSrc: "channel-1213", portIdSrc: "transfer", counterpartyChainId: "dungeon-1", counterpartyChainName: "dungeon1", counterpartyChannelId: "channel-3", counterpartyPortId: "transfer", clientId: "07-tendermint-1325", status: "INACTIVE" },
  { channelIdSrc: "channel-794", portIdSrc: "transfer", counterpartyChainId: "dymension_1100-1", counterpartyChainName: "dymension", counterpartyChannelId: "channel-1", counterpartyPortId: "transfer", clientId: "07-tendermint-1205", status: "ACTIVE" },
  { channelIdSrc: "channel-1266", portIdSrc: "transfer", counterpartyChainId: "elys-1", counterpartyChainName: "elys", counterpartyChannelId: "channel-1", counterpartyPortId: "transfer", clientId: "07-tendermint-1339", status: "ACTIVE" },
  { channelIdSrc: "channel-202", portIdSrc: "transfer", counterpartyChainId: "emoney-3", counterpartyChainName: "emoney", counterpartyChannelId: "channel-1", counterpartyPortId: "transfer", clientId: "07-tendermint-432", status: null },
  { channelIdSrc: "channel-621", portIdSrc: "transfer", counterpartyChainId: "empowerchain-1", counterpartyChainName: "empowerchain", counterpartyChannelId: "channel-0", counterpartyPortId: "transfer", clientId: "07-tendermint-1151", status: "ACTIVE" },
  { channelIdSrc: "channel-292", portIdSrc: "transfer", counterpartyChainId: "evmos_9001-2", counterpartyChainName: "evmos", counterpartyChannelId: "channel-3", counterpartyPortId: "transfer", clientId: "07-tendermint-620", status: "ACTIVE" },
  { channelIdSrc: "channel-585", portIdSrc: "transfer", counterpartyChainId: "fxcore", counterpartyChainName: "fxcore", counterpartyChannelId: "channel-10", counterpartyPortId: "transfer", clientId: "07-tendermint-1141", status: "ACTIVE" },
  { channelIdSrc: "channel-632", portIdSrc: "transfer", counterpartyChainId: "haqq_11235-1", counterpartyChainName: "haqq", counterpartyChannelId: "channel-3", counterpartyPortId: "transfer", clientId: "07-tendermint-1153", status: "ACTIVE" },
  { channelIdSrc: "channel-204", portIdSrc: "transfer", counterpartyChainId: "ixo-5", counterpartyChainName: "impacthub", counterpartyChannelId: "channel-1", counterpartyPortId: "transfer", clientId: "07-tendermint-434", status: null },
  { channelIdSrc: "channel-220", portIdSrc: "transfer", counterpartyChainId: "injective-1", counterpartyChainName: "injective", counterpartyChannelId: "channel-1", counterpartyPortId: "transfer", clientId: "07-tendermint-470", status: "ACTIVE" },
  { channelIdSrc: "channel-1492", portIdSrc: "transfer", counterpartyChainId: "intento-1", counterpartyChainName: "intento", counterpartyChannelId: "channel-1", counterpartyPortId: "transfer", clientId: "07-tendermint-1436", status: "ACTIVE" },
  { channelIdSrc: "channel-182", portIdSrc: "transfer", counterpartyChainId: "irishub-1", counterpartyChainName: "irisnet", counterpartyChannelId: "channel-12", counterpartyPortId: "transfer", clientId: "07-tendermint-384", status: null },
  { channelIdSrc: "channel-866", portIdSrc: "transfer", counterpartyChainId: "joltify_1729-1", counterpartyChainName: "joltify", counterpartyChannelId: "channel-2", counterpartyPortId: "transfer", clientId: "07-tendermint-1307", status: "ACTIVE" },
  { channelIdSrc: "channel-207", portIdSrc: "transfer", counterpartyChainId: "juno-1", counterpartyChainName: "juno", counterpartyChannelId: "channel-1", counterpartyPortId: "transfer", clientId: "07-tendermint-439", status: "ACTIVE" },
  { channelIdSrc: "channel-277", portIdSrc: "transfer", counterpartyChainId: "kava_2222-10", counterpartyChainName: "kava", counterpartyChannelId: "channel-0", counterpartyPortId: "transfer", clientId: "07-tendermint-557", status: "ACTIVE" },
  { channelIdSrc: "channel-223", portIdSrc: "transfer", counterpartyChainId: "kichain-2", counterpartyChainName: "kichain", counterpartyChannelId: "channel-1", counterpartyPortId: "transfer", clientId: "07-tendermint-475", status: "ACTIVE" },
  { channelIdSrc: "channel-1351", portIdSrc: "transfer", counterpartyChainId: "luwak-1", counterpartyChainName: "kopi", counterpartyChannelId: "channel-15", counterpartyPortId: "transfer", clientId: "07-tendermint-1382", status: "ACTIVE" },
  { channelIdSrc: "channel-343", portIdSrc: "transfer", counterpartyChainId: "kaiyo-1", counterpartyChainName: "kujira", counterpartyChannelId: "channel-0", counterpartyPortId: "transfer", clientId: "07-tendermint-769", status: "ACTIVE" },
  { channelIdSrc: "channel-969", portIdSrc: "transfer", counterpartyChainId: "lava-mainnet-1", counterpartyChainName: "lava", counterpartyChannelId: "channel-6", counterpartyPortId: "transfer", clientId: "07-tendermint-1318", status: "ACTIVE" },
  { channelIdSrc: "channel-217", portIdSrc: "transfer", counterpartyChainId: "likecoin-mainnet-2", counterpartyChainName: "likecoin", counterpartyChannelId: "channel-5", counterpartyPortId: "transfer", clientId: "07-tendermint-468", status: null },
  { channelIdSrc: "channel-1340", portIdSrc: "transfer", counterpartyChainId: "ledger-mainnet-1", counterpartyChainName: "lombardledger", counterpartyChannelId: "channel-0", counterpartyPortId: "transfer", clientId: "07-tendermint-1380", status: null },
  { channelIdSrc: "channel-566", portIdSrc: "transfer", counterpartyChainId: "lum-network-1", counterpartyChainName: "lumnetwork", counterpartyChannelId: "channel-12", counterpartyPortId: "transfer", clientId: "07-tendermint-1120", status: "ACTIVE" },
  { channelIdSrc: "channel-1252", portIdSrc: "transfer", counterpartyChainId: "mantra-1", counterpartyChainName: "mantrachain", counterpartyChannelId: "channel-3", counterpartyPortId: "transfer", clientId: "07-tendermint-1331", status: "ACTIVE" },
  { channelIdSrc: "channel-1317", portIdSrc: "transfer", counterpartyChainId: "namada.5f5de2dd1b88cba30586420", counterpartyChainName: "namada", counterpartyChannelId: "channel-2", counterpartyPortId: "transfer", clientId: "07-tendermint-1351", status: null },
  { channelIdSrc: "channel-569", portIdSrc: "transfer", counterpartyChainId: "neutron-1", counterpartyChainName: "neutron", counterpartyChannelId: "channel-1", counterpartyPortId: "transfer", clientId: "07-tendermint-1119", status: "ACTIVE" },
  { channelIdSrc: "channel-536", portIdSrc: "transfer", counterpartyChainId: "noble-1", counterpartyChainName: "noble", counterpartyChannelId: "channel-4", counterpartyPortId: "transfer", clientId: "07-tendermint-1116", status: "ACTIVE" },
  { channelIdSrc: "channel-306", portIdSrc: "transfer", counterpartyChainId: "omniflixhub-1", counterpartyChainName: "omniflixhub", counterpartyChannelId: "channel-12", counterpartyPortId: "transfer", clientId: "07-tendermint-656", status: "ACTIVE" },
  { channelIdSrc: "channel-301", portIdSrc: "transfer", counterpartyChainId: "Oraichain", counterpartyChainName: "oraichain", counterpartyChannelId: "channel-15", counterpartyPortId: "transfer", clientId: "07-tendermint-651", status: "ACTIVE" },
  { channelIdSrc: "channel-141", portIdSrc: "transfer", counterpartyChainId: "osmosis-1", counterpartyChainName: "osmosis", counterpartyChannelId: "channel-0", counterpartyPortId: "transfer", clientId: "07-tendermint-259", status: "ACTIVE" },
  { channelIdSrc: "channel-1566", portIdSrc: "transfer", counterpartyChainId: "paxi-mainnet", counterpartyChainName: "paxi", counterpartyChannelId: "channel-1", counterpartyPortId: "transfer", clientId: "07-tendermint-1442", status: "ACTIVE" },
  { channelIdSrc: "channel-190", portIdSrc: "transfer", counterpartyChainId: "core-1", counterpartyChainName: "persistence", counterpartyChannelId: "channel-24", counterpartyPortId: "transfer", clientId: "07-tendermint-391", status: null },
  { channelIdSrc: "channel-446", portIdSrc: "transfer", counterpartyChainId: "planq_7070-2", counterpartyChainName: "planq", counterpartyChannelId: "channel-2", counterpartyPortId: "transfer", clientId: "07-tendermint-994", status: "ACTIVE" },
  { channelIdSrc: "channel-404", portIdSrc: "transfer", counterpartyChainId: "point_10687-1", counterpartyChainName: "point", counterpartyChannelId: "channel-0", counterpartyPortId: "transfer", clientId: "07-tendermint-926", status: "ACTIVE" },
  { channelIdSrc: "channel-859", portIdSrc: "transfer", counterpartyChainId: "pryzm-1", counterpartyChainName: "pryzm", counterpartyChannelId: "channel-0", counterpartyPortId: "transfer", clientId: "07-tendermint-1304", status: "ACTIVE" },
  { channelIdSrc: "channel-467", portIdSrc: "transfer", counterpartyChainId: "quicksilver-2", counterpartyChainName: "quicksilver", counterpartyChannelId: "channel-1", counterpartyPortId: "transfer", clientId: "07-tendermint-1018", status: "ACTIVE" },
  { channelIdSrc: "channel-645", portIdSrc: "transfer", counterpartyChainId: "realionetwork_3301-1", counterpartyChainName: "realio", counterpartyChannelId: "channel-2", counterpartyPortId: "transfer", clientId: "07-tendermint-1157", status: "ACTIVE" },
  { channelIdSrc: "channel-185", portIdSrc: "transfer", counterpartyChainId: "regen-1", counterpartyChainName: "regen", counterpartyChannelId: "channel-11", counterpartyPortId: "transfer", clientId: "07-tendermint-386", status: null },
  { channelIdSrc: "channel-235", portIdSrc: "transfer", counterpartyChainId: "secret-4", counterpartyChainName: "secretnetwork", counterpartyChannelId: "channel-0", counterpartyPortId: "transfer", clientId: "07-tendermint-492", status: "ACTIVE" },
  { channelIdSrc: "channel-1337", portIdSrc: "transfer", counterpartyChainId: "seda-1", counterpartyChainName: "seda", counterpartyChannelId: "channel-1", counterpartyPortId: "transfer", clientId: "07-tendermint-1372", status: null },
  { channelIdSrc: "channel-584", portIdSrc: "transfer", counterpartyChainId: "pacific-1", counterpartyChainName: "sei", counterpartyChannelId: "channel-1", counterpartyPortId: "transfer", clientId: "07-tendermint-1140", status: "ACTIVE" },
  { channelIdSrc: "channel-892", portIdSrc: "transfer", counterpartyChainId: "self-1", counterpartyChainName: "self", counterpartyChannelId: "channel-0", counterpartyPortId: "transfer", clientId: "07-tendermint-1310", status: "ACTIVE" },
  { channelIdSrc: "channel-186", portIdSrc: "transfer", counterpartyChainId: "sentinelhub-2", counterpartyChainName: "sentinel", counterpartyChannelId: "channel-12", counterpartyPortId: "transfer", clientId: "07-tendermint-388", status: "ACTIVE" },
  { channelIdSrc: "channel-1549", portIdSrc: "transfer", counterpartyChainId: "sentinelhub-2", counterpartyChainName: "sentinel", counterpartyChannelId: "channel-97", counterpartyPortId: "transfer", clientId: "07-tendermint-388", status: "ACTIVE" },
  { channelIdSrc: "channel-1352", portIdSrc: "transfer", counterpartyChainId: "sidechain-1", counterpartyChainName: "sidechain", counterpartyChannelId: "channel-10", counterpartyPortId: "transfer", clientId: "07-tendermint-1383", status: "ACTIVE" },
  { channelIdSrc: "channel-192", portIdSrc: "transfer", counterpartyChainId: "sifchain-1", counterpartyChainName: "sifchain", counterpartyChannelId: "channel-0", counterpartyPortId: "transfer", clientId: "07-tendermint-395", status: null },
  { channelIdSrc: "channel-369", portIdSrc: "transfer", counterpartyChainId: "stafihub-1", counterpartyChainName: "stafihub", counterpartyChannelId: "channel-0", counterpartyPortId: "transfer", clientId: "07-tendermint-892", status: "ACTIVE" },
  { channelIdSrc: "channel-730", portIdSrc: "transfer", counterpartyChainId: "stargaze-1", counterpartyChainName: "stargaze", counterpartyChannelId: "channel-239", counterpartyPortId: "transfer", clientId: "07-tendermint-1188", status: "ACTIVE" },
  { channelIdSrc: "channel-158", portIdSrc: "transfer", counterpartyChainId: "iov-mainnet-ibc", counterpartyChainName: "starname", counterpartyChannelId: "channel-0", counterpartyPortId: "transfer", clientId: "07-tendermint-326", status: null },
  { channelIdSrc: "channel-391", portIdSrc: "transfer", counterpartyChainId: "stride-1", counterpartyChainName: "stride", counterpartyChannelId: "channel-0", counterpartyPortId: "transfer", clientId: "07-tendermint-913", status: "ACTIVE" },
  { channelIdSrc: "channel-1421", portIdSrc: "transfer", counterpartyChainId: "sunrise-1", counterpartyChainName: "sunrise", counterpartyChannelId: "channel-1", counterpartyPortId: "transfer", clientId: "07-tendermint-1430", status: "ACTIVE" },
  { channelIdSrc: "channel-431", portIdSrc: "transfer", counterpartyChainId: "teritori-1", counterpartyChainName: "teritori", counterpartyChannelId: "channel-10", counterpartyPortId: "transfer", clientId: "07-tendermint-962", status: "ACTIVE" },
  { channelIdSrc: "channel-339", portIdSrc: "transfer", counterpartyChainId: "phoenix-1", counterpartyChainName: "terra2", counterpartyChannelId: "channel-0", counterpartyPortId: "transfer", clientId: "07-tendermint-760", status: "ACTIVE" },
  { channelIdSrc: "channel-288", portIdSrc: "transfer", counterpartyChainId: "umee-1", counterpartyChainName: "umee", counterpartyChannelId: "channel-1", counterpartyPortId: "transfer", clientId: "07-tendermint-611", status: null },
  { channelIdSrc: "channel-535", portIdSrc: "transfer", counterpartyChainId: "uptick_117-1", counterpartyChainName: "uptick", counterpartyChannelId: "channel-1", counterpartyPortId: "transfer", clientId: "07-tendermint-1115", status: null },
  { channelIdSrc: "channel-1377", portIdSrc: "transfer", counterpartyChainId: "xrplevm_1440000-1", counterpartyChainName: "xrplevm", counterpartyChannelId: "channel-2", counterpartyPortId: "transfer", clientId: "07-tendermint-1411", status: "ACTIVE" },
  { channelIdSrc: "channel-1555", portIdSrc: "transfer", counterpartyChainId: "zigchain-1", counterpartyChainName: "zigchain", counterpartyChannelId: "channel-4", counterpartyPortId: "transfer", clientId: "07-tendermint-1439", status: "ACTIVE" },
];

async function main() {
  for (const asset of ASSETS) {
    await db.asset.upsert({
      where: { nativeDenom: asset.nativeDenom },
      update: {
        symbol: asset.symbol,
        coingeckoId: asset.coingeckoId,
        decimals: asset.decimals,
      },
      create: asset,
    });
  }
  console.log(`seeded ${ASSETS.length} assets`);

  const seen = new Set<string>();
  let channelInserts = 0;
  for (const ch of IBC_CHANNELS) {
    const key = `${ch.channelIdSrc}|${ch.portIdSrc}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await db.ibcChannel.upsert({
      where: {
        channelIdSrc_portIdSrc: {
          channelIdSrc: ch.channelIdSrc,
          portIdSrc: ch.portIdSrc,
        },
      },
      update: {
        counterpartyChainId: ch.counterpartyChainId,
        counterpartyChainName: ch.counterpartyChainName,
        counterpartyChannelId: ch.counterpartyChannelId ?? null,
        counterpartyPortId: ch.counterpartyPortId ?? null,
        clientId: ch.clientId ?? null,
        status: ch.status ?? null,
      },
      create: {
        channelIdSrc: ch.channelIdSrc,
        portIdSrc: ch.portIdSrc,
        counterpartyChainId: ch.counterpartyChainId,
        counterpartyChainName: ch.counterpartyChainName,
        counterpartyChannelId: ch.counterpartyChannelId ?? null,
        counterpartyPortId: ch.counterpartyPortId ?? null,
        clientId: ch.clientId ?? null,
        status: ch.status ?? null,
      },
    });
    channelInserts += 1;
  }
  console.log(`seeded ${channelInserts} ibc channels`);
}

main()
  .then(async () => {
    await db.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await db.$disconnect();
    process.exit(1);
  });

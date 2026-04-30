# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build Commands

```bash
# CRITICAL: Always build packages before services
yarn build:packages

# Build all packages and services in parallel
yarn build

# Build with strict dependency order (slower but safer)
yarn build-all-slow

# Build specific service (packages must be built first)
cd services/{service} && yarn build
```

**CRITICAL BUILD RULE**: Services depend on compiled packages. Always run `yarn build:packages` before building or running services. The build system uses `--topological-dev` to respect dependencies.

### Testing and Linting

```bash
# Run all tests across workspaces
yarn test

# Lint all code
yarn lint

# Lint only shared packages
yarn lint:packages

# Service-specific testing
cd services/{service}
yarn test              # Run once
yarn test:watch        # Watch mode
yarn test:coverage     # With coverage

# Run single test file
cd services/{service}
vitest run tests/unit/specific-file.test.ts
```

### Local Development Setup

```bash
# Terminal 1: Start local Kubernetes cluster with all services
minikube start --kubernetes-version=v1.25.3 --cpus max --memory max
skaffold run -f k8s/local/skaffold.default.yaml

# Terminal 2: Set up port forwarding (will ask for password)
./scripts/miscellaneous.sh

# Access points:
# - Explorer UI: http://sandbox.chicmoz.localhost
# - API: http://api.sandbox.chicmoz.localhost
# - API Index: http://api.sandbox.chicmoz.localhost/v1/dev-api-key/l2/index
```

### Alternative Development Workflows

```bash
# Backend services only (faster frontend development)
skaffold run -f k8s/local/skaffold.no_ui.yaml

# Then run UI locally with hot reload:
yarn build:packages
cd services/explorer-ui
yarn && yarn build && yarn dev

# Deploy individual services
skaffold run -f k8s/local/skaffold.only_aztec-listener.yaml

# Full stack with monitoring tools (Grafana, Kafka UI)
skaffold run -f k8s/local/skaffold.deluxe.yaml
```

### Database Migration Workflow

```bash
# 1. Modify schema in src/svcs/database/schema.ts or schema/
# 2. Build the service (REQUIRED - drizzle reads built JS)
cd services/{service}
yarn build

# 3. Generate migration SQL
L2_NETWORK_ID=SANDBOX yarn generate

# 4. Apply migration to database
yarn migrate
```

## Architecture Overview

Chicmoz is an **event-driven microservices architecture** for indexing the Aztec L2 blockchain and its Ethereum L1 settlement layer.

### Core Data Flow

```
Blockchain Sources → Listeners → Kafka Topics → Processors → PostgreSQL
                                       ↓
                                  WebSocket Publisher → UI Clients
                                       ↓
                                  Explorer API → REST Clients
```

**Key Architectural Principles**:

1. **Single Writer Pattern**: Only `explorer-api` writes to the main blockchain database (prevents conflicts)
2. **Event Sourcing**: All state changes flow through Kafka (enables replay and audit)
3. **Service Isolation**: Each service has its own database for service-specific state
4. **Decoupled Services**: Services communicate only through Kafka, never direct calls

### Service Responsibilities

- **aztec-listener**: Polls Aztec L2 nodes for blocks, transactions, chain info; publishes events to Kafka
- **ethereum-listener**: Monitors Ethereum L1 rollup contracts; publishes L1 events to Kafka
- **explorer-api**: Consumes all Kafka events; stores blockchain data in PostgreSQL; exposes REST API
- **websocket-event-publisher**: Forwards Kafka events to WebSocket clients for real-time UI updates
- **explorer-ui**: React frontend with REST API + WebSocket integration
- **event-cannon**: Testing utility for generating blockchain activity
- **auth**: JWT authentication service with rate limiting

### Technology Stack

- **Backend**: Node.js 18+, TypeScript 5.8, Express.js, PostgreSQL 14+, Drizzle ORM, Kafka 3.0+
- **Frontend**: React 18, Vite, TanStack Query/Router, Tailwind CSS, Radix UI
- **Blockchain**: @aztec/aztec.js 2.1.2, viem 2.37.9
- **Infrastructure**: Docker, Kubernetes, Skaffold, Grafana

## Shared Packages Architecture

The project uses **yarn workspaces** with shared packages using the `@chicmoz-pkg/` namespace.

### Package Dependency Layers

```
Foundation Layer (no dependencies):
  @chicmoz-pkg/types              # Shared TypeScript types and Zod schemas
  @chicmoz-pkg/logger-server      # Structured logging utilities

Infrastructure Layer:
  @chicmoz-pkg/microservice-base  # Service lifecycle management
  @chicmoz-pkg/message-registry   # Kafka event schemas and topic definitions

Integration Layer:
  @chicmoz-pkg/message-bus        # Kafka producer/consumer abstractions
  @chicmoz-pkg/postgres-helper    # Database utilities and connection pooling
  @chicmoz-pkg/redis-helper       # Redis client and caching helpers
  @chicmoz-pkg/backend-utils      # Shared backend utility functions
  @chicmoz-pkg/contract-verification  # Smart contract verification
  @chicmoz-pkg/error-middleware   # Centralized error handling
  @chicmoz-pkg/auth0-middleware   # Auth0 authentication middleware
```

**Package Naming Convention**:

- Packages: `@chicmoz-pkg/*` (workspace packages)
- Services: `@chicmoz/*` (deployable services)

**CRITICAL**: The `build:packages` script uses `--topological-dev` flag to build packages in dependency order. Services will fail to compile if packages aren't built first.

## Service Structure Pattern

All backend services follow a consistent directory structure:

```
services/{service}/
├── src/
│   ├── index.ts              # Service entry point
│   ├── environment.ts        # Environment variable configuration
│   ├── svcs/                 # Core service implementations
│   │   ├── database/         # Database access layer
│   │   │   ├── schema.ts or schema/  # Drizzle schema definitions
│   │   │   ├── controllers/  # Database controllers by entity
│   │   │   │   └── {entity}/
│   │   │   │       ├── index.ts      # Exports all functions
│   │   │   │       ├── get-{entity}.ts
│   │   │   │       ├── store.ts
│   │   │   │       └── delete.ts
│   │   │   └── index.ts
│   │   ├── message-bus/      # Kafka setup and configuration
│   │   ├── http-server/      # Express routes (for API services)
│   │   └── poller/           # Blockchain polling (for listeners)
│   ├── events/
│   │   ├── emitted/          # Events this service publishes
│   │   └── received/         # Event handlers this service consumes
│   ├── utils/                # Service-specific utilities
│   └── constants/            # Service constants
├── migrations/               # Drizzle-generated SQL migrations
├── tests/                    # Vitest test files
├── scripts/                  # Utility scripts (e.g., migrate.js)
├── drizzle.config.js         # Drizzle configuration
├── package.json
└── tsconfig.json
```

## Code Style Guidelines

### TypeScript Configuration

**CRITICAL**: All services use ES modules with NodeNext resolution.

```typescript
// CORRECT - always use .js extensions in imports
import { logger } from "./logger.js";
import { controllers } from "../svcs/database/index.js";

// WRONG - will fail at runtime
import { logger } from "./logger";
```

**Why**: NodeNext module resolution requires import paths to include extensions. TypeScript compiles `.ts` → `.js` but doesn't rewrite import paths.

### ESLint Rules (Architectural)

- **`import/no-default-export`**: NO default exports - use named exports only
- **`import/no-cycle`**: Prevents circular dependencies
- **`no-console`**: Use structured logging (`logger.info()`) instead of `console.log()`
- **`no-param-reassign`**: Prevents mutation bugs
- **`curly`**: Always use braces for control statements

### Code Style

- **Types**: Prefer `type` over `interface`, use strict TypeScript
- **Naming**: camelCase for variables/functions, PascalCase for types/classes
- **Formatting**: Prettier with organize-imports plugin
- **Database**: Use Drizzle ORM with type-safe queries
- **Testing**: Vitest with globals enabled

## Event-Driven Communication

### Message Registry Pattern

**Location**: `packages/message-registry/src/`

Events are defined with type-safe schemas and topic generation:

```typescript
import {
  generateL2TopicName,
  getConsumerGroupId,
} from "@chicmoz-pkg/message-registry";

// Topic names include network ID for multi-environment support
// Format: ${L2_NETWORK_ID}__${EVENT_NAME}
// Example: SANDBOX__NEW_BLOCK_EVENT

// Consumer groups include service + network + handler
// Format: ${SERVICE_NAME}_${NETWORK_ID}_${HANDLER_NAME}
// Example: explorer-api_SANDBOX_blockHandler
```

### Publishing Events (Listeners)

```typescript
import { publishMessage } from "@chicmoz-pkg/message-bus";
import { L2BlockEvent } from "@chicmoz-pkg/message-registry";

// Publish to Kafka (fire-and-forget)
await publishMessage("NEW_BLOCK_EVENT", {
  block: block.toString(),
  finalizationStatus: "L2_NODE_SEEN_PROPOSED",
  blockNumber: height,
});
```

**Location Example**: `services/aztec-listener/src/events/emitted/index.ts`

### Consuming Events (Explorer API)

```typescript
import { subscribeTo, EventHandler } from "@chicmoz-pkg/message-bus";
import {
  generateL2TopicName,
  getConsumerGroupId,
} from "@chicmoz-pkg/message-registry";

export const blockHandler: EventHandler = {
  groupId: getConsumerGroupId({
    serviceName: "explorer-api",
    networkId: L2_NETWORK_ID,
    handlerName: "blockHandler", // MUST be unique per handler
  }),
  topic: generateL2TopicName(L2_NETWORK_ID, "NEW_BLOCK_EVENT"),
  cb: onBlock as (arg0: unknown) => Promise<void>,
};

// Subscribe all handlers on service startup
export const subscribeHandlers = async () => {
  await Promise.all([
    startSubscribe(blockHandler),
    startSubscribe(catchupHandler),
    // ... all other handlers
  ]);
};
```

**Location Example**: `services/explorer-api/src/events/received/index.ts`

**CRITICAL**: Consumer group IDs must be unique per service/handler combination to prevent message stealing.

## Database Patterns

### Database Distribution

Each service with persistent state has its own PostgreSQL database:

- **aztec-listener**: Tracks processing heights, pending transactions
- **ethereum-listener**: Tracks L1 heights, contract addresses
- **explorer-api**: Main blockchain data (blocks, transactions, contracts)

**No cross-service database access** - services communicate only through Kafka.

### Schema Management with Drizzle

```bash
# Drizzle configuration points to BUILT JavaScript
# drizzle.config.js:
schema: "./build/src/svcs/database/schema.js"
# or for multiple files:
schema: "./build/src/svcs/database/schema/**/*.js"
```

**Migration Generation**:

```bash
# 1. MUST build first (Drizzle reads compiled JS)
yarn build

# 2. Generate migration SQL
L2_NETWORK_ID=SANDBOX yarn generate

# 3. Review generated SQL in migrations/
# 4. Apply migration
yarn migrate
```

### Type-Safe Database Access

```typescript
import { db } from "../database/index.js";
import { l2Block } from "../database/schema.js";
import { eq, and, isNull } from "drizzle-orm";

// Query example
const block = await db
  .select()
  .from(l2Block)
  .where(
    and(
      eq(l2Block.height, height),
      isNull(l2Block.orphan_timestamp), // Filter orphaned blocks
    ),
  )
  .limit(1);

// Insert with automatic type checking
await db.insert(l2Block).values({
  hash: blockHash,
  height: blockNumber,
  timestamp: new Date(),
  // TypeScript error if missing required fields
});
```

## Blockchain-Specific Patterns

### Aztec Block Finalization (Dual Stage)

**CRITICAL**: Aztec has TWO finalization stages on L2, separate from L1:

```typescript
enum ChicmozL2BlockFinalizationStatus {
  L2_NODE_SEEN_PROPOSED = 0, // Block proposed by sequencer
  L1_SEEN_PROPOSED = 1, // L1 transaction submitted
  L1_MINED_PROPOSED = 2, // L1 transaction mined
  L2_NODE_SEEN_PROVEN = 3, // Block with valid ZK proof
  L1_SEEN_PROVEN = 4, // L1 proof verification submitted
  L1_MINED_PROVEN = 5, // L1 proof verification finalized
}
```

**Block Polling Strategy**: `services/aztec-listener/src/svcs/poller/pollers/block_poller/index.ts`

The listener tracks BOTH proposed and proven heights separately:

```typescript
// Two independent polling loops
await getBlockNumber(); // Latest PROPOSED block
await getProvenBlockNumber(); // Latest PROVEN block

// Process proposed blocks first
while (processedProposedHeight < chainProposedHeight) {
  await pollProposedBlock(++processedProposedHeight);
}

// Then process proven blocks
while (processedProvenHeight < chainProvenHeight) {
  await pollProvenBlock(++processedProvenHeight);
}
```

**Polling Configuration**:

- `BLOCK_POLL_INTERVAL_MS`: 3000ms (main loop)
- `TX_POLL_INTERVAL_MS`: 4000ms (pending transactions)
- `CATCHUP_POLL_WAIT_TIME_MS`: 100ms (artificial delay during catchup)

### Chain Reorganization Handling

**CRITICAL**: Reorgs can happen on both L2 and L1. NEVER delete orphaned data.

**Detection**: `services/explorer-api/src/events/received/on-block/reorg-handler.ts`

```typescript
const detectReorg = async (parsedBlock: ChicmozL2Block): Promise<boolean> => {
  const existingBlock = await getBlock(parsedBlock.height, {
    rollupVersion: parsedBlock.header.globalVariables.version,
  });
  return !!(existingBlock && existingBlock.hash !== parsedBlock.hash);
};
```

**Handling Strategy**:

1. **Soft Delete**: Mark orphaned blocks with `orphan_timestamp` (don't delete)
2. **Hierarchical Tracking**: `orphan_hasOrphanedParent` distinguishes root vs children
3. **Transaction Preservation**: Extract txs from orphaned blocks → mark as `dropped`
4. **Atomic Operation**: Entire reorg in single database transaction

**Safe Query Pattern**:

```sql
-- ALWAYS filter out orphaned blocks
SELECT * FROM l2_blocks
WHERE height = ?
  AND orphan_timestamp IS NULL
  AND rollup_version = ?
```

### Pending Transaction Lifecycle

**States**: `pending` → `proposed` → `proven` (happy path)

- OR: `pending` → `suspected_dropped` → `dropped` (evicted from mempool)
- OR: `pending` → `suspected_dropped` → `proven` (false positive recovery)

**Dropped Transaction Detection**: `services/aztec-listener/src/svcs/poller/pollers/dropped-tx-verifier.ts`

```typescript
// Sophisticated verification to avoid false positives
// 1. Grace period: 5 minutes before marking as suspected_dropped
// 2. Lookback verification: Check last 10 proven blocks
// 3. Recovery: If tx appears in proven block, mark as proven (not dropped)

const DROPPED_TX_AGE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const DROPPED_TX_BLOCK_LOOKBACK = 10;
```

**Why Complex?**: Aztec nodes may temporarily lose track of pending txs during reorgs or network partitions.

### Contract Classes vs Instances

**CRITICAL DISTINCTION**: Aztec separates contract deployment into two stages:

1. **Contract Class** - Bytecode + verification keys (can be reused)

   - Schema: `contractClassId`, `packedBytecode`, `artifactHash`, `privateFunctionsRoot`
   - Parsed from: `ContractClassLogs` in `TxEffect`

2. **Contract Instance** - Deployed contract with unique address
   - Schema: `address`, `currentContractClassId`, `originalContractClassId`, `deployer`
   - Parsed from: `PrivateLogs` in `TxEffect`

**Example**: One TokenContract class → many token instances (USDC, DAI, etc.)

**Contract Upgrades**: `ContractInstanceUpdatedEvent` tracks when instance switches class

- Schema: `address`, `prevContractClassId`, `newContractClassId`, `timestampOfChange`

**Location**: `services/explorer-api/src/events/received/on-block/contracts.ts`

### Aztec.js Integration

**Node Pool Pattern**: `services/aztec-listener/src/svcs/poller/network-client/pool.ts`

```typescript
import { createAztecNodeClient, AztecNode } from "@aztec/aztec.js";

// Multi-node pool with automatic failover
const nodes = AZTEC_RPC_URLS.map((node) => ({
  name: node.name,
  url: node.url,
  instance: createAztecNodeClient(node.url),
}));

// Mark nodes offline on specific errors
// - "Service Unavailable"
// - ECONNREFUSED / ENOTFOUND
// Auto-reset pool every 60 minutes
```

**Key Methods**:

```typescript
await node.getBlockNumber(); // Latest proposed block height
await node.getProvenBlockNumber(); // Latest proven block height
await node.getBlock(height); // Fetch L2Block with full tx data
await node.getPendingTxs(); // Mempool transactions
await node.getNodeInfo(); // Chain metadata, rollup version, L1 addresses
```

### Ethereum L1 Integration (viem)

**Dual Transport Strategy**: `services/ethereum-listener/src/network-client/client/index.ts`

```typescript
import { createPublicClient, http, webSocket } from "viem";

// WebSocket for real-time event watching
publicWsClient = createPublicClient({
  chain,
  transport: webSocket(ETHEREUM_WS_RPC_URL),
});

// HTTP for historical queries and contract reads
publicHttpClient = createPublicClient({
  chain,
  transport: http(ETHEREUM_HTTP_RPC_URL),
});
```

**Monitored L1 Events**:

- `L2BlockProposed` - Block submitted to L1 rollup contract
- `L2ProofVerified` - ZK proof verified on L1
- `Deposit` / `WithdrawInitiated` / `WithdrawFinalized` - L1↔L2 bridging
- `Slashed` - Validator slashing events

**Event Watching Pattern**: `services/ethereum-listener/src/network-client/contracts/watch-events.ts`

```typescript
// Per-event height tracking in database
const { fromBlock } = await dbControllers.inMemoryHeightTracker({
  contractName: "rollup",
  contractAddress: contracts.rollup.address,
  eventName: "L2BlockProposed",
  isFinalized: false, // Watch from pending blocks
});

// CRITICAL: Always use "finalized" tag for historical queries
const logs = await client.getContractEvents({
  fromBlock,
  toBlock: "finalized", // Prevents L1 reorg cascades
  eventName: "L2BlockProposed",
});
```

## API Development

### API Structure

- Base URL: `/api/v1/{apiKey}/l2/{endpoint}`
- OpenAPI spec: `services/explorer-api/src/svcs/http-server/open-api-spec.ts`
- Request validation: `services/explorer-api/src/svcs/http-server/routes/paths_and_validation.ts`
- Controllers: `services/explorer-api/src/svcs/database/controllers/`

### Common Patterns

- **Pagination**: `?page=1&limit=10`
- **Sorting**: `?sort=asc|desc`
- **Filtering**: Service-specific query parameters
- **Authentication**: API key in URL path (all endpoints require key)
- **Rate Limiting**: Configured via `THROTTLE_LIMIT` and `THROTTLE_TTL` env vars

## Frontend Development

### Component Structure

```
src/components/
├── ui/              # Reusable UI primitives (Radix-based)
├── {feature}/       # Feature-specific components
└── data-table/      # Shared table components
```

### API Integration

- API clients: `src/api/`
- React Query hooks: `src/hooks/api/`
- WebSocket hooks: `src/hooks/websocket/`

### Routing

- **TanStack Router** with file-based routing in `src/routes/`
- Route tree auto-generated in `src/routeTree.gen.ts` (don't edit manually)

## Environment Configuration

### Network Types

- **SANDBOX**: Local development (Anvil L1, local Aztec node)
- **TESTNET**: Aztec testnet (Sepolia L1)
- **DEVNET**: Developer network
- **MAINNET**: Production (Ethereum mainnet L1)

### Key Environment Variables

**All Services**:

- `L2_NETWORK_ID`: Network identifier (SANDBOX, TESTNET, DEVNET, MAINNET) - REQUIRED

**Aztec Listener**:

- `AZTEC_RPC_URLS`: JSON array of Aztec node endpoints `[{"name":"node1","url":"http://..."}]`
- `BLOCK_POLL_INTERVAL_MS`: Polling interval (default: 3000)
- `AZTEC_LISTEN_FOR_PENDING_TXS`: Enable pending tx polling (default: true)

**Ethereum Listener**:

- `ETHEREUM_HTTP_RPC_URL`: HTTP RPC endpoint
- `ETHEREUM_WS_RPC_URL`: WebSocket RPC endpoint
- `ETHEREUM_ALCHEMY_HTTP_URL`: Optional backup provider

**Explorer API**:

- `API_KEYS`: Comma-separated list of valid API keys
- `THROTTLE_LIMIT` / `THROTTLE_TTL`: Rate limiting configuration

## Kubernetes Deployment

### Development

```
k8s/local/
├── common/              # Shared configs (namespace, base skaffold)
├── {service}/
│   ├── sandbox/
│   ├── testnet/
│   ├── remote_devnet/
│   └── local_devnet/
└── skaffold.*.yaml      # Deployment configurations
```

**Available Skaffold Configs**:

- `skaffold.default.yaml` - Full stack with UI
- `skaffold.sandbox_no_ui.yaml` - Backend only
- `skaffold.only_{service}.yaml` - Single service deployment
- `skaffold.deluxe.yaml` - Full stack + monitoring (Grafana, Kafka UI)

### Production

- Configurations: `k8s/production/`
- TLS: Managed with cert-manager
- Ingress: Per-environment routing

## Debugging and Monitoring

### Local Development

- **Kafka UI**: `http://kafka-ui.chicmoz.localhost` (with deluxe setup)
- **Grafana**: Dashboards in `k8s/local/grafana/dashboards/`
- **Service Logs**: `kubectl logs -f deployment/{service-name}`

### Health Checks

- Explorer API: `/health` - Overall system health
- Database: `aztec-chain-connection` table tracks last seen block
- Each service: Implements health check via `microservice-base`

### Prometheus Metrics & JSON Logs (production indexer)

Both indexer services in `docker-compose.indexer.yml` expose Prometheus metrics
and emit structured JSON logs. Full inventory and PromQL/LogQL examples are in
[`MONITORING.md`](MONITORING.md); collector configs in `docs/observability/`.

- Endpoints: `aztec-listener` → `127.0.0.1:8001/metrics` (loopback only),
  `explorer-api` → `:8000/metrics`. Both also serve `/health`.
- Metric prefixes: `aztec_listener_*` (block/RPC/Kafka pipeline) and
  `aztec_api_*` (HTTP + consumer). Process defaults from `prom-client`
  are also exported.
- Shared infra package: `@chicmoz-pkg/metrics-server`
  (`createRegistry`, `mountMetricsRoute`, `startNodeDefaultMetrics`,
  `startPgPoolSampler`). Re-use it for any new service that needs metrics.
- Per-service registries live in `services/<svc>/src/metrics/`. Hooks
  call typed observers from `registry.ts`.
- Logging contract: `LOG_FORMAT=json|pretty` on `@chicmoz-pkg/logger-server`.
  JSON shape is `{ts, level, label, message, metadata}` — the field name
  `label` is part of the contract (Loki pipelines parse on it). Compose
  defaults to `json`; local dev defaults to `pretty`.
- **Cardinality discipline**: only the labels listed in `MONITORING.md`
  are allowed (`route`, `method`, `status`, `topic`, `node`, `endpoint`,
  `phase`, `table`, `column`, `cache`). NEVER label by per-block /
  per-tx values (`height`, `hash`, `address`) — they explode Prometheus.
- Collectors run on the **host**, not in compose. Use either Grafana
  Alloy (recommended, see `docs/observability/alloy.river`) or classic
  Prometheus (`docs/observability/prometheus.yml`). Both files use env-var
  placeholders for endpoints/credentials — never hard-code secrets.

## Common Pitfalls and Gotchas

### 1. Build Order Violations

**WRONG**:

```bash
cd services/aztec-listener
yarn build  # FAILS - packages not built
```

**CORRECT**:

```bash
yarn build:packages  # Build packages first
cd services/aztec-listener
yarn build          # Now succeeds
```

### 2. Missing .js Import Extensions

**WRONG**:

```typescript
import { logger } from "./logger"; // Runtime error
```

**CORRECT**:

```typescript
import { logger } from "./logger.js"; // Works
```

### 3. Drizzle Schema Generation Without Build

**WRONG**:

```bash
yarn generate  # FAILS - schema not compiled
```

**CORRECT**:

```bash
yarn build     # Build TypeScript first
yarn generate  # Now works
```

### 4. Consumer Group ID Conflicts

**WRONG**: Same consumer group across handlers causes message stealing

**CORRECT**: Unique group per service + handler

```typescript
groupId: getConsumerGroupId({
  serviceName: "explorer-api", // UNIQUE per service
  networkId: L2_NETWORK_ID,
  handlerName: "blockHandler", // UNIQUE per handler
});
```

### 5. Using Default Exports

**WRONG**:

```typescript
export default function handler() {} // ESLint error
```

**CORRECT**:

```typescript
export const handler = () => {}; // Named export
```

### 6. Querying Without Orphan Filter

**WRONG**: May return reorg'd blocks

```sql
SELECT * FROM l2_blocks WHERE height = 123
```

**CORRECT**: Always filter orphaned blocks

```sql
SELECT * FROM l2_blocks
WHERE height = 123
  AND orphan_timestamp IS NULL
```

### 7. Using console.log for Logging

**WRONG**:

```typescript
console.log("Debug info"); // ESLint error
```

**CORRECT**:

```typescript
import { logger } from "./logger.js";
logger.info("Debug info"); // Structured logging
```

### 8. Deleting Orphaned Data

**WRONG**: Loses audit trail

```typescript
await db.delete(l2Block).where(eq(l2Block.hash, orphanedHash));
```

**CORRECT**: Soft delete with timestamp

```typescript
await db
  .update(l2Block)
  .set({
    orphan_timestamp: new Date(),
    orphan_hasOrphanedParent: false,
  })
  .where(eq(l2Block.hash, orphanedHash));
```

## Git Workflow

### PR Conventions

- **Title Format**: `<prefix>: <description>`
  - Prefix: `bug`, `hotfix`, `feat`, `ux`
  - Example: `feat: add network selector to header`
- **Description**: Concise, key points only
- **Important**: Do NOT write "generated with claude" in PR descriptions

## Critical Version Dependencies

| Component                 | Version | Notes                     |
| ------------------------- | ------- | ------------------------- |
| @aztec/aztec.js           | 2.1.2   | MUST match rollup version |
| @aztec/stdlib             | 2.1.2   | MUST match aztec.js       |
| @aztec/protocol-contracts | 2.1.2   | MUST match aztec.js       |
| viem                      | 2.37.9  | Ethereum client           |
| Node.js                   | 18+     | Required for ESM modules  |
| PostgreSQL                | 14+     | Drizzle ORM requirement   |
| Kafka                     | 3.0+    | Message bus               |

**CRITICAL**: When upgrading Aztec SDK, upgrade ALL `@aztec/*` packages in lockstep. Mixing versions causes runtime errors.

## Summary: Critical Points

1. **Build packages before services** - `yarn build:packages` is mandatory
2. **Use `.js` extensions** in TypeScript imports (ES modules requirement)
3. **Named exports only** - enforced by ESLint
4. **Build before schema generation** - Drizzle reads compiled JS
5. **Unique consumer group IDs** - per service + handler combination
6. **Single writer pattern** - only explorer-api writes blockchain data
7. **Never bypass Kafka** - all data flow goes through event bus
8. **Soft delete for reorgs** - mark with `orphan_timestamp`, never delete
9. **Filter orphaned blocks** - always use `orphan_timestamp IS NULL`
10. **Dual finalization stages** - track both proposed and proven heights

This architecture is battle-tested in production but has strict conventions that MUST be followed to avoid costly mistakes.

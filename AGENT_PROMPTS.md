# Agent Prompts: CDI Performance (Gemini 3.1 Pro / Claude Opus 4.6) (2026-03-14)

This repo contains a production performance investigation handoff in `HANDOFF.md`.
Use it as the baseline context for any agent you assign.

Below are two copy-paste prompts tuned for:
- Google Gemini 3 Pro (ideally via Google Antigravity / Gemini CLI style agentic workflows).
- Anthropic Claude Opus 4.6 (ideally via Claude Code or GitHub Copilot Agent mode in VS Code).

They are written to explicitly request:
- multi-step autonomous execution (agent mode),
- parallel sub-agents (agent teams),
- MCP tool connections where available (GitHub, Postgres, Docker, etc.),
- repo-specific “skills” / MCP helpers (DeepContext, Context7) if present,
- reproducible measurements, and
- a safe rollout plan.

---

## Prompt: Gemini 3.1 Pro (Antigravity / Gemini Agent)

```text
You are an autonomous coding agent running Gemini 3 Pro with full tool access (editor + terminal) and support for MCP servers and multi-agent/manager mode if available.

Repository: chain-data-indexer (Cosmos Chain Data Indexer).
Objective: Increase sustained indexing throughput when backfilling from height 9,000,000+ (non-empty blocks) while preserving correctness.

Ground truth context:
1) Read `HANDOFF.md` end-to-end first. Treat it as the current state.
2) Read repo agent guidance in `AGENTS.md` (skills/tools conventions).
3) Read `.env.production` and `docker-compose.prod.yaml`.
3) Inspect the Postgres sink implementation in `src/sink/postgres.ts`, partition logic in `src/db/partitions.ts`, and runner behavior in `src/runner/syncRange.ts` and `src/runner/follow.ts`.

Constraints:
- Do not “tune blindly”. Base decisions on measured bottlenecks from logs/metrics.
- Keep changes minimal, avoid unrelated refactors.
- Must provide a rollback plan and a verification plan.

Tooling requirements (use best available):
- Use multi-agent execution: create 3 parallel sub-agents and coordinate them:
  A) Profiling agent: reproduce throughput numbers, parse logs, attribute time to RPC vs decode vs DB flush.
  B) Postgres agent: propose DB-level changes (compose config, Postgres GUCs) for bulk ingest and validate they are safe.
  C) Code agent: propose code changes in sink/partition/flush path; add minimal instrumentation if needed.
- Use MCP servers if possible:
  - GitHub MCP: for opening an issue/PR, summarizing changes, and tracking checklists.
  - Postgres MCP (or direct psql): to capture `EXPLAIN`, `pg_stat_*`, WAL/checkpoint behavior.
  - Docker MCP (or direct docker compose): to restart services and collect logs.
- Use “skills” / doc MCP helpers if available in the environment:
  - DeepContext: `index_codebase`, `search_codebase` for semantic code search.
  - Context7: library/API docs lookups for `pg`, `undici`, `zod`, etc.

What to measure (must):
- From indexer logs: `sink/postgres flushed` (tookMs, partitionsMs, insertsMs, commitMs, rows.*) and runner `[timings]`.
- From Postgres: checkpoints frequency/duration, WAL generation, lock waits, autovacuum impact, `pg_stat_statements` top queries (if enabled).

What to deliver:
1) A short root-cause summary explaining the current ceiling (e.g. insertsMs vs partitionsMs vs RPC).
2) A prioritized set of changes:
   - “No code”: `.env.production` changes only.
   - “Compose/DB”: `docker-compose.prod.yaml` or Postgres GUC changes (include exact flags).
   - “Code”: minimal patch in TypeScript with rationale.
3) A step-by-step rollout plan on a server (commands to run, what success looks like, how to rollback).
4) Concrete acceptance criteria: sustained blk/s target, and what logs/metrics prove it.

Important details from previous investigation:
- Progress rate can look worse during long flush stalls; use flush stats, not just `[progress]`.
- Postgres sink has internal buffers beyond env-configurable `PG_BATCH_*`.
- `FOLLOW=true` triggers follow mode where concurrency clamps to 16.
- RPS caps throughput at roughly RPS/2 blk/s because each height needs `/block` + `/block_results`.

Start now:
- Create the 3 sub-agents, assign tasks, and begin by producing the measurement report.
```

---

## Prompt: Claude Opus 4.6 (Claude Code / VS Code Copilot Agent Mode)

```text
You are Claude Opus 4.6 in agent mode. You can edit files, run shell commands, and iterate until the goal is met. If available, use Agent Teams (parallel sub-agents) and MCP tools.

Repository: chain-data-indexer (Cosmos Chain Data Indexer).
Objective: Improve sustained indexing throughput when backfilling from height 9,000,000+ (non-empty blocks) without sacrificing correctness or operability.

First actions (mandatory):
1) Read `HANDOFF.md` carefully and treat it as authoritative history.
2) Read repo agent guidance in `AGENTS.md` (skills/tools conventions).
3) Open and understand:
   - `src/sink/postgres.ts` (flush path, buffering, partition ensuring, progress updates)
   - `src/db/partitions.ts` (partition creation; advisory lock; 1,000,000 step)
   - `src/runner/syncRange.ts` (in-order flush gating; timings)
   - `src/rpc/client.ts` (RPS token bucket, retries)
   - `.env.production`, `docker-compose.prod.yaml`, `docker-compose.yaml`

Work style:
- Use an explicit plan, then execute it.
- Prefer data-driven changes. Always show the measurement that justifies a change.
- Keep the patch small and reviewable.

Parallelism (required if supported):
- Spin up 3 sub-agents:
  A) “DB & WAL” agent: analyze Postgres as bulk-ingest target; propose safe GUC changes and validate risk.
  B) “Sink/Flush” agent: focus on Postgres sink code path; reduce flush cost; make thresholds configurable where needed.
  C) “Runner/RPC” agent: confirm RPC ceiling; ensure we are not throttled; verify follow-mode clamp; suggest safe concurrency/RPS strategy.

MCP tools (use if available):
- GitHub MCP: create/update an issue, draft PR description, keep a checklist of experiments and results.
- Postgres MCP (or direct psql): query `pg_stat_activity`, `pg_locks`, checkpoint stats, WAL stats, top insert statements.
- Docker MCP (or direct docker compose): restart services, capture logs for exact windows.
- DeepContext MCP: semantic code search for tuning hotspots and flush triggers.
- Context7 docs MCP: confirm best-practice usage for `pg` bulk inserts and `undici` configuration.

Concrete tasks to consider:
- Ensure partitions overhead: avoid unnecessary partition creation checks; minimize advisory lock contention.
- Insert path: reduce per-flush transaction overhead; consider COPY-based ingest, prepared statement reuse, or fewer statements per flush.
- Buffering/thresholds: expose env knobs for internal buffers (transfers/stake/wasm/gov) so flush size is predictable.
- Progress writes: confirm `upsertProgress` isn’t too frequent or serialized.
- Follow mode: optionally disable or separate follow from backfill to avoid concurrency clamp.

Deliverables:
1) A measurement report (before/after) using `sink/postgres flushed` and runner timings.
2) A patch that improves throughput for height 9,000,000+ backfill.
3) Updated `.env.production` recommendations (values + why).
4) A safe rollout + rollback procedure.

Do not stop at analysis. Implement and validate changes.
```

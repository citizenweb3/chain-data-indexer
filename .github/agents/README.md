# CDI Agent Roles

This folder defines workspace agents for performance work on the Chain Data Indexer.

Recommended usage order for the current goal of reaching more than 150 blocks/sec locally:

1. Start with `CDI Performance Coordinator` to split work and set acceptance criteria.
2. Use `CDI Benchmark Verifier` to define the benchmark window and collect the baseline.
3. Run `CDI DB Bulk Ingest Optimizer` and `CDI Sink Flush Engineer` on the current dominant bottleneck.
4. Use `CDI Runner RPC Profiler` only if timings suggest the ceiling is outside PostgreSQL.
5. Before rollout, run `CDI Performance Reviewer` to challenge the evidence and rollback plan.

Suggested acceptance path:

1. Local: sustain `>150 blk/s` on a non-empty block range with bottleneck breakdown captured from logs.
2. Remote server: repeat the same benchmark window, confirm DB tuning remains stable, and compare sustained median throughput rather than peak bursts.
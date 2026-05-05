# CLAUDE.md

Read `AGENTS.md` in the same directory before exploring code. Each subdir doc covers one slice; the root doc is the index.

## MCP tools (mandatory)

| Need | Tool |
|---|---|
| Find code by concept | `gitnexus_query({query})` |
| 360° on a symbol | `gitnexus_context({name})` |
| Blast radius before edit | `gitnexus_impact({target, direction:"upstream"})` |
| Pre-commit scope check | `gitnexus_detect_changes()` |
| Multi-file rename | `gitnexus_rename({symbol_name, new_name, dry_run:true})` |
| Semantic fuzzy search | `mcp__deepcontext__search_codebase` |
| Library docs | Context7 |
| Exact string | `grep` |

Rules:
- Run `gitnexus_impact` before editing any function/class.
- Run `gitnexus_detect_changes` before committing.
- After structural changes: `gitnexus analyze` (CLI) + `mcp__deepcontext__index_codebase`.
- `gitnexus` index name: `chain-data-indexer`.

## Project pointer

See root `AGENTS.md` for stack, dirs, env, commands, deploy.

## Module docs

| Path | Covers |
|---|---|
| `src/app/api/v1/AGENTS.md` | API routes, auth, contracts |
| `src/services/AGENTS.md` | Service layer (BigInt → string boundary) |
| `src/queries/AGENTS.md` | Postgres SQL via `postgres.js` |
| `src/schemas/AGENTS.md` | Zod request validation |
| `src/lib/AGENTS.md` | Auth + OpenAPI registry |

// Worker threads do not inherit `--import` ESM loaders from the parent
// (only CommonJS `-r` hooks propagate). Use tsx's programmatic API to load
// the .ts entrypoint with extension/path inference.
import { tsImport } from 'tsx/esm/api';

await tsImport('./task-worker.ts', import.meta.url);

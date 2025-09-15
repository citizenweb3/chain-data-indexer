// src/decode/txWorker.types.ts

export type InitMsg = {
  type: 'init';
  protoDir?: string;
};

export type DecodeMsg = {
  type: 'decode';
  id: number;
  txBase64: string;
};

export type InMsg = InitMsg | DecodeMsg;

export type ProgressMsg = {
  type: 'progress';
  loaded: number;
  total: number;
};

export type ReadyMsg = {
  type: 'ready';
  ok: boolean;
  detail?: string;
};

export type WorkerOk = {
  id: number;
  ok: true;
  decoded: unknown;
};

export type WorkerErr = {
  id: number;
  ok: false;
  error: string;
};

export type OutMsg = WorkerOk | WorkerErr | ProgressMsg | ReadyMsg;

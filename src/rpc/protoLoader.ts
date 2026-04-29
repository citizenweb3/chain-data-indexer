import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let cachedDefinition: grpc.GrpcObject | undefined;

function nested(root: grpc.GrpcObject, path: readonly string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (current && typeof current === 'object' && key in current) {
      return (current as Record<string, unknown>)[key];
    }
    throw new Error(`missing proto package path: ${path.join('.')}`);
  }, root);
}

export function loadMidenRpcProto(): grpc.GrpcObject {
  if (cachedDefinition) return cachedDefinition;

  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, '../..');
  const protoRoot = resolve(repoRoot, 'proto/proto');
  const rpcProto = resolve(protoRoot, 'rpc.proto');

  const packageDefinition = protoLoader.loadSync(rpcProto, {
    keepCase: false,
    longs: String,
    enums: String,
    bytes: Buffer,
    defaults: true,
    oneofs: true,
    includeDirs: [protoRoot],
  });

  cachedDefinition = grpc.loadPackageDefinition(packageDefinition);
  return cachedDefinition;
}

export function getApiServiceConstructor(): grpc.ServiceClientConstructor {
  const service = nested(loadMidenRpcProto(), ['rpc', 'Api']);
  if (typeof service !== 'function') {
    throw new Error('rpc.Api service constructor was not loaded from proto');
  }
  return service as grpc.ServiceClientConstructor;
}

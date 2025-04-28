// src/index.ts

export * from './types'
export { PipeHandler } from './core/PipeHandler';
export type { Transport } from './transports/Transport';
export { GrpcClientTransport } from './transports/GrpcClientTransport';
export { GrpcServerTransport } from './transports/GrpcServerTransport';

export type { SchemaRegistry } from './schema/SchemaRegistry'
export { createSchemaRegistry } from './schema/SchemaRegistry'

export type { GrpcPipeServerOptions } from './server/GrpcPipeServer';
export { GrpcPipeServer } from './server/GrpcPipeServer';
export type { GrpcPipeClientOptions } from './client/GrpcPipeClient';
export { GrpcPipeClient } from './client/GrpcPipeClient';
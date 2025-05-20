// src/schema/benchmarkRegistry.ts

import { createSchemaRegistry } from '@grpc-pipe/core';
import { Ping, Pong } from './benchmark';

// Client schema
export const benchmarkClientRegistry = createSchemaRegistry({
  send: {
    pong: Pong,
  },
  receive: {
    ping: Ping,
  },
});

// Server schema
export const benchmarkServerRegistry = createSchemaRegistry({
  send: {
    ping: Ping,
  },
  receive: {
    pong: Pong,
  },
});
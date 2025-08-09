// src/schema.ts

import { createSchemaRegistry } from '@grpc-pipe/core';
import { Ping, Pong } from './benchmark.js';

// Client schema
export const benchmarkClientRegistry = createSchemaRegistry({
  send: {
    ping: Ping,
  },
  receive: {
    pong: Pong,
  },
});

// Server schema
export const benchmarkServerRegistry = createSchemaRegistry({
  send: {
    pong: Pong,
  },
  receive: {
    ping: Ping,
  },
});
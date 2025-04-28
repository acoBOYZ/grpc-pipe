// src/schema/benchmarkRegistry.ts

import { createSchemaRegistry } from '../../../src';
import { Ping, Pong } from './benchmark';

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
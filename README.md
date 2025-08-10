# @grpc-pipe/core

> 🔥 A lightweight, ultra-fast, strongly-typed, multiplexed messaging system over gRPC.  
> Pairs perfectly with the Go implementation: https://github.com/acoBOYZ/grpc-pipe-go

- ✨ JSON fallback (no schema required)
- 🚀 Protobuf support (zero-copy encode/decode)
- 📦 Built-in snappy/gzip compression (opt-in)
- 🧠 Smart backpressure + optional app-level in-flight window
- 🔄 Auto-reconnect with exponential backoff
- ⚡ Fastq-based concurrent dispatch
- 🛠 Fully typed end-to-end (TS/ESM)
- 🤝 Interop with Go server/client

---

## Install

```bash
npm i @grpc-pipe/core @grpc-pipe/server @grpc-pipe/client
```
```bash
bun add @grpc-pipe/core @grpc-pipe/server @grpc-pipe/client
```

---

## Quick Start (Protobuf)

Below uses a schema registry for **type-safe** encode/decode. If you skip `schema`, it falls back to JSON automatically but still typed from protobuf.

### Server

```ts
import type { InferReceive, InferSend } from '@grpc-pipe/server';
import { GrpcPipeServer } from '@grpc-pipe/server';
import { createSchemaRegistry } from '@grpc-pipe/core';
import { Ping, Pong } from './genereted-proto-js';

// Server schema
const registry = createSchemaRegistry({
  send: {
    pong: Pong,
  },
  receive: {
    ping: Ping,
  },
});

type ServerSend = InferSend<typeof registry>;
type ServerReceive = InferReceive<typeof registry>;
type ServerContext = { clientId?: string };

const server = new GrpcPipeServer<ServerSend, ServerReceive, ServerContext>({
  host: '0.0.0.0',
  port: 50061,
  schema: registry,
  compression: { codec: 'snappy' }, // false | { codec: 'snappy' | 'gzip' } (true means 'snappy')
  maxInFlight: 128,
  releaseOn: ['ping'], // typed from registry
  serverOptions: {
    'grpc.keepalive_time_ms': 25_000,
    'grpc.keepalive_timeout_ms': 10_000,
    'grpc.keepalive_permit_without_calls': 1,
    'grpc.http2.min_time_between_pings_ms': 20_000,
    'grpc.http2.max_pings_without_data': 0,
    'grpc.max_send_message_length': 64 * 1024 * 1024,
    'grpc.max_receive_message_length': 64 * 1024 * 1024,
  },
  beforeConnect: ({ metadata }) => ({ // typed from registry
    clientId: String(metadata.get('clientId')) 
    }),
});

server.on('connection', (pipe) => {
  console.log('[SERVER] client connected', pipe.context);
  // all pipe callback keys and payload also typed from registry
  pipe.on('ping', (payload) => {
    pipe.post('pong', { message: payload.message });
  });
});

server.on('disconnected', console.warning);
server.on('error', console.error);
```

### Client

```ts
import type { InferReceive, InferSend } from '@grpc-pipe/server';
import { GrpcPipeClient } from '@grpc-pipe/server';
import { createSchemaRegistry } from '@grpc-pipe/core';
import { Ping, Pong } from './genereted-proto-js';

// Client schema
export const registry = createSchemaRegistry({
  send: {
    ping: Ping,
  },
  receive: {
    pong: Pong,
  },
});

type ClientSend = InferSend<typeof registry>;
type ClientReceive = InferReceive<typeof registry>;

const client = new GrpcPipeClient<ClientSend, ClientReceive>({
  address: 'localhost:50061',
  schema: registry,
  compression: { codec: 'snappy' }, // false | { codec: 'snappy' | 'gzip' } (true means 'snappy')
  reconnectDelayMs: 2000,
  maxInFlight: 128,
  releaseOn: ['pong'], // typed from registry
  channelOptions: {
    'grpc.keepalive_time_ms': 25_000,
    'grpc.keepalive_timeout_ms': 10_000,
    'grpc.keepalive_permit_without_calls': 1,
    'grpc.http2.min_time_between_pings_ms': 20_000,
    'grpc.http2.max_pings_without_data': 0,
    'grpc.max_send_message_length': 64 * 1024 * 1024,
    'grpc.max_receive_message_length': 64 * 1024 * 1024,
  },
  metadata: { clientId: 'client_ts:123' },
});

client.on('connected', (pipe) => {
  console.log('[CLIENT] connected; serialization:', pipe.serialization);
  // all pipe callback keys and payload also typed from registry
  pipe.on('pong', (data) => {
    console.log('got pong:', data);
  });
  pipe.post('ping', { message: 'Hello World!' });
});

client.on('disconnected', () => {
  console.log('[CLIENT] disconnected (will auto-reconnect)');
});

client.on('error', console.error);
```

---

## JSON Fallback (no schema)

```ts
/* GRPC SERVER */
// server types
interface ServerSend {
  pong: { message: UserProfile };
}
interface ServerReceive {
  ping: { message: UserProfile };
}

const server = new GrpcPipeServer<ServerSend, ServerReceive>({
  host: 'localhost',
  port: 50061,
});

// Track connected clients
const clients = new Set<any>();

// all pipe callback keys and payload also typed
server.on('connection', (pipe) => {
  console.log(`[SERVER ${port}] New client connected.`);
  clients.add(pipe);
  pipe.on('ping', (data) => {
    pipe.post('pong', { message: data.message });
  });
});

server.on('error', (err) => ...);

/* GRPC CLIENT */
// client types
interface ClientSend {
  ping: { message: UserProfile };
}
interface ClientReceive {
  pong: { message: UserProfile };
}

const client = new GrpcPipeClient<ClientSend, ClientReceive>({
  address: 'localhost:50061',
  reconnectDelayMs: 3_000,
});

// all pipe callback keys and payload also typed
client.on('connected', (pipe: PipeHandler<ClientSend, ClientReceive>) => {
  console.log(`[CLIENT] Connected to ${address}`);
  pipe.on('pong', (data) => {
    // incoming data 
});

client.on('disconnected', () => ...);

client.on('error', (err) => ...);
```

---

## Full Option Reference

**Client** (`GrpcPipeClientOptions<Send, Receive>`)

```ts
{
  address: string;
  schema?: SchemaRegistry<Send, Receive>;
  compression?: false | { codec: 'snappy' | 'gzip' };
  backpressureThresholdBytes?: number;
  heartbeat?: boolean | { intervalMs?: number };
  reconnectDelayMs?: number;
  metadata?: Record<string, string>;
  tls?: boolean | { rootCerts?: Buffer | string };
  channelOptions?: import('@grpc/grpc-js').ClientOptions;
  maxInFlight?: number;
  releaseOn?: (keyof Receive)[];
}
```

**Server** (`GrpcPipeServerOptions<Send, Receive, Ctx>`)

```ts
{
  host?: string;
  port: number;
  schema?: SchemaRegistry<Send, Receive>;
  compression?: false | { codec: 'snappy' | 'gzip' };
  backpressureThresholdBytes?: number;
  heartbeat?: boolean | { intervalMs?: number };
  serverOptions?: import('@grpc/grpc-js').ChannelOptions;
  beforeConnect?: (args: { metadata: import('@grpc/grpc-js').Metadata }) => Ctx | Promise<Ctx>;
  onConnect?: (pipe: PipeHandler<any, any>) => void | Promise<void>;
  maxInFlight?: number;
  releaseOn?: (keyof Receive)[];
  tls?: {
    cert: Buffer | string;
    key: Buffer | string;
  };
}
```

---

## Interop with Go

✅ TS ↔ TS  
✅ Go ↔ TS  
✅ Go ↔ Go  

- Go repo: https://github.com/acoBOYZ/grpc-pipe-go  

---

## Benchmarks (100k msgs, ~9 KB JSON payload)

> **Note:** All tests are **3 servers → 1 client**.  
> **Thpt\***: When Go is the client → throughput per server. When TS is the client → combined throughput from all servers.

---

### Protobuf (no compression)

| Servers→Client | Messages   | Min   | Avg        | Max     | Thpt*    |
|----------------|-----------:|------:|-----------:|--------:|---------:|
| Go→Go          | 3×33,333   | 0–1   | 6.86–7.74  | 28–31   | ~24.3k/s |
| Go→TS          | 99,999     | 21    | 2613       | 5192    | 19.2k/s  |
| TS→Go          | 3×33,333   | 1     | 71.5–82.6  | 101–123 | ~12.3k/s |
| TS→TS          | 99,999     | 25    | 2501       | 4931    | 20.2k/s  |

---

### JSON (GO↔GO)

| Servers→Client | Compression | Messages   | Min   | Avg    | Max       | Thpt*    |
|----------------|-------------|-----------:|------:|-------:|----------:|---------:|
| Go→Go          | none        | 3×33,333   | 0–3   | 50–62  | 142–169   | ~13.8k/s |
| Go→Go          | snappy      | 3×33,333   | 0     | 15–18  | 69–91     | ~13.3k/s |

---

### JSON (TS↔TS)

| Servers→Client | Compression | Messages   | Min   | Avg    | Max     | Thpt*   |
|----------------|-------------|-----------:|------:|-------:|--------:|--------:|
| TS→TS          | none        | 99,999     | 62    | 2626   | 5117    |  —      |
| TS→TS          | snappy      | 99,999     | 67    | 2574   | 4964    |  —      |

---

### JSON (TS↔GO)

| Servers→Client | Compression | Messages   | Min   | Avg    | Max       | Thpt*    |
|----------------|-------------|-----------:|------:|-------:|----------:|---------:|
| TS→Go          | snappy      | 3×33,333   | 2     | 70     | 100–118   | ~14.4k/s |
| TS→Go          | none        | 3×33,333   | 1     | 70     | 87        | ~13.3k/s |

---

### JSON (GO↔TS)

| Servers→Client | Compression | Messages   | Min   | Avg    | Max     | Thpt*   |
|----------------|-------------|-----------:|------:|-------:|--------:|--------:|
| Go→TS          | snappy      | 99,999     | 69    | 2592   | 5133    |  —      |
| Go→TS          | none        | 99,999     | 61    | 2370   | 4601    |  —      |

---

## Tips

- Prefer **Protobuf** in production.
- Use `compression: 'snappy'` for faster compression than gzip.
- Tune keepalive for your infra.
- Use `maxInFlight` + `releaseOn` to prevent overload selected typed data.
- You can use `metadata` do transfer jwt, cookies or any information you need from clients to your servers (json only)

---

## 📜 License
MIT — do whatever you want, but keep it fast ⚡
© ACO
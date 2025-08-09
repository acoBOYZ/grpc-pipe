# @grpc-pipe/core

> 🔥 A lightweight, ultra-fast, strongly-typed, multiplexed messaging system over gRPC.  
> Pairs perfectly with the Go implementation: https://github.com/acoBOYZ/grpc-pipe-go

- ✨ JSON fallback (no schema required)
- 🚀 Protobuf support (zero-copy encode/decode)
- 📦 Built-in gzip compression (opt-in)
- 🧠 Smart backpressure + optional app-level in-flight window
- 🔄 Auto-reconnect with exponential backoff
- ⚡ Fastq-based concurrent dispatch
- 🛠 Fully typed end-to-end (TS/ESM)
- 🤝 Interop with Go server/client

---

## Install

```bash
npm i @grpc-pipe/core
# or
bun add @grpc-pipe/core
```

---

## Quick Start (Protobuf)

Below uses a schema registry for **type-safe** encode/decode. If you skip `schema`, it falls back to JSON automatically.

### Server

```ts
import { GrpcPipeServer } from '@grpc-pipe/core';

// message contracts (server perspective: what it SENDS and RECEIVES)
interface ServerSend {
  pong: { message: string };
}
interface ServerReceive {
  ping: { message: string };
}

// OPTIONAL: supply a schema registry for protobuf
// import { createSchemaRegistry } from '@grpc-pipe/core';
// import { Ping, Pong } from './gen/your_pb.js';
// const benchmarkServerRegistry = createSchemaRegistry<ServerSend, ServerReceive>({
//   send:   { pong: Pong },
//   receive:{ ping: Ping },
// });

type ServerContext = { clientId?: string };

const server = new GrpcPipeServer<ServerSend, ServerReceive, ServerContext>({
  host: '0.0.0.0',
  port: 50061,

  // schema: benchmarkServerRegistry,   // ← enable for protobuf
  compression: false,

  // App-level in-flight window (throttles posts until 'releaseOn' arrives)
  maxInFlight: 128,
  releaseOn: ['ping'], // when a 'ping' arrives (server side), it releases one slot

  // Low-level gRPC server/channel tuning (grpc-js arg keys)
  serverOptions: {
    // Keepalive (relaxed; plays nice with TS/Go)
    'grpc.keepalive_time_ms': 25_000,
    'grpc.keepalive_timeout_ms': 10_000,
    'grpc.keepalive_permit_without_calls': 1,

    // HTTP/2 ping policy
    'grpc.http2.min_time_between_pings_ms': 20_000,
    'grpc.http2.max_pings_without_data': 0,

    // Big payloads
    'grpc.max_send_message_length': 64 * 1024 * 1024,
    'grpc.max_receive_message_length': 64 * 1024 * 1024,
  },

  // optional server-side hook: read client metadata and build a context object
  beforeConnect: ({ metadata }) => {
    return { clientId: String(metadata.get('clientId')) }; // attach to pipe.context
  },
});

server.on('connection', (pipe) => {
  console.log('[SERVER] client connected', pipe.context); // { clientId: 'client_ts:123' } if provided

  pipe.on('ping', (data) => {
    pipe.post('pong', { message: data.message });
  });
});

server.on('error', (err) => {
  console.error('[SERVER] error:', err);
});
```

### Client

```ts
import { GrpcPipeClient } from '@grpc-pipe/core';

// message contracts (client perspective)
interface ClientSend {  ping: { message: string } }
interface ClientReceive { pong: { message: string } }

// OPTIONAL: enable protobuf via registry
// import { createSchemaRegistry } from '@grpc-pipe/core';
// import { Ping, Pong } from './gen/your_pb.js';
// const benchmarkClientRegistry = createSchemaRegistry<ClientSend, ClientReceive>({
//   send:   { ping: Ping },
//   receive:{ pong: Pong },
// });

const address = 'localhost:50061';

const client = new GrpcPipeClient<ClientSend, ClientReceive>({
  address,
  // schema: benchmarkClientRegistry, // ← enable for protobuf
  compression: false,

  // Auto-reconnect
  reconnectDelayMs: 2000,

  // App-level in-flight window (don’t spam the server)
  maxInFlight: 128,
  releaseOn: ['pong'],

  // Channel (grpc-js) options
  channelOptions: {
    'grpc.keepalive_time_ms': 25_000,
    'grpc.keepalive_timeout_ms': 10_000,
    'grpc.keepalive_permit_without_calls': 1,
    'grpc.http2.min_time_between_pings_ms': 20_000,
    'grpc.http2.max_pings_without_data': 0,
    'grpc.max_send_message_length': 64 * 1024 * 1024,
    'grpc.max_receive_message_length': 64 * 1024 * 1024,
  },

  // Custom metadata (read by server in `beforeConnect`)
  metadata: {
    clientId: 'client_ts:123',
  },
});

client.on('connected', (pipe) => {
  console.log('[CLIENT] connected; serialization:', pipe.serialization);

  pipe.on('pong', (data) => {
    console.log('got pong:', data);
  });

  // send something
  pipe.post('ping', { message: 'Hello World!' });
});

client.on('disconnected', () => {
  console.log('[CLIENT] disconnected (will auto-reconnect)');
});

client.on('error', (err) => {
  console.error('[CLIENT] error:', err);
});
```

---

## JSON Fallback (no schema)

If you don’t provide `schema`, the pipe uses JSON encode/decode automatically:

```ts
const client = new GrpcPipeClient({
  address: 'localhost:50061',
  // no schema → JSON mode
});

const server = new GrpcPipeServer({
  port: 50061,
  // no schema → JSON mode
});
```

---

## Full Option Reference

### Client (`GrpcPipeClientOptions<Send, Receive>`)

```ts
{
  /** Target server, e.g. 'localhost:50061' */
  address: string;

  /** Protobuf registry (enables binary mode); omit for JSON fallback */
  schema?: SchemaRegistry<Send, Receive>;

  /** Enable gzip compression for outgoing messages (default: false) */
  compression?: boolean;

  /** Apply backpressure once underlying writable buffer passes this size (default: 5MB) */
  backpressureThresholdBytes?: number;

  /** Auto-heartbeat (boolean or { intervalMs }) — optional */
  heartbeat?: boolean | { intervalMs?: number };

  /** Reconnect base delay (ms) for exponential backoff (default: 2000) */
  reconnectDelayMs?: number;

  /** Custom metadata sent on connect (read on server via `beforeConnect`) */
  metadata?: Record<string, string>;

  /** TLS settings (optional): true for default creds, or { rootCerts } */
  tls?: boolean | { rootCerts?: Buffer | string };

  /** grpc-js channel options (keepalive, http2/ping, max msg size, etc.) */
  channelOptions?: import('@grpc/grpc-js').ClientOptions;

  /** App-level window: limit number of in-flight posts until specific acks arrive */
  maxInFlight?: number;              // e.g., 128
  releaseOn?: (keyof Receive)[];     // e.g., ['pong']
}
```

### Server (`GrpcPipeServerOptions<Send, Receive, Ctx>`)

```ts
{
  host?: string;           // default '0.0.0.0'
  port: number;

  /** Protobuf registry; omit for JSON fallback */
  schema?: SchemaRegistry<Send, Receive>;

  /** Enable gzip compression for outgoing messages (default: false) */
  compression?: boolean;

  /** Apply backpressure once underlying writable buffer passes this size (default: 5MB) */
  backpressureThresholdBytes?: number;

  /** Auto-heartbeat (boolean or { intervalMs }) — optional */
  heartbeat?: boolean | { intervalMs?: number };

  /** grpc-js Server options (keepalive/http2/max sizes) */
  serverOptions?: import('@grpc/grpc-js').ChannelOptions;

  /** Build a per-connection context object based on client metadata */
  beforeConnect?: (args: {
    metadata: import('@grpc/grpc-js').Metadata;
  }) => Ctx | Promise<Ctx>;

  /** App-level window: limit number of in-flight posts until specific acks arrive */
  maxInFlight?: number;               // e.g., 128
  releaseOn?: (keyof Receive)[];      // e.g., ['ping']
}
```

---

## Interop with Go (bi-directional)

- TS ↔ TS, TS ↔ Go, Go ↔ Go all work the same way.
- Go repo: https://github.com/acoBOYZ/grpc-pipe-go  
- TS repo (this): https://github.com/acoBOYZ/grpc-pipe

---

## Benchmarks (100k msgs, ~9KB JSON-equivalent payload, no compression)

### Protobuf

| Topology                                | Messages | Min (ms) | Avg (ms) | Max (ms) | Throughput |
|-----------------------------------------|---------:|---------:|---------:|---------:|-----------:|
| **3× Go servers → 1 Go client**         | 3×33,333 | 0–1      | 6.86–7.74| 28–31    | ~24.2–24.7k msg/s per server |
| **3× Go servers → 1 TS client**         | 99,999   | 21       | 2613     | 5192     | 19,186 msg/s |
| **3× TS servers → 1 Go client**         | 3×33,333 | 1        | 71.5–82.6| 101–123  | ~11.5–13.1k msg/s per server |
| **3× TS servers → 1 TS client**         | 99,999   | 23       | 2498     | 4949     | 20,108 msg/s |

### JSON (TS↔TS)

| Topology                        | Messages | Min (ms) | Avg (ms) | Max (ms) |
|--------------------------------|---------:|---------:|---------:|---------:|
| **3× TS servers → 1 TS client**| 99,999   | 62       | 2626     | 5117     |

> Notes  
> • Payload shape: user profile with nested settings/stats + 10 posts (IDs, titles, ~50× content repeats, tags, etc.).  
> • Numbers above reflect **end-to-end** latency including app work and gRPC-JS overhead. Go↔Go shows the upper bound of what the pipe can do on the same hardware.

---

## Tips

- **Prefer Protobuf** in production (lower CPU, bandwidth, and GC pressure).
- **Tune keepalive** (client & server options above) to your infra/LBs.
- For high-rate request/reply, set an **app-level window**:
  - Client: `maxInFlight: 128, releaseOn: ['pong']`
  - Server: `maxInFlight: 128, releaseOn: ['ping']`
- **Backpressure**: if you don’t use app windowing, the pipe will still pause when the transport’s writable buffer fills.
- **Debug logs**: if you wired the internal logger, enable with an env var (for example):  
  `GRPC_PIPE_DEBUG=pipe:* bun run dev`

---

## 📜 License
MIT — do whatever you want, but keep it fast ⚡
© ACO
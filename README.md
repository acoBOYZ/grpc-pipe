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

interface ServerSend { pong: { message: string } }
interface ServerReceive { ping: { message: string } }

// import { createSchemaRegistry } from '@grpc-pipe/core';
// import { Ping, Pong } from './gen/your_pb.js';
// const registry = createSchemaRegistry<ServerSend, ServerReceive>({
//   send:   { pong: Pong },
//   receive:{ ping: Ping },
// });

type ServerContext = { clientId?: string };

const server = new GrpcPipeServer<ServerSend, ServerReceive, ServerContext>({
  host: '0.0.0.0',
  port: 50061,
  // schema: registry,
  compression: { codec: 'snappy' }, // false | { codec: 'snappy' | 'gzip' } (true means 'snappy')
  maxInFlight: 128,
  releaseOn: ['ping'],
  serverOptions: {
    'grpc.keepalive_time_ms': 25_000,
    'grpc.keepalive_timeout_ms': 10_000,
    'grpc.keepalive_permit_without_calls': 1,
    'grpc.http2.min_time_between_pings_ms': 20_000,
    'grpc.http2.max_pings_without_data': 0,
    'grpc.max_send_message_length': 64 * 1024 * 1024,
    'grpc.max_receive_message_length': 64 * 1024 * 1024,
  },
  beforeConnect: ({ metadata }) => ({ clientId: String(metadata.get('clientId')) }),
});

server.on('connection', (pipe) => {
  console.log('[SERVER] client connected', pipe.context);
  pipe.on('ping', (data) => {
    pipe.post('pong', { message: data.message });
  });
});

server.on('error', console.error);
```

### Client

```ts
import { GrpcPipeClient } from '@grpc-pipe/core';

interface ClientSend { ping: { message: string } }
interface ClientReceive { pong: { message: string } }

// import { createSchemaRegistry } from '@grpc-pipe/core';
// import { Ping, Pong } from './gen/your_pb.js';
// const registry = createSchemaRegistry<ClientSend, ClientReceive>({
//   send:   { ping: Ping },
//   receive:{ pong: Pong },
// });

const client = new GrpcPipeClient<ClientSend, ClientReceive>({
  address: 'localhost:50061',
  // schema: registry,
  compression: { codec: 'snappy' }, // false | { codec: 'snappy' | 'gzip' } (true means 'snappy')
  reconnectDelayMs: 2000,
  maxInFlight: 128,
  releaseOn: ['pong'],
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
const client = new GrpcPipeClient({
  address: 'localhost:50061',
});

const server = new GrpcPipeServer({
  port: 50061,
});
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
  maxInFlight?: number;
  releaseOn?: (keyof Receive)[];
}
```

---

## Interop with Go

- TS ↔ TS, TS ↔ Go, Go ↔ Go all work the same way.
- Go repo: https://github.com/acoBOYZ/grpc-pipe-go  
- TS repo (this): https://github.com/acoBOYZ/grpc-pipe

---

## Benchmarks

### 3 TS servers → 1 TS client (protobuf no compress)
```
Messages sent: 99999
Messages received: 99999
Min latency: 25 ms
Avg latency: 2501.44 ms
Max latency: 4931 ms
Throughput: 20169 msg/s
```

### 3 TS servers → 1 TS client (protobuf gzip)
```
Messages sent: 99999
Messages received: 99999
Min latency: 28 ms
Avg latency: 3768.98 ms
Max latency: 7522 ms
Throughput: 13240 msg/s
```

### 3 TS servers → 1 TS client (protobuf snappy)
```
Messages sent: 99999
Messages received: 99999
Min latency: 22 ms
Avg latency: 2628.33 ms
Max latency: 5224 ms
Throughput: 19084 msg/s
```

---

## Tips

- Prefer **Protobuf** in production.
- Use `compression: 'snappy'` for faster compression than gzip.
- Tune keepalive for your infra.
- Use `maxInFlight` + `releaseOn` to prevent overload.
- You can use `metadata` do transfer jwt, cookies or any information you need from clients to your servers (json only)

---

## 📜 License
MIT — do whatever you want, but keep it fast ⚡
© ACO
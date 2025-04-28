# grpc-pipe

> 🔥 A lightweight, ultra-fast, strongly-typed, multiplexed messaging system over gRPC.

- ✨ JSON fallback automatically
- 🚀 Protobuf support for zero-overhead binary communication
- 📦 Built-in compression support (gzip)
- 🧠 Automatic backpressure handling
- ⚡ Fastq-based concurrency queue
- 🛠 Fully TypeScript typed, developer friendly
- 🔥 Tiny runtime overhead

---

## Install

```bash
npm install grpc-pipe
```

or

```bash
bun add grpc-pipe
```

---

## Quick Start

### Server

```ts
import { GrpcPipeServer } from 'grpc-pipe';

// Full type-safe server!
interface ServerSend {
  pong: { message: string };
}

interface ServerReceive {
  ping: { message: string };
}

const server = new GrpcPipeServer<ServerSend, ServerReceive>({
  port: 50051,
  compression: true,
});

server.on('connection', (pipe) => {
  console.log('New client connected.');

  pipe.on('ping', (data) => {
    pipe.post('pong', { message: data.message });
  });
});

server.on('error', (err) => {
  console.error('Server error:', err);
});
```

### Client

```ts
import { GrpcPipeClient } from 'grpc-pipe';

// Full type-safe client!
interface ClientSend {
  ping: { message: string };
}

interface ClientReceive {
  pong: { message: string };
}

const client = new GrpcPipeClient<ClientSend, ClientReceive>({
  address: 'localhost:50051',
  compression: true,
});

client.on('connected', (pipe) => {
  pipe.post('ping', { message: 'Hello World!' });

  pipe.on('pong', (data) => {
    console.log('Received pong:', data);
  });
});
```

---

## Features

- **JSON Fallback**: Works automatically if no schema is provided.
- **Protobuf Schema**: If you provide a `.proto` schema, zero-copy serialization is used.
- **Compression**: (gzip) reduces bandwidth usage for large messages.
- **Backpressure**: Automatically throttles sending if the internal gRPC buffer is full.
- **Reconnects**: Clients automatically reconnect on failure.
- **Strong Type Safety**: All messages are typed at compile-time. You cannot send or receive wrong structures.
- **Schema Inference**: Automatically infer types from your Protobuf schema when available.

---

## Options

| Option | Type | Default | Description |
|:------|:-----|:--------|:------------|
| `compression` | `boolean` | `false` | Enable gzip compression |
| `backpressureThresholdBytes` | `number` | `5 * 1024 * 1024` | Max pending bytes before throttling (5MB default) |
| `reconnectDelayMs` (client) | `number` | `2000` | Milliseconds before trying to reconnect |

---

## Benchmarks

✅ JSON vs Protobuf performance on big payloads:

| Method | Avg Latency (ms) |
|:------|:----------------|
| JSON | ~0.43 ms |
| Protobuf | ~0.41 ms |

✅ With compression: +1% latency only, for -60% bandwidth savings.

---

## License

MIT License
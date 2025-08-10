// for start bun --watch client.ts
// client.ts
import type { InferSend, InferReceive } from '@grpc-pipe/client';
import { GrpcPipeClient, PipeHandler } from '@grpc-pipe/client';
import { benchmarkClientRegistry } from './src/schema.js';

type ClientSend = InferSend<typeof benchmarkClientRegistry>;
type ClientReceive = InferReceive<typeof benchmarkClientRegistry>;

const serverAddresses = [
  'localhost:50061',
  'localhost:50062',
  'localhost:50063',
];

const connections = new Map<string, PipeHandler<ClientSend, ClientReceive>>();
const pending = new Map<string, number>();
const latencies: number[] = [];

const messagesPerClient = 333;
const totalMessagesToSend = messagesPerClient * serverAddresses.length;

let totalReceived = 0;
let startMs: number | null = null;

function nowMs() {
  return Date.now();
}

function connectToServer(address: string) {
  const client = new GrpcPipeClient<ClientSend, ClientReceive>({
    address,
    schema: benchmarkClientRegistry,
    reconnectDelayMs: 2000,
    compression: true,
    maxInFlight: 128,
    releaseOn: ['pong'],
    channelOptions: {
      'grpc.keepalive_time_ms': 25_000,      // >= server min_time_between_pings
      'grpc.keepalive_timeout_ms': 10_000,
      'grpc.keepalive_permit_without_calls': 1,
      'grpc.http2.min_time_between_pings_ms': 20_000,
      'grpc.http2.max_pings_without_data': 0,
    },
    metadata: {
      clientId: 'client_ts:123'
    },
  });

  client.on('connected', (pipe: PipeHandler<ClientSend, ClientReceive>) => {
    console.log(`[CLIENT] Connected to ${address}`);
    console.log(`[CLIENT] Serialization method '${pipe.serialization}'`);
    connections.set(address, pipe);

    pipe.on('pong', (data) => {
      const id = data.message?.id ?? "";
      const sentTime = pending.get(id);
      if (sentTime) {
        const elapsed = nowMs() - sentTime;
        latencies.push(elapsed);
        pending.delete(id);
      }

      totalReceived++;
      if (totalReceived === totalMessagesToSend) {
        printResults();
      }
    });

    startSending(address, pipe);
  });

  client.on('disconnected', () => {
    console.warn(`[CLIENT] Disconnected from ${address}`);
    connections.delete(address);
  });

  client.on('error', (err) => {
    console.error(`[CLIENT] Error with ${address}:`, err.message);
  });
}

function startSending(address: string, pipe: PipeHandler<ClientSend, ClientReceive>) {
  if (startMs === null) startMs = nowMs();

  for (let sent = 0; sent < messagesPerClient; sent++) {
    const id = `${address}-${sent}`;
    pending.set(id, nowMs());
    pipe.post('ping', { message: generateBigPayload(id) });
  }
}

function printResults() {
  console.log('\n[Benchmark Results for PROTOBUF method]');
  if (latencies.length === 0) {
    console.log('No latencies measured.');
    return;
  }

  const min = Math.min(...latencies);
  const max = Math.max(...latencies);
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

  const elapsedSec = (nowMs() - startMs!) / 1000;
  const throughput = elapsedSec > 0 ? totalMessagesToSend / elapsedSec : 0;

  console.log(`Messages sent: ${totalMessagesToSend}`);
  console.log(`Messages received: ${latencies.length}`);
  console.log(`Min latency: ${min} ms`);
  console.log(`Avg latency: ${avg.toFixed(2)} ms`);
  console.log(`Max latency: ${max} ms`);
  console.log(`Throughput: ${throughput.toFixed(0)} msg/s`);
}

for (const address of serverAddresses) {
  connectToServer(address);
}

// --- Helper: fake UserProfile generator
import { UserProfile } from '../json/data.js';

const staticUserPayload: Omit<UserProfile, 'id'> = {
  username: `user_name`,
  email: `user@example.com`,
  bio: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  settings: {
    theme: Math.random() > 0.5 ? "light" : "dark",
    notifications: {
      email: true,
      sms: false,
      push: true,
    },
  },
  stats: {
    posts: Math.floor(Math.random() * 1000),
    followers: Math.floor(Math.random() * 10000),
    following: Math.floor(Math.random() * 500),
    createdAt: new Date().toISOString(),
  },
  posts: Array.from({ length: 10 }, (_, i) => ({
    id: `post-${i}`,
    title: `Post Title ${i}`,
    content: "Content here...".repeat(50),
    likes: Math.floor(Math.random() * 500),
    tags: ["benchmark", "test", "data"],
  })),
}

function generateBigPayload(id: string): UserProfile {
  return {
    ...staticUserPayload,
    id,
  };
}
// for start bun --watch client.ts
// client.ts
import { GrpcPipeClient, PipeHandler } from '@grpc-pipe/client';
import { UserProfile } from './data.js';

interface ClientSend {
  ping: { message: UserProfile };
}

interface ClientReceive {
  pong: { message: UserProfile };
}

const serverAddresses = [
  'localhost:50061',
  'localhost:50062',
  'localhost:50063',
];

const connections = new Map<string, PipeHandler<ClientSend, ClientReceive>>();
const pending = new Map<string, number>();
const latencies: number[] = [];

const messagesPerClient = 33_333;
const totalMessagesToSend = messagesPerClient * serverAddresses.length;

let totalReceived = 0;

function nowMs() {
  return Date.now();
}

function connectToServer(address: string) {
  const client = new GrpcPipeClient<ClientSend, ClientReceive>({
    address,
    reconnectDelayMs: 2000,
    compression: false,
    maxInFlight: 128,
    releaseOn: ['pong'],
    channelOptions: {
      'grpc.keepalive_time_ms': 25_000,      // >= server min_time_between_pings
      'grpc.keepalive_timeout_ms': 10_000,
      'grpc.keepalive_permit_without_calls': 1,
      'grpc.http2.min_time_between_pings_ms': 20_000,
      'grpc.http2.max_pings_without_data': 0,
    },
  });

  client.on('connected', (pipe: PipeHandler<ClientSend, ClientReceive>) => {
    console.log(`[CLIENT] Connected to ${address}`);
    connections.set(address, pipe);

    pipe.on('pong', (data) => {
      const id = data.message.id;
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
  for (let sent = 0; sent < messagesPerClient; sent++) {
    const id = `${address}-${sent}`;
    pending.set(id, nowMs());
    pipe.post('ping', { message: generateBigPayload(id) });
  }
}

function printResults() {
  console.log('\n[Benchmark Results for JSON method]');
  if (latencies.length === 0) {
    console.log('No latencies measured.');
    return;
  }

  const min = Math.min(...latencies);
  const max = Math.max(...latencies);
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;

  console.log(`Messages sent: ${totalMessagesToSend}`);
  console.log(`Messages received: ${latencies.length}`);
  console.log(`Min latency: ${min} ms`);
  console.log(`Avg latency: ${avg.toFixed(2)} ms`);
  console.log(`Max latency: ${max} ms`);
}

for (const address of serverAddresses) {
  connectToServer(address);
}

function generateBigPayload(id: string): UserProfile {
  return {
    id,
    username: `user_${id}`,
    email: `user${id}@example.com`,
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
      id: `${id}-${i}`,
      title: `Post Title ${i}`,
      content: "Content here...".repeat(50),
      likes: Math.floor(Math.random() * 500),
      tags: ["benchmark", "test", "data"],
    })),
  };
}
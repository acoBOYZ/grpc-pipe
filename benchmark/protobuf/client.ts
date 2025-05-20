// for start bun --watch client.ts
import type { InferSend, InferReceive } from '@grpc-pipe/client';
import { GrpcPipeClient, PipeHandler } from '@grpc-pipe/client';
import { benchmarkClientRegistry } from './src/schema';

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

const messagesPerClient = 10_000;
const totalMessagesToSend = messagesPerClient * serverAddresses.length;

let totalReceived = 0;

function nowMs() {
  return Date.now();
}

function connectToServer(address: string) {
  const client = new GrpcPipeClient<ClientSend, ClientReceive>({
    address,
    reconnectDelayMs: 2000,
    compression: true,
  });

  client.on('connected', (pipe: PipeHandler<ClientSend, ClientReceive>) => {
    pipe.useSchema(benchmarkClientRegistry);

    console.log(`[CLIENT] Connected to ${address}`);
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
  let sent = 0;
  const interval = setInterval(() => {
    if (sent >= messagesPerClient) {
      clearInterval(interval);
      return;
    }

    const fakeUserProfile = generateBigPayload(`${address}-${sent}`);
    pending.set(fakeUserProfile.id, nowMs());
    pipe.post('ping', { message: fakeUserProfile });
    sent++;
  }, 0);
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

  console.log(`Messages sent: ${totalMessagesToSend}`);
  console.log(`Messages received: ${latencies.length}`);
  console.log(`Min latency: ${min} ms`);
  console.log(`Avg latency: ${avg.toFixed(2)} ms`);
  console.log(`Max latency: ${max} ms`);
}

for (const address of serverAddresses) {
  connectToServer(address);
}

// --- Helper: fake UserProfile generator
import { UserProfile } from '../json/data';

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
import { GrpcPipeClient } from '@grpc-pipe/client';
import { benchmarkClientRegistry } from '../src/schema.js';
import type { PipeHandler, InferSend, InferReceive } from '@grpc-pipe/client';
import { UserProfile } from '../src/benchmark.js';

type ClientSend = InferSend<typeof benchmarkClientRegistry>;
type ClientReceive = InferReceive<typeof benchmarkClientRegistry>;

const TOTAL_CLIENTS = 10;

function startClient(index: number) {
  const clientId = `client-${index}`;

  const client = new GrpcPipeClient<ClientSend, ClientReceive>({
    address: 'localhost:50500',
    schema: benchmarkClientRegistry,
    compression: true,
    heartbeat: false,
    channelOptions: {
      'grpc.keepalive_time_ms': 10_000,
      'grpc.keepalive_timeout_ms': 5_000,
      'grpc.keepalive_permit_without_calls': 1,
    },
  });

  client.on('connected', (pipe: PipeHandler<ClientSend, ClientReceive>) => {
    pipe.on('ping', (data) => {
      const payload: UserProfile = {
        ...data.message!,
        id: clientId,
      };
      pipe.post('pong', { message: payload });
    });
  });

  client.on('error', (err) => {
    console.error(`[CLIENT ${clientId}] Error:`, err.message);
  });

  client.on('disconnected', () => {
    console.warn(`[CLIENT ${clientId}] Disconnected`);
  });
}

for (let i = 0; i < TOTAL_CLIENTS; i++) {
  startClient(i);
}
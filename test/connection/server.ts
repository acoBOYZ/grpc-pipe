// --- server.ts ---
import { GrpcPipeServer } from '@grpc-pipe/server';
import { benchmarkServerRegistry } from '../src/schema';
import type { InferReceive, InferSend } from '@grpc-pipe/server';
import { generateBigPayload } from '../src/payload';

type ServerSend = InferSend<typeof benchmarkServerRegistry>;
type ServerReceive = InferReceive<typeof benchmarkServerRegistry>;

const server = new GrpcPipeServer<ServerSend, ServerReceive>({
  port: 50500,
  schema: benchmarkServerRegistry,
  compression: true,
  serverOptions: {
    'grpc.keepalive_time_ms': 10_000,
    'grpc.keepalive_timeout_ms': 5_000,
    'grpc.keepalive_permit_without_calls': 1,
  }
});

server.on('connection', (pipe) => {
  const payload = generateBigPayload('initial-ping');
  pipe.post('ping', { message: payload });

  pipe.on('pong', (data) => {
    const id = data.message?.id ?? '';
    console.log(`[SERVER] Received pong from ${id}`);
    // No follow-up pings!
  });
});

server.on('error', (err) => {
  console.error('[SERVER] Error:', err);
});

console.log('[SERVER] Ready on port 50500');
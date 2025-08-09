// server.ts
import type { InferReceive, InferSend } from '@grpc-pipe/server';
import { GrpcPipeServer } from '@grpc-pipe/server';
import { benchmarkServerRegistry } from './src/schema.js';

type ServerSend = InferSend<typeof benchmarkServerRegistry>;
type ServerReceive = InferReceive<typeof benchmarkServerRegistry>;
type ServerContext = {
  clientId: string;
};

const port = parseInt(process.env.PORT || '50061', 10);
const server = new GrpcPipeServer<ServerSend, ServerReceive, ServerContext>({
  host: '0.0.0.0',
  port,
  schema: benchmarkServerRegistry,
  compression: false,
  maxInFlight: 128,
  releaseOn: ['ping'],
  serverOptions: {
    // Keepalive (relaxed; works well with Go/TS clients)
    'grpc.keepalive_time_ms': 25_000,            // server-initiated pings every 25s
    'grpc.keepalive_timeout_ms': 10_000,
    'grpc.keepalive_permit_without_calls': 1,

    // http2 ping policy (grpc-js understands these)
    'grpc.http2.min_time_between_pings_ms': 20_000, // clients should not ping more often than this
    'grpc.http2.max_pings_without_data': 0,         // allow pings even without active streams

    // Big payloads
    'grpc.max_send_message_length': 64 * 1024 * 1024,
    'grpc.max_receive_message_length': 64 * 1024 * 1024,
  },
  beforeConnect: ({ metadata }) => {
    return {
      clientId: String(metadata.get('clientId')),
    };
  },
});

server.on('connection', (pipe) => {
  console.log(`[SERVER ${port}] New client connected.`);
  console.log(`[SERVER] Serialization method '${pipe.serialization}'`);

  pipe.on('ping', (data) => {
    // console.log(`[SERVER ${port}] Received ping:`, data);
    pipe.post('pong', { message: data.message });
  });
});

server.on('disconnected', (pipe) => {
  console.error(`[SERVER ${port}] Closing Pipe:`, pipe.context?.clientId);
});

server.on('error', (err) => {
  console.error(`[SERVER ${port}] Error:`, err);
});

console.log(`[SERVER ${port}] Ready.`);
import type { InferReceive, InferSend } from '@grpc-pipe/server';
import { GrpcPipeServer } from '@grpc-pipe/server';
import { benchmarkServerRegistry } from './src/schema';

type ServerSend = InferSend<typeof benchmarkServerRegistry>;
type ServerReceive = InferReceive<typeof benchmarkServerRegistry>;
type ServerContext = {
  clientId: string;
};

const port = parseInt(process.env.PORT || '50061', 10);
const server = new GrpcPipeServer<ServerSend, ServerReceive, ServerContext>({
  host: '0.0.0.0',
  port,
  // schema: benchmarkServerRegistry,
  compression: false,
  serverOptions: {
    'grpc.keepalive_time_ms': 10_000,
    'grpc.keepalive_timeout_ms': 5_000,
    'grpc.keepalive_permit_without_calls': 1,
  },
  beforeConnect: ({ metadata }) => {
    return {
      clientId: String(metadata.get('clientId')),
    };
  }
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
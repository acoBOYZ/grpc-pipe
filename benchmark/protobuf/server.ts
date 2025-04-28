import type { InferReceive, InferSend } from '../../src';
import { GrpcPipeServer } from '../../src/server/GrpcPipeServer';
import { benchmarkServerRegistry } from './src/schema';

type ServerSend = InferSend<typeof benchmarkServerRegistry>;
type ServerReceive = InferReceive<typeof benchmarkServerRegistry>;

const port = parseInt(process.env.PORT || '50061', 10);
const server = new GrpcPipeServer<ServerSend, ServerReceive>({ port });

server.on('connection', (pipe) => {
  pipe.useSchema(benchmarkServerRegistry);

  console.log(`[SERVER ${port}] New client connected.`);

  pipe.on('ping', (data) => {
    console.log(`[SERVER ${port}] Received ping:`, data);
    pipe.post('pong', { message: data.message });
  });
});

server.on('error', (err) => {
  console.error(`[SERVER ${port}] Error:`, err);
});

console.log(`[SERVER ${port}] Ready.`);
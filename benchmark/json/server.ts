// for start PORT=50051 bun --watch server.ts
import { GrpcPipeServer } from '@grpc-pipe/server';
import { UserProfile } from './data.js';

/** Messages the server sends to the client */
interface ServerSend {
  pong: { message: UserProfile };
}

/** Messages the server receives from the client */
interface ServerReceive {
  ping: { message: UserProfile };
}

const port = parseInt(process.env.PORT || '50051', 10);
const server = new GrpcPipeServer<ServerSend, ServerReceive>({ host: 'localhost', port, compression: true });

// Track connected clients
const clients = new Set<any>();

server.on('connection', (pipe) => {
  console.log(`[SERVER ${port}] New client connected.`);

  clients.add(pipe);

  pipe.on('ping', (data) => {
    // console.log(`[SERVER ${port}] Received ping:`, data);
    pipe.post('pong', { message: data.message });
  });
});

server.on('error', (err) => {
  console.error(`[SERVER ${port}] Error:`, err);
});

console.log(`[SERVER ${port}] Ready.`);
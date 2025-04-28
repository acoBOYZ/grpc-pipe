// --- server.ts ---
import { GrpcPipeServer } from '../src/server/GrpcPipeServer';

/** Messages the server sends to the client */
interface ServerSend {
  pong: { message: string };
}

/** Messages the server receives from the client */
interface ServerReceive {
  ping: { message: string };
}

const port = parseInt(process.env.PORT || '50051', 10);
const server = new GrpcPipeServer<ServerSend, ServerReceive>({ port });

// Track connected clients
const clients = new Set<any>();

server.on('connection', (pipe) => {
  console.log(`[SERVER ${port}] New client connected.`);

  clients.add(pipe);

  pipe.on('ping', (data) => {
    console.log(`[SERVER ${port}] Received ping:`, data);
    // 🛠️ Important fix here
    pipe.post('pong', { message: data.message });
  });

  pipe.on('close', () => {
    console.log(`[SERVER ${port}] Client disconnected.`);
    clients.delete(pipe);
  });
});

server.on('error', (err) => {
  console.error(`[SERVER ${port}] Error:`, err);
});

console.log(`[SERVER ${port}] Ready.`);
// --- client.ts ---
import { GrpcPipeClient } from '../src/client/GrpcPipeClient';
import { PipeHandler } from '../src/core/PipeHandler';

/** Messages the client sends to the server */
interface ClientSend {
  ping: { message: string };
}

/** Messages the client receives from the server */
interface ClientReceive {
  pong: { message: string };
}

// List of server addresses
const serverAddresses = [
  'localhost:50051',
  'localhost:50052',
  'localhost:50053',
];

const connections = new Map<string, PipeHandler<ClientSend, ClientReceive>>();
const heartbeatTimers = new Map<string, NodeJS.Timeout>();

function connectToServer(address: string) {
  const client = new GrpcPipeClient<ClientSend, ClientReceive>({
    address,
    reconnectDelayMs: 2000,
  });

  client.on('connected', (pipe: PipeHandler<ClientSend, ClientReceive>) => {
    console.log(`[CLIENT] Connected to ${address}`);
    connections.set(address, pipe);

    pipe.on('pong', (data) => {
      console.log(`[CLIENT] Received pong from ${address}:`, data);
    });

    const timer = setInterval(() => {
      console.log(`[CLIENT] Sending ping to ${address}...`);
      pipe.post('ping', { message: `Hello from Client to ${address}!` });
    }, 5000);

    heartbeatTimers.set(address, timer);
  });

  client.on('disconnected', () => {
    console.warn(`[CLIENT] Disconnected from ${address}`);
    const timer = heartbeatTimers.get(address);
    if (timer) {
      clearInterval(timer);
      heartbeatTimers.delete(address);
    }
    connections.delete(address);
  });

  client.on('error', (err) => {
    console.error(`[CLIENT] Error with ${address}:`, err.message);
  });
}

// Connect to all servers
for (const address of serverAddresses) {
  connectToServer(address);
}
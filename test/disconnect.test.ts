import { GrpcPipeServer } from '@grpc-pipe/server';
import { GrpcPipeClient } from '@grpc-pipe/client';
import { benchmarkClientRegistry, benchmarkServerRegistry } from './src/schema';
import type { InferReceive, InferSend, PipeHandler } from '@grpc-pipe/server';

type ServerSend = InferSend<typeof benchmarkServerRegistry>;
type ServerReceive = InferReceive<typeof benchmarkServerRegistry>;
type ClientSend = InferSend<typeof benchmarkClientRegistry>;
type ClientReceive = InferReceive<typeof benchmarkClientRegistry>;

const PORT = 50550;
const clientId = 'test-client-1';

test('GrpcPipeServer emits disconnected event per client (Bun)', async () => {
  let connectedPipe: PipeHandler<ServerSend, ServerReceive> | null = null;

  const disconnectTriggered = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('disconnected event not triggered within timeout'));
    }, 3000);

    const server = new GrpcPipeServer<ServerSend, ServerReceive>({
      port: PORT,
      schema: benchmarkServerRegistry,
      compression: false,
      beforeConnect: async ({ metadata }) => {
        metadata.set('clientid', clientId);
        return { clientId };
      },
      onConnect: (pipe) => {
        connectedPipe = pipe;
      },
    });

    server.on('disconnected', (pipe) => {
      console.log('[SERVER] Disconnected event fired');
      if (pipe === connectedPipe) {
        clearTimeout(timeout);
        resolve();
      } else {
        clearTimeout(timeout);
        reject(new Error('Disconnected pipe mismatch'));
      }
    });
  });

  const client = new GrpcPipeClient<ClientSend, ClientReceive>({
    address: `localhost:${PORT}`,
    schema: benchmarkClientRegistry,
    compression: false,
    metadata: { clientid: clientId },
  });

  await new Promise<void>((resolve) => {
    client.on('connected', () => {
      setTimeout(() => {
        console.log('[CLIENT] Ending stream');
        client.stream?.end(); // This is the KEY to triggering the disconnect
        resolve();
      }, 200);
    });
  });

  await disconnectTriggered;
});
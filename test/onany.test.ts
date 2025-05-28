import { GrpcPipeServer } from '@grpc-pipe/server';
import { GrpcPipeClient } from '@grpc-pipe/client';
import { benchmarkClientRegistry, benchmarkServerRegistry } from './src/schema.js';
import type { InferReceive, InferSend } from '@grpc-pipe/server';
import { generateBigPayload } from './src/payload.js';

type ServerSend = InferSend<typeof benchmarkServerRegistry>;
type ServerReceive = InferReceive<typeof benchmarkServerRegistry>;
type ClientSend = InferSend<typeof benchmarkClientRegistry>;
type ClientReceive = InferReceive<typeof benchmarkClientRegistry>;

const PORT = 50553;
const CLIENT_COUNT = 5;

test('GrpcPipeServer global incoming emits correct payloads for each client', async () => {
  const receivedPayloads: Record<string, any> = {};
  const expectedPayloads: Record<string, any> = {};

  let resolveAll!: () => void;
  const allReceived = new Promise<void>((resolve) => {
    resolveAll = resolve;
  });

  let remaining = CLIENT_COUNT;

  const server = new GrpcPipeServer<ServerSend, ServerReceive, { clientId: string; }>({
    host: 'localhost',
    port: PORT,
    schema: benchmarkServerRegistry,
    compression: false,
    beforeConnect: async ({ metadata }) => {
      const clientId = String(metadata.get('clientid'));
      return { clientId };
    },
  });

  server.on('incoming', ({ type, data, pipe }) => {
    const id = pipe.context?.clientId;
    if (type === 'pong' && id) {
      receivedPayloads[id] = data;

      expect(data).toEqual({ message: expectedPayloads[id] });
      expect(pipe).toBeDefined();

      if (--remaining === 0) {
        resolveAll();
      }
    }
  });

  // Create and start clients
  for (let i = 0; i < CLIENT_COUNT; i++) {
    const clientId = `client-${i}`;
    const payload = generateBigPayload(clientId);
    expectedPayloads[clientId] = payload;

    const client = new GrpcPipeClient<ClientSend, ClientReceive>({
      address: `localhost:${PORT}`,
      schema: benchmarkClientRegistry,
      compression: false,
      metadata: { clientid: clientId },
    });

    await new Promise<void>((resolve) => {
      client.on('connected', (pipe) => {
        pipe.post('pong', { message: payload });
        resolve();
      });
    });
  }

  // Wait for all clients to be validated
  await allReceived;
});
import { GrpcPipeServer } from '@grpc-pipe/server';
import { benchmarkServerRegistry } from '../src/schema.js';
import { generateBigPayload } from '../src/payload.js';
const server = new GrpcPipeServer({
    host: 'localhost',
    port: 50500,
    schema: benchmarkServerRegistry,
    compression: true,
    serverOptions: {
        'grpc.keepalive_time_ms': 10000,
        'grpc.keepalive_timeout_ms': 5000,
        'grpc.keepalive_permit_without_calls': 1,
    }
});
server.on('connection', (pipe) => {
    const payload = generateBigPayload('initial-ping');
    pipe.post('ping', { message: payload });
    pipe.on('pong', (data) => {
        const id = data.message?.id ?? '';
        console.log(`[SERVER] Received pong from ${id}`);
    });
});
server.on('error', (err) => {
    console.error('[SERVER] Error:', err);
});
console.log('[SERVER] Ready on port 50500');

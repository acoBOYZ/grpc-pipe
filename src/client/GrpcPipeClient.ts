import { EventEmitter } from 'events';
import { Client, credentials } from '@grpc/grpc-js';
import { GrpcClientTransport } from '../transports/GrpcClientTransport';
import { PipeHandler } from '../core/PipeHandler';
import { PipeMessage } from '../types/pipe';

export interface GrpcPipeClientOptions {
  address: string;
  reconnectDelayMs?: number;
}

/**
 * GrpcPipeClient connects to a GrpcPipeServer and manages the pipe
 */
export class GrpcPipeClient<SendMap, ReceiveMap> extends EventEmitter {
  private client?: Client;
  private readonly reconnectDelayMs: number;
  private connected: boolean = false;

  constructor(private options: GrpcPipeClientOptions) {
    super();
    this.reconnectDelayMs = options.reconnectDelayMs ?? 2000;

    this.connect();
  }

  private connect() {
    this.client = new Client(this.options.address, credentials.createInsecure());

    const stream = this.client.makeBidiStreamRequest(
      '/pipe.PipeService/Communicate',
      (message: PipeMessage) => Buffer.from(PipeMessage.encode(message).finish()),
      (buffer: Buffer) => PipeMessage.decode(buffer)
    );

    const transport = new GrpcClientTransport(stream);
    const pipe = new PipeHandler<SendMap, ReceiveMap>(transport);

    stream.on('metadata', () => {
      if (!this.connected) {
        this.connected = true;
        this.emit('connected', pipe);
        console.log('[GrpcPipeClient] Connected to server.');
      }
    });

    stream.on('error', (err) => {
      this.connected = false;
      this.emit('error', err);
      console.error('[GrpcPipeClient] Stream error:', err.message);
      setTimeout(() => this.connect(), this.reconnectDelayMs);
    });

    stream.on('end', () => {
      this.connected = false;
      this.emit('disconnected');
      console.warn('[GrpcPipeClient] Disconnected from server.');
      setTimeout(() => this.connect(), this.reconnectDelayMs);
    });

    stream.on('close', () => {
      this.connected = false;
      this.emit('disconnected');
      console.warn('[GrpcPipeClient] Stream closed.');
      setTimeout(() => this.connect(), this.reconnectDelayMs);
    });
  }
}
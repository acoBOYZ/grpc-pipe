// src/client/GrpcPipeClient.ts
import { Client, credentials } from '@grpc/grpc-js';
import { GrpcClientTransport } from '../transports/GrpcClientTransport';
import { PipeHandler } from '../core/PipeHandler';
import { PipeMessage } from '../types/pipe';
import { TypedEventEmitter } from '../core/TypedEventEmitter';

export interface GrpcPipeClientOptions {
  address: string;
  reconnectDelayMs?: number;
  compression?: boolean;
  backpressureThresholdBytes?: number;
}

interface GrpcPipeClientEvents<SendMap, ReceiveMap> {
  connected: (pipe: PipeHandler<SendMap, ReceiveMap>) => void;
  disconnected: () => void;
  error: (error: Error) => void;
  [key: string]: (...args: any[]) => void;
}

export class GrpcPipeClient<SendMap, ReceiveMap> extends TypedEventEmitter<GrpcPipeClientEvents<SendMap, ReceiveMap>> {
  private client?: Client;
  private readonly reconnectDelayMs: number;
  private readonly compression: boolean;
  private readonly backpressureThresholdBytes: number;
  private connected: boolean = false;

  constructor(private options: GrpcPipeClientOptions) {
    super();
    this.reconnectDelayMs = options.reconnectDelayMs ?? 2000;
    this.compression = options.compression ?? false;
    this.backpressureThresholdBytes = options.backpressureThresholdBytes ?? 5 * 1024 * 1024;
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
    const pipe = new PipeHandler<SendMap, ReceiveMap>(transport, undefined, {
      compression: this.compression,
      backpressureThresholdBytes: this.backpressureThresholdBytes,
    });

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
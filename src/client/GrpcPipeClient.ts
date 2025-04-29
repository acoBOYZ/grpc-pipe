import { Client, credentials } from '@grpc/grpc-js';
import { GrpcClientTransport } from '../transports/GrpcClientTransport';
import { PipeHandler } from '../core/PipeHandler';
import { PipeMessage } from '../types/pipe';
import { TypedEventEmitter } from '../core/TypedEventEmitter';

/**
 * Configuration options for {@link GrpcPipeClient}.
 */
export interface GrpcPipeClientOptions {
  /** The server address to connect to (e.g. `localhost:50051`). */
  address: string;

  /** Delay in milliseconds before attempting reconnection after disconnection. Defaults to 2000ms. */
  reconnectDelayMs?: number;

  /** Whether to enable compression for outgoing messages. */
  compression?: boolean;

  /** Threshold in bytes for applying backpressure to outgoing messages. Defaults to 5MB. */
  backpressureThresholdBytes?: number;
}

/**
 * Event definitions for {@link GrpcPipeClient}.
 *
 * @template SendMap - Message types the client can send.
 * @template ReceiveMap - Message types the client can receive.
 */
interface GrpcPipeClientEvents<SendMap, ReceiveMap> {
  /**
   * Emitted when the client successfully connects and establishes a stream.
   * @param pipe - The PipeHandler instance for this connection.
   */
  connected: (pipe: PipeHandler<SendMap, ReceiveMap>) => void;

  /** Emitted when the client is disconnected from the server. */
  disconnected: () => void;

  /**
   * Emitted when a stream or connection error occurs.
   * @param error - The encountered error.
   */
  error: (error: Error) => void;

  /** Additional custom events. */
  [key: string]: (...args: any[]) => void;
}

/**
 * GrpcPipeClient establishes and maintains a bidirectional streaming connection
 * to a gRPC server, with automatic reconnection, message compression,
 * and backpressure support.
 *
 * It emits typed events for connection lifecycle events and wraps the stream
 * in a {@link PipeHandler} for typed messaging.
 *
 * @template SendMap - The message map for outbound messages.
 * @template ReceiveMap - The message map for inbound messages.
 */
export class GrpcPipeClient<SendMap, ReceiveMap> extends TypedEventEmitter<GrpcPipeClientEvents<SendMap, ReceiveMap>> {
  private client?: Client;
  private readonly reconnectDelayMs: number;
  private readonly compression: boolean;
  private readonly backpressureThresholdBytes: number;
  private connected: boolean = false;

  /**
   * Creates a new instance of {@link GrpcPipeClient}.
   *
   * @param options - Client configuration including address and optional behaviors.
   */
  constructor(private options: GrpcPipeClientOptions) {
    super();
    this.reconnectDelayMs = options.reconnectDelayMs ?? 2000;
    this.compression = options.compression ?? false;
    this.backpressureThresholdBytes = options.backpressureThresholdBytes ?? 5 * 1024 * 1024;
    this.connect();
  }

  /**
   * Internal method to initiate the connection and setup event handlers
   * for the gRPC bidirectional stream.
   *
   * Automatically reconnects on `end`, `close`, or `error`.
   */
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
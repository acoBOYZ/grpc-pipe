import {
  Client,
  type ClientOptions,
  credentials,
  Metadata
} from '@grpc/grpc-js';
import type { PipeHandlerOptions } from '@grpc-pipe/core';
import {
  GrpcClientTransport,
  PipeHandler,
  PipeMessage,
  TypedEventEmitter,
} from '@grpc-pipe/core';

/**
 * Configuration options for {@link GrpcPipeClient}.
 */
export interface GrpcPipeClientOptions extends PipeHandlerOptions {
  /** The server address to connect to (e.g. `localhost:50051`). */
  address: string;

  /** Delay in milliseconds before attempting reconnection after disconnection. Defaults to 2000ms. */
  reconnectDelayMs?: number;

  /**
   * Optional metadata to send during the initial connection.
   * Example:
   * `{ authorization: 'Bearer abc', clientId: '123' }`
   */
  metadata?: Record<string, string>;

  /**
   * Enable TLS. If true, uses default secure credentials.
   * Optional advanced: pass root cert if needed.
   */
  tls?: boolean | {
    rootCerts?: Buffer | string;
  };

  /**
   * Advanced: gRPC channel options (e.g. keepalive settings).
   * See: https://grpc.github.io/grpc/core/group__grpc__arg__keys.html
   */
  channelOptions?: ClientOptions;
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
  private readonly heartbeat: boolean | { intervalMs?: number };
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
    this.heartbeat = options.heartbeat ?? false;
    this.connect();
  }

  /**
   * Internal method to initiate the connection and setup event handlers
   * for the gRPC bidirectional stream.
   *
   * Automatically reconnects on `end`, `close`, or `error`.
   */
  private connect() {
    if (typeof this.options.address !== 'string') {
      throw new TypeError(`Invalid gRPC server address: ${this.options.address}`);
    }

    const creds = this.options.tls
      ? credentials.createSsl(
        typeof this.options.tls === 'object' && this.options.tls.rootCerts
          ? Buffer.from(this.options.tls.rootCerts)
          : undefined
      )
      : credentials.createInsecure();
    this.client = new Client(this.options.address, creds, this.options.channelOptions);

    const metadata = new Metadata();
    for (const [key, value] of Object.entries(this.options.metadata ?? {})) {
      metadata.set(key, value);
    }

    const stream = this.client.makeBidiStreamRequest(
      '/pipe.PipeService/Communicate',
      (message: PipeMessage) => Buffer.from(PipeMessage.encode(message).finish()),
      (buffer: Buffer) => PipeMessage.decode(buffer),
      metadata
    );

    const transport = new GrpcClientTransport(stream);
    const pipe = new PipeHandler<SendMap, ReceiveMap>(transport, undefined, {
      compression: this.compression,
      backpressureThresholdBytes: this.backpressureThresholdBytes,
      heartbeat: this.heartbeat,
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
import type { GrpcPipeClientEvents, GrpcPipeClientOptions } from './types.js';
import type { ClientDuplexStream } from '@grpc/grpc-js';

import {
  Client,
  credentials,
  Metadata
} from '@grpc/grpc-js';
import {
  GrpcClientTransport,
  PipeHandler,
  TypedEventEmitter,
  com
} from '@grpc-pipe/core';


/**
 * GrpcPipeClient establishes and maintains a bidirectional streaming connection
 * to a gRPC server using the {@link PipeHandler} abstraction.
 *
 * It provides automatic reconnection, optional compression, schema-based message handling,
 * and backpressure support. This client is intended for use in real-time systems
 * such as chat apps, telemetry, or RPC-over-stream implementations.
 *
 * @template SendMap - A map of message types the client can send.
 * @template ReceiveMap - A map of message types the client can receive.
 */
export class GrpcPipeClient<SendMap, ReceiveMap> extends TypedEventEmitter<GrpcPipeClientEvents<SendMap, ReceiveMap>> {
  private client?: Client;
  private reconnectTimeout?: NodeJS.Timeout;
  private shouldReconnect: boolean = true;

  private readonly reconnectBaseDelay: number;
  private currentReconnectDelay: number;
  private readonly maxReconnectDelay = 30_000;

  private connected = false;
  private isReconnecting = false;


  /**
   * Exposes the raw gRPC duplex stream used for communication.
   * Intended primarily for testing or low-level access.
   */
  public stream?: ClientDuplexStream<com.PipeMessage, com.PipeMessage>;

  /**
   * Creates a new instance of {@link GrpcPipeClient}.
   *
   * @param options - Client configuration options.
   * @param options.address - Target server address (e.g., `localhost:50051`).
   * @param options.reconnectDelayMs - Optional delay between reconnection attempts (default: 2000ms).
   * @param options.metadata - Optional metadata to include in the initial connection.
   * @param options.tls - Enable TLS, optionally with a root cert.
   * @param options.channelOptions - gRPC channel options for advanced tuning.
   * @param options.compression - Enable snappy/gzip compression for outgoing messages.
   * @param options.backpressureThresholdBytes - Apply backpressure when transport buffer exceeds this size.
   * @param options.heartbeat - Enables automatic heartbeats (interval or boolean).
   */
  constructor(private options: GrpcPipeClientOptions<SendMap, ReceiveMap>) {
    super();
    this.reconnectBaseDelay = options.reconnectDelayMs ?? 2_000;
    this.currentReconnectDelay = this.reconnectBaseDelay;
    this.connect();
  }

  /**
   * Establishes a gRPC bidirectional stream with the server.
   * This method is invoked automatically on instantiation and reconnects automatically on disconnect.
   *
   * Emits:
   * - `'connected'` when the stream is successfully established.
   * - `'disconnected'` when the stream ends or closes.
   * - `'error'` when a stream or network error occurs.
   */
  private connect() {
    if (this.isReconnecting) {
      console.debug('[GrpcPipeClient] Skipping connect — already reconnecting');
      return;
    }
    this.isReconnecting = true;
    this.shouldReconnect = true;

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

    const deadline = Date.now() + 5000;
    this.client.waitForReady(deadline, (err) => {
      if (err) {
        console.warn('[GrpcPipeClient] waitForReady failed:', err.message);
        this.client?.close();
        this.client = undefined;
        this.scheduleReconnect();
        this.isReconnecting = false;
        return;
      }

      this.startStream();
    });
  }

  private startStream() {
    const metadata = new Metadata();
    for (const [key, value] of Object.entries(this.options.metadata ?? {})) {
      metadata.set(key, value);
    }

    this.stream = this.client!.makeBidiStreamRequest(
      '/com.PipeService/Communicate',
      (msg: com.PipeMessage) => Buffer.from(com.PipeMessage.encode(msg).finish()),
      (buf: Buffer) => com.PipeMessage.decode(buf),
      metadata
    );

    const transport = new GrpcClientTransport(this.stream);

    let pipe: PipeHandler<SendMap, ReceiveMap>;
    try {
      pipe = new PipeHandler<SendMap, ReceiveMap>(
        transport,
        this.options.schema,
        this.options
      );
    } catch (err) {
      this.stream.destroy(err instanceof Error ? err : new Error('Pipe init failed'));
      return;
    }

    const handleDisconnect = () => {
      pipe.destroy();
      this.connected = false;
      this.isReconnecting = false;
      this.scheduleReconnect();
      this.emit('disconnected');
    };

    this.stream.on('metadata', () => {
      if (!this.connected) {
        this.connected = true;
        this.currentReconnectDelay = this.reconnectBaseDelay;
        this.emit('connected', pipe);
        console.debug('[GrpcPipeClient] Connected to server.');
      }
    });

    this.stream.on('error', (err) => {
      // UNAVAILABLE, INTERNAL, DEADLINE_EXCEEDED
      const knownDisconnectCodes = [14, 13, 4];
      const grpcCode = (err as any).code;

      if (knownDisconnectCodes.includes(grpcCode)) {
        console.warn(`[GrpcPipeClient] Recoverable gRPC error: ${err.message}`);
      } else {
        this.emit('error', err);
        console.error('[GrpcPipeClient] Unexpected gRPC error:', err.message);
      }

      handleDisconnect();
    });

    this.stream.on('end', () => {
      console.warn('[GrpcPipeClient] Stream ended.');
      handleDisconnect();
    });

    this.stream.on('close', () => {
      console.warn('[GrpcPipeClient] Stream closed.');
      handleDisconnect();
    });

    this.on('error', () => { /* ignored */ })
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect || this.reconnectTimeout) return;

    this.currentReconnectDelay = Math.min(this.currentReconnectDelay * 2, this.maxReconnectDelay);
    console.debug(`[GrpcPipeClient] Reconnecting in ${this.currentReconnectDelay}ms...`);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = undefined;
      this.connect();
    }, this.currentReconnectDelay);
  }

  /**
   * Gracefully closes the active connection to the server.
   *
   * This method:
   * - Ends the gRPC stream, notifying the server to trigger `'disconnected'`.
   * - Closes the underlying gRPC client/channel.
   *
   * It is recommended to call this method when the client is shutting down,
   * logging out, or no longer needs to maintain a persistent connection.
   *
   * ```ts
   * client.close(); // Triggers server disconnect event
   * ```
   */
  public close() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }

    try {
      this.stream?.end();
      this.client?.close();
    } catch (err) {
      console.error('[GrpcPipeClient] Error during close:', err);
    }
  }

  /**
   * Gracefully shuts down the client and cleans up all internal state.
   * - Stops reconnection attempts
   * - Destroys the active stream and transport
   * - Removes all listeners
   */
  public destroy() {
    this.shouldReconnect = false;
    this.isReconnecting = true;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }

    try {
      this.stream?.removeAllListeners();
      this.stream?.end();
    } catch (err) {
      console.warn('[GrpcPipeClient] Error ending stream during destroy:', err);
    }

    try {
      this.client?.close();
    } catch (err) {
      console.warn('[GrpcPipeClient] Error closing client during destroy:', err);
    }

    this.removeAllListeners();
    this.stream = undefined;
    this.client = undefined;
    this.connected = false;
  }
}
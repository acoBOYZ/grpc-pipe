import type {
  PipeHandler,
  PipeHandlerOptions,
  SchemaRegistry
} from '@grpc-pipe/core';
import type { ClientOptions } from '@grpc/grpc-js';

/**
 * Configuration options for {@link GrpcPipeClient}.
 */
export interface GrpcPipeClientOptions<SendMap, ReceiveMap> extends PipeHandlerOptions<ReceiveMap> {
  /** The server address to connect to (e.g. `localhost:50051`). */
  address: string;

  schema?: SchemaRegistry<SendMap, ReceiveMap>;

  /** Delay in milliseconds before attempting reconnection after disconnection. Defaults to 2000ms. */
  reconnectDelayMs?: number;

  /**
   * Optional metadata to send during the initial connection.
   * Example:
   * `{ authorization: 'Bearer token', clientId: 'id' }`
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
export interface GrpcPipeClientEvents<SendMap, ReceiveMap> {
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
}
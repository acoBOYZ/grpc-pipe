import type {
  PipeConnectionHook,
  PipeHandler,
  PipeHandlerOptions,
  SchemaRegistry
} from '@grpc-pipe/core';
import type { ServerOptions } from '@grpc/grpc-js';

type IncomingPayload<SendMap, ReceiveMap, Ctx extends object = {}> = {
  [K in keyof ReceiveMap]: {
    type: K;
    data: ReceiveMap[K];
    pipe: PipeHandler<SendMap, ReceiveMap, Ctx>;
  }
}[keyof ReceiveMap];

/**
 * Configuration options for the {@link GrpcPipeServer}.
 */
export interface GrpcPipeServerOptions<SendMap, ReceiveMap, Ctx extends object = {}> extends PipeHandlerOptions<ReceiveMap> {
  /**
   * The host IP address the server should bind to.
   *
   * Examples:
   * - `'127.0.0.1'` for localhost only
   * - `'0.0.0.0'` to listen on all IPv4 interfaces
   * - `'::'` to support all IPv6 interfaces
   *
   * This value determines which network interfaces the server will accept connections from.
   */
  host: string;

  /** The port number the server should listen on. */
  port: number;

  schema?: SchemaRegistry<SendMap, ReceiveMap>;

  /**
   * Optional hook to authenticate or modify the connection before fully establishing it.
   * Can return a context object that will be available on the pipe via `.context`.
   */
  beforeConnect?: PipeConnectionHook<Ctx>;

  /**
   * Called after the pipe is created, but before "system_ready" is sent.
   * You can store references, set schema, attach listeners, etc.
   */
  onConnect?: (pipe: PipeHandler<any, any>) => void | Promise<void>;

  /**
   * Enable TLS by passing key/cert pair.
   * If not provided, insecure connection will be used.
   */
  tls?: {
    cert: Buffer | string;
    key: Buffer | string;
  };

  /**
   * Optional gRPC channel/server options (e.g. keepalive settings).
   */
  serverOptions?: ServerOptions;
}

/**
 * Event definitions for the {@link GrpcPipeServer}.
 *
 * @template SendMap - The message map for outbound messages.
 * @template ReceiveMap - The message map for inbound messages.
 */
export interface GrpcPipeServerEvents<SendMap, ReceiveMap, Ctx extends object = {}> {
  /**
   * Emitted when a new gRPC connection is established.
   * @param pipe - The pipe handler for managing the connection.
   */
  connection: (pipe: PipeHandler<SendMap, ReceiveMap, Ctx>) => void;

  /**
   * Emitted when an individual client disconnects.
   * Safe to use for session cleanup.
   */
  disconnected: (pipe: PipeHandler<SendMap, ReceiveMap, Ctx>) => void;

  /**
   * Emitted when a server error occurs.
   * @param error - The encountered error.
   */
  error: (error: Error) => void;

  /** Emitted for every message from any pipe */
  incoming: (payload: IncomingPayload<SendMap, ReceiveMap, Ctx>) => void;
}
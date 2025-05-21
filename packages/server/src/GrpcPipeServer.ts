import {
  Server,
  ServerCredentials,
  type ServerOptions,
  type ServerDuplexStream
} from '@grpc/grpc-js';
import type {
  PipeConnectionHook,
  PipeHandlerOptions,
  PipeMessage,
} from '@grpc-pipe/core';
import {
  GrpcServerTransport,
  PipeHandler,
  PipeServiceService,
  TypedEventEmitter,
} from '@grpc-pipe/core';

/**
 * Configuration options for the {@link GrpcPipeServer}.
 */
export interface GrpcPipeServerOptions<Context = any> extends PipeHandlerOptions {
  /** The port number the server should listen on. */
  port: number;

  /**
   * Optional hook to authenticate or modify the connection before fully establishing it.
   * Can return a context object that will be available on the pipe via `.context`.
   */
  onConnect?: PipeConnectionHook<Context>;

  /**
   * Called after the pipe is created, but before "system_ready" is sent.
   * You can store references, set schema, attach listeners, etc.
   */
  onPipeReady?: (pipe: PipeHandler<any, any>) => void | Promise<void>;

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
interface GrpcPipeServerEvents<SendMap, ReceiveMap> {
  /**
   * Emitted when a new gRPC connection is established.
   * @param pipe - The pipe handler for managing the connection.
   */
  connection: (pipe: PipeHandler<SendMap, ReceiveMap>) => void;

  /**
   * Emitted when an individual client disconnects.
   * Safe to use for session cleanup.
   */
  disconnected: (pipe: PipeHandler<SendMap, ReceiveMap>) => void;

  /**
   * Emitted when a server error occurs.
   * @param error - The encountered error.
   */
  error: (error: Error) => void;

  /** Additional custom events. */
  [key: string]: (...args: any[]) => void;
}

/**
 * GrpcPipeServer is a high-level wrapper around a gRPC server that facilitates
 * real-time, bidirectional communication using the {@link PipeHandler} abstraction.
 *
 * It emits structured events when clients connect or disconnect, provides hooks for
 * authentication (`onConnect`) and initialization (`onPipeReady`), and supports
 * advanced transport features like compression, heartbeats, and backpressure.
 *
 * @template SendMap - The message types the server can send to clients.
 * @template ReceiveMap - The message types the server can receive from clients.
 */
export class GrpcPipeServer<SendMap, ReceiveMap> extends TypedEventEmitter<GrpcPipeServerEvents<SendMap, ReceiveMap>> {
  private server: Server;
  private compression: boolean;
  private backpressureThresholdBytes: number;
  private readonly heartbeat: boolean | { intervalMs?: number };

  /**
   * Constructs a new {@link GrpcPipeServer}.
   *
   * @param options - Configuration for the server's behavior and transport.
   * @param options.port - The TCP port to listen on (e.g., `50500`).
   * @param options.onConnect - Optional hook to authenticate clients and return session context.
   * @param options.onPipeReady - Optional hook fired after `PipeHandler` is created but before `'connection'` is emitted.
   * @param options.tls - TLS credentials for secure connections. If omitted, server uses insecure transport.
   * @param options.serverOptions - Additional gRPC server/channel options (e.g., keepalive settings).
   * @param options.compression - Enables gzip compression for messages.
   * @param options.backpressureThresholdBytes - Buffer size before applying write backpressure.
   * @param options.heartbeat - Enable heartbeat pings (boolean or interval object).
   */
  constructor(private options: GrpcPipeServerOptions<{}>) {
    super();
    this.server = new Server(this.options.serverOptions);

    this.compression = options.compression ?? false;
    this.backpressureThresholdBytes = options.backpressureThresholdBytes ?? 5 * 1024 * 1024;
    this.heartbeat = options.heartbeat ?? true;

    this.server.addService(PipeServiceService, {
      communicate: async (stream: ServerDuplexStream<PipeMessage, PipeMessage>) => {
        const transport = new GrpcServerTransport(stream);
        const metadata = stream.metadata;

        let context: any = {};
        if (this.options.onConnect) {
          try {
            const maybeCtx = await this.options.onConnect({
              metadata,
              transport,
              rawStream: stream,
            });

            if (maybeCtx && typeof maybeCtx === 'object') {
              context = maybeCtx;
            }
          } catch (err) {
            stream.destroy(err instanceof Error ? err : new Error('Auth failed'));
            return;
          }
        }

        const pipe = new PipeHandler<SendMap, ReceiveMap>(transport, undefined, {
          compression: this.compression,
          backpressureThresholdBytes: this.backpressureThresholdBytes,
          heartbeat: this.heartbeat,
        }, context);

        if (this.options.onPipeReady) {
          try {
            await this.options.onPipeReady(pipe);
          } catch (err) {
            stream.destroy(err instanceof Error ? err : new Error('onPipeReady failed'));
            return;
          }
        }

        this.emit('connection', pipe);

        const handleDisconnect = () => {
          this.emit('disconnected', pipe);
        };

        stream.on('close', handleDisconnect);
        stream.on('end', handleDisconnect);

        stream.write({
          type: 'system_ready',
          payload: new Uint8Array(),
        });
      }
    });

    this.bind();
  }

  /**
   * Binds the gRPC server to the configured port and starts listening for incoming connections.
   * Automatically selects between secure (TLS) and insecure modes based on provided credentials.
   *
   * Emits `'error'` if binding fails.
   */
  private bind() {
    const creds = this.options.tls
      ? ServerCredentials.createSsl(
        null,
        [{
          cert_chain: Buffer.isBuffer(this.options.tls.cert)
            ? this.options.tls.cert
            : Buffer.from(this.options.tls.cert),
          private_key: Buffer.isBuffer(this.options.tls.key)
            ? this.options.tls.key
            : Buffer.from(this.options.tls.key),
        }],
        false
      )
      : ServerCredentials.createInsecure();

    this.server.bindAsync(
      `0.0.0.0:${this.options.port}`,
      creds,
      (err, port) => {
        if (err) {
          this.emit('error', err);
          return;
        }
        console.log(`[GrpcPipeServer] Listening on port ${port}`);
      }
    );
  }
}
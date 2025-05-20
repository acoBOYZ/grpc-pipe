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
   * Emitted when a server error occurs.
   * @param error - The encountered error.
   */
  error: (error: Error) => void;

  /** Additional custom events. */
  [key: string]: (...args: any[]) => void;
}

/**
 * GrpcPipeServer is a gRPC-based transport server that emits events
 * when clients connect or errors occur. It wraps low-level gRPC functionality
 * and provides high-level typed streaming communication using {@link PipeHandler}.
 *
 * @template SendMap - The map of message types that the server can send.
 * @template ReceiveMap - The map of message types that the server can receive.
 */
export class GrpcPipeServer<SendMap, ReceiveMap> extends TypedEventEmitter<GrpcPipeServerEvents<SendMap, ReceiveMap>> {
  private server: Server;
  private compression: boolean;
  private backpressureThresholdBytes: number;
  private readonly heartbeat: boolean | { intervalMs?: number };

  /**
   * Creates a new instance of {@link GrpcPipeServer}.
   *
   * @param options - Configuration options such as port and compression settings.
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
        try {
          if (this.options.onConnect) {
            const maybeCtx = await this.options.onConnect({
              metadata,
              transport,
              rawStream: stream,
            });

            if (maybeCtx && typeof maybeCtx === 'object') {
              context = maybeCtx;
            }
          }
        } catch (err) {
          stream.destroy(err instanceof Error ? err : new Error('Auth failed'));
          return;
        }

        const pipe = new PipeHandler<SendMap, ReceiveMap>(transport, undefined, {
          compression: this.compression,
          backpressureThresholdBytes: this.backpressureThresholdBytes,
          heartbeat: this.heartbeat,
        }, context);

        this.emit('connection', pipe);

        stream.write({
          type: 'system_ready',
          payload: new Uint8Array(),
        });
      }
    });

    this.bind();
  }

  /**
   * Binds the server to the specified port and starts listening.
   * Emits an 'error' event if binding fails.
   *
   * This method is called automatically during construction.
   * It uses insecure credentials by default.
   */
  private bind() {
    const creds = this.options.tls
      ? ServerCredentials.createSsl(
        null, //NOTE: root certs (optional for mTLS)
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
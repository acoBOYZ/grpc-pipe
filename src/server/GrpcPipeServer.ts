import { Server, ServerCredentials, type ServerDuplexStream } from '@grpc/grpc-js';
import { PipeHandler } from '../core/PipeHandler';
import { PipeMessage, PipeServiceService } from '../types/pipe';
import { GrpcServerTransport } from '../transports/GrpcServerTransport';
import { TypedEventEmitter } from '../core/TypedEventEmitter';

/**
 * Configuration options for the {@link GrpcPipeServer}.
 */
export interface GrpcPipeServerOptions {
  /** The port number the server should listen on. */
  port: number;

  /** Whether to enable compression for outgoing messages. */
  compression?: boolean;

  /** Threshold in bytes for backpressure handling. Defaults to 5MB. */
  backpressureThresholdBytes?: number;
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

  /**
   * Creates a new instance of {@link GrpcPipeServer}.
   *
   * @param options - Configuration options such as port and compression settings.
   */
  constructor(private options: GrpcPipeServerOptions) {
    super();
    this.server = new Server();

    this.compression = options.compression ?? false;
    this.backpressureThresholdBytes = options.backpressureThresholdBytes ?? 5 * 1024 * 1024;

    // Register gRPC service and message handler
    this.server.addService(PipeServiceService, {
      communicate: (stream: ServerDuplexStream<PipeMessage, PipeMessage>) => {
        const transport = new GrpcServerTransport(stream);
        const pipe = new PipeHandler<SendMap, ReceiveMap>(transport, undefined, {
          compression: this.compression,
          backpressureThresholdBytes: this.backpressureThresholdBytes,
        });

        this.emit('connection', pipe);

        // Initial handshake message to signal readiness
        stream.write({
          type: 'system_ready',
          payload: new Uint8Array(),
        });
      },
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
    this.server.bindAsync(
      `0.0.0.0:${this.options.port}`,
      ServerCredentials.createInsecure(),
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
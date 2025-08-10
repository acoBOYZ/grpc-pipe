import type { GrpcPipeServerEvents, GrpcPipeServerOptions } from './types.js';
import type { ServerDuplexStream } from '@grpc/grpc-js';

import {
  Server,
  ServerCredentials,
} from '@grpc/grpc-js';
import {
  GrpcServerTransport,
  PipeHandler,
  TypedEventEmitter,
  com
} from '@grpc-pipe/core';


/**
 * GrpcPipeServer is a high-level wrapper around a gRPC server that facilitates
 * real-time, bidirectional communication using the {@link PipeHandler} abstraction.
 *
 * It emits structured events when clients connect or disconnect, provides hooks for
 * authentication (`beforeConnect`) and initialization (`onConnect`), and supports
 * advanced transport features like compression, heartbeats, and backpressure.
 *
 * @template SendMap - The message types the server can send to clients.
 * @template ReceiveMap - The message types the server can receive from clients.
 */
export class GrpcPipeServer<SendMap, ReceiveMap, Ctx extends object = {}> extends TypedEventEmitter<GrpcPipeServerEvents<SendMap, ReceiveMap, Ctx>> {
  private static instance?: GrpcPipeServer<any, any, {}>;
  private server: Server;

  private streams = new Map<ServerDuplexStream<com.PipeMessage, com.PipeMessage>, PipeHandler<SendMap, ReceiveMap, Ctx>>();

  /**
   * Constructs a new {@link GrpcPipeServer}.
   *
   * @param options - Configuration for the server's behavior and transport.
   * @param options.port - The TCP port to listen on (e.g., `50500`).
   * @param options.beforeConnect - Optional hook to authenticate clients and return session context.
   * @param options.onConnect - Optional hook fired after `PipeHandler` is created but before `'connection'` is emitted.
   * @param options.tls - TLS credentials for secure connections. If omitted, server uses insecure transport.
   * @param options.serverOptions - Additional gRPC server/channel options (e.g., keepalive settings).
   * @param options.compression - Enables gzip compression for messages.
   * @param options.backpressureThresholdBytes - Buffer size before applying write backpressure.
   * @param options.heartbeat - Enable heartbeat pings (boolean or interval object).
   */
  constructor(private options: GrpcPipeServerOptions<SendMap, ReceiveMap, Ctx>) {
    super();

    if (GrpcPipeServer.instance) {
      GrpcPipeServer.instance.destroy().catch((err) => {
        console.warn('[GrpcPipeServer] ⚠️ Failed to shutdown previous gRPC instance:', err);
      });
    }

    GrpcPipeServer.instance = this;
    this.server = new Server(this.options.serverOptions);

    this.server.addService(com.PipeServiceService, {
      communicate: async (stream: ServerDuplexStream<com.PipeMessage, com.PipeMessage>) => {
        const existing = this.streams.get(stream);

        if (existing && !stream.destroyed && !stream.writableEnded) {
          console.warn('[GrpcPipeServer] Duplicate or stale stream detected — dropping.');
          stream.destroy();
          return;
        }

        const transport = new GrpcServerTransport(stream);
        const metadata = stream.metadata;
        let context: Ctx = {} as Ctx;
        if (this.options.beforeConnect) {
          try {
            const maybeCtx = await this.options.beforeConnect({
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

        let pipe: PipeHandler<SendMap, ReceiveMap, Ctx>;
        try {
          pipe = new PipeHandler<SendMap, ReceiveMap, Ctx>(
            transport,
            this.options.schema,
            this.options,
            context
          );
        } catch (err) {
          stream.destroy(err instanceof Error ? err : new Error('Pipe init failed'));
          return;
        }

        if (this.options.onConnect) {
          try {
            await this.options.onConnect(pipe);
          } catch (err) {
            stream.destroy(err instanceof Error ? err : new Error('onConnect failed'));
            return;
          }
        }

        pipe.onAny?.((type, data) => {
          this.emit('incoming', { type, data, pipe });
        });

        this.emit('connection', pipe);
        this.streams.set(stream, pipe);

        const handleDisconnect = () => {
          if (this.streams.has(stream)) {
            this.streams.delete(stream);
            this.emit('disconnected', pipe);
          }
          pipe.destroy();
        };

        stream.once('close', handleDisconnect);
        stream.once('end', handleDisconnect);
        stream.once('error', handleDisconnect);

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
        // `null` means use self-signed / non-root-verified certs
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

    try {
      this.server.bindAsync(
        `${this.options.host}:${this.options.port}`,
        creds,
        (err, port) => {
          if (err) {
            this.emit('error', err);
            return;
          }
          console.debug(`[GrpcPipeServer] Listening on ${this.options.host}:${port}`);
        }
      );
    } catch (err) {
      console.error('❌ Failed to bind gRPC server:', (err as Error).message);
      // No throw here!
    }
  }

  /**
   * Gracefully shuts down the gRPC server, destroys all active pipes,
   * removes all event listeners, and clears internal references.
   */
  public async destroy(): Promise<void> {
    return new Promise((resolve) => {
      for (const [stream, pipe] of this.streams.entries()) {
        try {
          stream.destroy();
          pipe.destroy();
          this.emit('disconnected', pipe);
        } catch (_) { /* ignored */ }
      }

      this.streams.clear();
      this.removeAllListeners();

      const shutdownTimeout = setTimeout(() => {
        console.warn('⚠️ Force shutting down gRPC server after timeout');
        this.server.forceShutdown();
        resolve();
      }, 5_000);

      this.server.tryShutdown((err) => {
        clearTimeout(shutdownTimeout);
        if (err) this.emit('error', err);
        resolve();
      });
    });
  }
}
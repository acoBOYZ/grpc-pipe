// src/server/GrpcPipeServer.ts
import { Server, ServerCredentials, type ServerDuplexStream } from '@grpc/grpc-js';
import { PipeHandler } from '../core/PipeHandler';
import { PipeMessage, PipeServiceService } from '../types/pipe';
import { GrpcServerTransport } from '../transports/GrpcServerTransport';
import { TypedEventEmitter } from '../core/TypedEventEmitter';

export interface GrpcPipeServerOptions {
  port: number;
  compression?: boolean;
  backpressureThresholdBytes?: number;
}

interface GrpcPipeServerEvents<SendMap, ReceiveMap> {
  connection: (pipe: PipeHandler<SendMap, ReceiveMap>) => void;
  error: (error: Error) => void;
  [key: string]: (...args: any[]) => void;
}

export class GrpcPipeServer<SendMap, ReceiveMap> extends TypedEventEmitter<GrpcPipeServerEvents<SendMap, ReceiveMap>> {
  private server: Server;
  private compression: boolean;
  private backpressureThresholdBytes: number;

  constructor(private options: GrpcPipeServerOptions) {
    super();
    this.server = new Server();

    this.compression = options.compression ?? false;
    this.backpressureThresholdBytes = options.backpressureThresholdBytes ?? 5 * 1024 * 1024;

    this.server.addService(PipeServiceService, {
      communicate: (stream: ServerDuplexStream<PipeMessage, PipeMessage>) => {
        const transport = new GrpcServerTransport(stream);
        const pipe = new PipeHandler<SendMap, ReceiveMap>(transport, undefined, {
          compression: this.compression,
          backpressureThresholdBytes: this.backpressureThresholdBytes,
        });
        this.emit('connection', pipe);

        stream.write({
          type: 'system_ready',
          payload: new Uint8Array(),
        });
      },
    });

    this.bind();
  }

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
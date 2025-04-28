// src/server/GrpcPipeServer.ts
import { EventEmitter } from 'events';
import { Server, ServerCredentials, type ServerDuplexStream } from '@grpc/grpc-js';
import { GrpcServerTransport } from '../transports/GrpcServerTransport';
import { PipeHandler } from '../core/PipeHandler';
import { PipeMessage, PipeServiceService } from '../types/pipe';

/**
 * Options to create a GrpcPipeServer
 */
export interface GrpcPipeServerOptions {
  port: number;
}

/**
 * GrpcPipeServer to accept client connections and create pipes
 */
export class GrpcPipeServer<SendMap, ReceiveMap> extends EventEmitter {
  private server: Server;

  constructor(private options: GrpcPipeServerOptions) {
    super();

    this.server = new Server();

    this.server.addService(PipeServiceService, {
      communicate: (stream: ServerDuplexStream<PipeMessage, PipeMessage>) => {
        const transport = new GrpcServerTransport(stream);
        const pipe = new PipeHandler<SendMap, ReceiveMap>(transport);
        this.emit('connection', pipe);

        stream.write({
          type: 'system_ready',
          payload: Buffer.from(JSON.stringify({ status: 'ok' })),
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
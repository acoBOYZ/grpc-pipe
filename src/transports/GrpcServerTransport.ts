// src/transports/GrpcServerTransport.ts

import type { Transport } from './Transport';
import type { ServerDuplexStream } from '@grpc/grpc-js';
import type { PipeMessage } from '../types';

/**
 * GrpcServerTransport wraps a gRPC server duplex stream
 * to provide Transport interface for server side.
 */
export class GrpcServerTransport implements Transport {
  private readonly stream: ServerDuplexStream<PipeMessage, PipeMessage>;

  constructor(stream: ServerDuplexStream<PipeMessage, PipeMessage>) {
    this.stream = stream;
  }

  public send(data: { type: string; data: Uint8Array }): void {
    this.stream.write({
      type: data.type,
      payload: data.data,
    });
  }

  public onMessage(callback: (data: { type: string; data: Uint8Array }) => void): void {
    this.stream.on('data', (pipeMessage: PipeMessage) => {
      callback({
        type: pipeMessage.type,
        data: pipeMessage.payload,
      });
    });
  }
}
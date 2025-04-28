// src/transports/GrpcClientTransport.ts

import type { Transport } from './Transport';
import type { ClientDuplexStream } from '@grpc/grpc-js';
import type { PipeMessage } from '../types';

/**
 * GrpcClientTransport wraps a gRPC client duplex stream
 * to provide Transport interface for client side.
 */
export class GrpcClientTransport implements Transport {
  private readonly stream: ClientDuplexStream<PipeMessage, PipeMessage>;

  constructor(stream: ClientDuplexStream<PipeMessage, PipeMessage>) {
    this.stream = stream;
  }

  public send(data: unknown): void {
    const message = data as { type: string; data: Uint8Array };
    
    // console.log(message)
    if (!message.type || typeof message.type !== 'string') {
      throw new Error('GrpcClientTransport.send: Missing or invalid type');
    }
    if (!(message.data instanceof Uint8Array)) {
      throw new Error('GrpcClientTransport.send: Missing or invalid payload Uint8Array');
    }

    this.stream.write({
      type: message.type,
      payload: message.data,
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
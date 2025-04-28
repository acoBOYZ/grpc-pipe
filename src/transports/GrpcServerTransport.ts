// src/transports/GrpcServerTransport.ts
// @ts-nocheck
import type { Transport } from './Transport';
import type { ServerDuplexStream } from '@grpc/grpc-js';
import type { PipeMessage } from '../types';

/**
 * GrpcServerTransport wraps a gRPC server duplex stream
 * to provide Transport interface for server side.
 */
export class GrpcServerTransport implements Transport {
  private readonly stream: ServerDuplexStream<PipeMessage, PipeMessage>;

  /**
   * @param stream - The gRPC server stream for communication
   */
  constructor(stream: ServerDuplexStream<PipeMessage, PipeMessage>) {
    this.stream = stream;
  }

  /**
   * Sends data to the client through the stream.
   * @param data - Data to send.
   */
  public send(data: unknown): void {
    const message = data as { type: string; data: any };
    this.stream.write({
      type: message.type,
      payload: Buffer.from(JSON.stringify(message.data)),
    });
  }

  /**
   * Sets a message handler for incoming client messages.
   * @param callback - Callback to handle incoming messages.
   */
  public onMessage(callback: (data: unknown) => void): void {
    this.stream.on('data', (pipeMessage: PipeMessage) => {
      const parsed = JSON.parse(pipeMessage.payload.toString());
      callback({ type: pipeMessage.type, data: parsed });
    });
  }
}
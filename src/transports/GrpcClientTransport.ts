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

  /**
   * @param stream - The gRPC client stream for communication
   */
  constructor(stream: ClientDuplexStream<PipeMessage, PipeMessage>) {
    this.stream = stream;
  }

  /**
   * Sends data to the server through the stream.
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
   * Sets a message handler for incoming server messages.
   * @param callback - Callback to handle incoming messages.
   */
  public onMessage(callback: (data: unknown) => void): void {
    this.stream.on('data', (pipeMessage: PipeMessage) => {
      if (pipeMessage.payload.length > 0) {
        try {
          const parsedData = JSON.parse(pipeMessage.payload.toString());
          callback({
            type: pipeMessage.type,
            data: parsedData,
          });
        } catch (err) {
          console.error('[GrpcClientTransport] Failed to parse incoming message:', err);
        }
      } else {
        console.warn('[GrpcClientTransport] Received empty payload, ignoring.');
      }
    });
  }
}
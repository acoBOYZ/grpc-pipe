import type { Transport } from './Transport.js';
import type { ClientDuplexStream } from '@grpc/grpc-js';
import type { PipeMessage } from '../com.js';

/**
 * GrpcClientTransport wraps a gRPC client duplex stream
 * and implements the {@link Transport} interface for client-side communication.
 *
 * It enables sending and receiving structured binary messages in the form of `PipeMessage`
 * over a bidirectional gRPC stream.
 */
export class GrpcClientTransport implements Transport {
  private readonly stream: ClientDuplexStream<PipeMessage, PipeMessage>;

  /**
   * Creates a new instance of GrpcClientTransport.
   *
   * @param stream - A gRPC client duplex stream capable of sending and receiving `PipeMessage` objects.
   */
  constructor(stream: ClientDuplexStream<PipeMessage, PipeMessage>) {
    this.stream = stream;
  }

  /**
   * Sends a message over the gRPC stream.
   *
   * Validates that the message contains a non-empty string `type` and a `Uint8Array` payload
   * before writing it to the stream.
   *
   * @param data - An object containing:
   *   - `type`: A string identifier for the message type.
   *   - `data`: The binary payload as a `Uint8Array`.
   * @throws Will throw an error if the `type` is missing/invalid or if `data` is not a `Uint8Array`.
   */
  public send(data: { type: string; data: Uint8Array }): void {    
    if (!data.type || typeof data.type !== 'string') {
      throw new Error('GrpcClientTransport.send: Missing or invalid type');
    }
    if (!(data.data instanceof Uint8Array)) {
      throw new Error('GrpcClientTransport.send: Missing or invalid payload Uint8Array');
    }

    this.stream.write({
      type: data.type,
      payload: data.data,
    });
  }

  /**
   * Registers a callback to be invoked whenever a message is received on the gRPC stream.
   *
   * @param callback - A function that receives a message object with:
   *   - `type`: The message type as a string.
   *   - `data`: The binary payload as a `Uint8Array`.
   */
  public onMessage(callback: (data: { type: string; data: Uint8Array }) => void): void {
    this.stream.on('data', (pipeMessage: PipeMessage) => {
      callback({
        type: pipeMessage.type,
        data: pipeMessage.payload,
      });
    });
  }
}
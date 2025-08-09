import type { Transport } from './Transport.js';
import type { ServerDuplexStream } from '@grpc/grpc-js';
import type { PipeMessage } from '../com.js';

/**
 * GrpcServerTransport wraps a gRPC server duplex stream
 * and implements the {@link Transport} interface for use on the server side.
 * 
 * It provides methods for sending and receiving structured binary messages
 * using the `PipeMessage` format over a gRPC stream.
 */
export class GrpcServerTransport implements Transport {
  private readonly stream: ServerDuplexStream<PipeMessage, PipeMessage>;

  /**
   * Creates a new instance of GrpcServerTransport.
   *
   * @param stream - A gRPC server duplex stream capable of reading and writing `PipeMessage` objects.
   */
  constructor(stream: ServerDuplexStream<PipeMessage, PipeMessage>) {
    this.stream = stream;
  }

  /**
   * Sends a message over the gRPC stream.
   *
   * @param data - An object containing the message `type` as a string and `data` as a `Uint8Array` payload.
   */
  public send(data: { type: string; data: Uint8Array }): void {
    if (!data?.type || typeof data.type !== 'string') {
      throw new Error('GrpcServerTransport.send: Missing or invalid type');
    }
    if (!(data.data instanceof Uint8Array)) {
      throw new Error('GrpcServerTransport.send: Missing or invalid payload Uint8Array');
    }

    // ❗ Synchronous write; do NOT attach 'drain' here.
    this.stream.write({ type: data.type, payload: data.data });
  }

  /**
   * Registers a callback to handle incoming messages on the gRPC stream.
   *
   * @param callback - A function that receives an object containing the message `type` and binary `data`.
   */
  public onMessage(callback: (data: { type: string; data: Uint8Array }) => void): void {
    this.stream.on('data', (pipeMessage: PipeMessage) => {
      callback({ type: pipeMessage.type, data: pipeMessage.payload });
    });
  }

  public onDrain(cb: () => void) {
    this.stream.once?.('drain', cb);
  }

  public getWritableInfo() {
    const s = this.stream;
    return {
      writableLength: typeof s.writableLength === 'number' ? s.writableLength : 0,
      writableNeedDrain: !!s.writableNeedDrain,
    };
  }
}
import type { Transport } from '../transports/Transport';
import type { SchemaRegistry } from '../schema/SchemaRegistry';
import os from 'os';
import { type queueAsPromised, promise as fastqPromise } from 'fastq';
import { compress, decompress } from '../utils/compression';

interface PipeHandlerOptions {
  /** Enable compression for outgoing messages. */
  compression?: boolean;
  /** Byte threshold for applying backpressure to outgoing messages. */
  backpressureThresholdBytes?: number;
}

/**
 * PipeHandler provides a typed abstraction over a duplex `Transport`,
 * managing schema-based encoding/decoding, optional compression, message queuing,
 * and backpressure.
 *
 * @template SendMap - Message types the handler can send.
 * @template ReceiveMap - Message types the handler can receive.
 */
export class PipeHandler<SendMap, ReceiveMap> {
  protected queue: queueAsPromised<{ type: keyof ReceiveMap; data: ReceiveMap[keyof ReceiveMap] }>;
  protected callbacks: {
    [K in keyof ReceiveMap]?: ((data: ReceiveMap[K]) => void | Promise<void>)[];
  } = {};

  private ready: Promise<void>;
  private resolveReady!: () => void;
  private readyResolved = false;

  private postQueue: (() => Promise<void>)[] = [];
  private draining = false;

  private compressionEnabled: boolean;
  private backpressureThresholdBytes: number;

  /**
   * Creates a new PipeHandler instance.
   *
   * @param transport - The underlying transport to send and receive messages through.
   * @param schema - Optional schema registry to encode/decode messages.
   * @param options - Configuration options such as compression and backpressure settings.
   */
  constructor(
    protected transport: Transport,
    private schema?: SchemaRegistry<SendMap, ReceiveMap>,
    options: PipeHandlerOptions = {},
  ) {
    this.compressionEnabled = options.compression ?? false;
    this.backpressureThresholdBytes = options.backpressureThresholdBytes ?? 5 * 1024 * 1024;

    if (schema) {
      this.ready = new Promise((resolve) => {
        this.resolveReady = resolve;
      });
    } else {
      this.readyResolved = true;
      this.ready = Promise.resolve();
      this.resolveReady = () => {};
    }

    this.queue = fastqPromise(this, this.process.bind(this), os.cpus().length);

    this.transport.onMessage((message: unknown) => {
      if (this.isValidMessage(message)) {
        if (typeof message.type === 'string' && message.type.startsWith('system_')) {
          return;
        }
        this.routeMessage(message);
      } else {
        console.error('Invalid message received:', message);
      }
    });
  }

  /**
   * Registers a schema registry for message encoding and decoding.
   * Resolves any schema wait-pending operations.
   *
   * @param schema - A schema registry.
   */
  public useSchema(schema: SchemaRegistry<SendMap, ReceiveMap>) {
    this.schema = schema;
    if (!this.readyResolved) {
      this.resolveReady();
      this.readyResolved = true;
    }
  }

  /**
   * Registers a callback for a specific message type.
   *
   * @param type - The message type to listen for.
   * @param callback - The handler to invoke on receiving that message.
   */
  public on<T extends keyof ReceiveMap>(type: T, callback: (data: ReceiveMap[T]) => void | Promise<void>) {
    if (!this.callbacks[type]) {
      this.callbacks[type] = [];
    }
    this.callbacks[type]!.push(callback);
  }

  /**
   * Removes a previously registered callback for a given message type.
   *
   * @param type - The message type.
   * @param callback - The specific callback to remove.
   */
  public off<T extends keyof ReceiveMap>(type: T, callback: (data: ReceiveMap[T]) => void | Promise<void>) {
    const handlers = this.callbacks[type];
    if (handlers) {
      const index = handlers.indexOf(callback);
      if (index !== -1) handlers.splice(index, 1);
    }
  }

  /**
   * Sends a message of a specified type and payload, with optional schema encoding and compression.
   * If the transport's write buffer exceeds the backpressure threshold, the message is queued.
   *
   * @param type - Message type key.
   * @param data - Data payload corresponding to the type.
   */
  public async post<T extends keyof SendMap>(type: T, data: SendMap[T]) {
    await this.ready;

    const task = async () => {
      let payload = this.schema
        ? this.schema.send[type].encode(data).finish()
        : Buffer.from(JSON.stringify(data));

      if (this.compressionEnabled) {
        payload = await compress(payload);
      }

      this.transport.send({ type, data: payload });
    };

    if (this.getPendingBytes() >= this.backpressureThresholdBytes) {
      await new Promise<void>((resolve) => {
        this.postQueue.push(async () => {
          await task();
          resolve();
        });
      });
    } else {
      await task();
    }
  }

  /**
   * Routes an incoming message to the appropriate event handlers.
   * Also manages post-send backpressure draining.
   *
   * @param message - The message object with `type` and raw `data`.
   */
  protected async routeMessage(message: { type: keyof ReceiveMap; data: any }) {
    this.emit(message.type, message.data);

    if (!this.draining && this.postQueue.length > 0) {
      this.draining = true;
      while (this.postQueue.length > 0 && this.getPendingBytes() < this.backpressureThresholdBytes) {
        const next = this.postQueue.shift();
        if (next) {
          await next();
        }
      }
      this.draining = false;
    }
  }

  /**
   * Emits a message to the registered callbacks after decoding and decompression.
   *
   * @param type - Message type key.
   * @param payload - Raw binary payload.
   */
  protected emit<T extends keyof ReceiveMap>(type: T, payload: any) {
    let data: ReceiveMap[T];
    let raw = payload;

    if (this.compressionEnabled) {
      raw = decompress(payload);
    }

    data = this.schema
      ? this.schema.receive[type].decode(raw)
      : JSON.parse(raw.toString());

    this.queue.push({ type, data });
  }

  /**
   * Executes registered handlers for a specific message.
   *
   * @param message - Contains message type and decoded data.
   */
  private async process({ type, data }: { type: keyof ReceiveMap; data: ReceiveMap[keyof ReceiveMap] }) {
    const handlers = this.callbacks[type];
    if (handlers) {
      for (const handler of handlers) {
        await handler(data);
      }
    }
  }

  /**
   * Returns the current number of bytes buffered in the writable stream.
   */
  private getPendingBytes(): number {
    const stream = (this.transport as any).stream;
    if (stream && typeof stream.writableLength === 'number') {
      return stream.writableLength;
    }
    return 0;
  }

  /**
   * Checks whether a given object is a valid message structure.
   *
   * @param message - The unknown object to validate.
   * @returns `true` if the object has the required structure.
   */
  private isValidMessage(message: unknown): message is { type: keyof ReceiveMap; data: any } {
    return (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      'data' in message
    );
  }
}
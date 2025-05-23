import type { Transport } from '../transports/Transport';
import type { SchemaRegistry } from '../schema/SchemaRegistry';
import os from 'os';
import { type queueAsPromised, promise as fastqPromise } from 'fastq';
import { compress, decompress } from '../utils/compression';

/**
 * Configuration options for {@link PipeHandler}.
 */
export interface PipeHandlerOptions {
  /**
   * Enables compression for outgoing messages using gzip.
   * If set to `true`, messages will be compressed before sending.
   */
  compression?: boolean;

  /**
   * Applies backpressure if the transport's write buffer exceeds the given byte size.
   * Prevents memory overflow by queuing messages when the limit is reached.
   * 
   * @default 5 * 1024 * 1024 (5MB)
   */
  backpressureThresholdBytes?: number;

  /**
   * Enables automatic heartbeat messages to ensure connection liveness.
   *
   * - If set to `true`, uses the default interval of 5000ms.
   * - If set to an object, you can customize the interval using `intervalMs`.
   * - If set to `false` or omitted, heartbeats are disabled.
   *
   * @example
   * heartbeat: { intervalMs: 10000 }
   */
  heartbeat?: boolean | { intervalMs?: number };
}

/**
 * PipeHandler provides a typed abstraction over a duplex {@link Transport},
 * handling schema-based message encoding/decoding, optional gzip compression,
 * asynchronous backpressure-aware posting, and message event dispatching.
 *
 * @template SendMap - The shape of messages that can be sent by this handler.
 * @template ReceiveMap - The shape of messages that can be received.
 * @template Context - Optional session context tied to this handler instance.
 */
export class PipeHandler<SendMap, ReceiveMap, Context extends object = {}> {
  protected queue: queueAsPromised<{ type: keyof ReceiveMap; data: ReceiveMap[keyof ReceiveMap] }>;
  protected callbacks: {
    [K in keyof ReceiveMap]?: ((data: ReceiveMap[K]) => void | Promise<void>)[];
  } = {};

  private ready: Promise<void>;
  private resolveReady!: () => void;
  private readyResolved = false;

  private globalListener?: <T extends keyof ReceiveMap>(type: T, data: ReceiveMap[T]) => void;
  private postQueue: (() => Promise<void>)[] = [];
  private draining = false;

  private compressionEnabled: boolean;
  private backpressureThresholdBytes: number;
  private heartbeatTimeout?: NodeJS.Timeout;

  /**
   * Creates a new instance of {@link PipeHandler}.
   *
   * @param transport - The duplex transport layer used for sending and receiving messages.
   * @param schema - Optional schema registry for protobuf-based message serialization.
   * @param options - Configuration options for compression, heartbeat, and backpressure.
   * @param context - Optional custom context that will be attached to the instance.
   */
  constructor(
    protected transport: Transport,
    private schema?: SchemaRegistry<SendMap, ReceiveMap>,
    options: PipeHandlerOptions = {},
    public readonly context?: Context,
  ) {
    this.context = context ?? ({} as Context);
    this.compressionEnabled = options.compression ?? false;
    this.backpressureThresholdBytes = options.backpressureThresholdBytes ?? 5 * 1024 * 1024;

    if (schema) {
      this.ready = new Promise((resolve) => {
        this.resolveReady = resolve;
      });
      this.useSchema(schema);
    } else {
      this.readyResolved = true;
      this.ready = Promise.resolve();
      this.resolveReady = () => { };
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

    if (options.heartbeat) {
      const intervalMs =
        typeof options.heartbeat === 'object'
          ? options.heartbeat.intervalMs ?? 5000
          : 5000;

      this.heartbeatTimeout = setInterval(() => {
        this.transport.send({
          type: 'system_heartbeat',
          data: new Uint8Array(),
        });

        if (this.onHeartbeat) {
          this.onHeartbeat();
        }

        if (process.env.DEBUG?.includes('pipe:heartbeat')) {
          console.log(`[PipeHandler] Sent heartbeat at ${new Date().toISOString()}`);
        }
      }, intervalMs);
    }
  }

  /**
   * Registers a schema registry after construction.
   * Useful when schema setup is asynchronous or deferred.
   *
   * @param schema - A {@link SchemaRegistry} containing encoders/decoders for all message types.
   */
  private useSchema(schema: SchemaRegistry<SendMap, ReceiveMap>) {
    this.schema = schema;
    if (!this.readyResolved) {
      this.resolveReady();
      this.readyResolved = true;
    }
  }

  /** Indicates whether the handler is ready. */
  public get isReady() {
    return this.readyResolved;
  }

  /**
   * Indicates the serialization format currently in use.
   *
   * - `'protobuf'`: A schema has been registered via `useSchema()` or constructor.
   * - `'json'`: Fallback mode using plain JSON encoding/decoding.
   */
  public get serialization(): 'protobuf' | 'json' {
    return this.schema ? 'protobuf' : 'json';
  }

  public onAny(listener: (type: keyof ReceiveMap, data: ReceiveMap[keyof ReceiveMap]) => void): void {
    this.globalListener = listener;
  }

  /**
   * Subscribes to messages of a specific type.
   * Multiple callbacks may be registered for a given type.
   *
   * @param type - The message type key to listen for.
   * @param callback - Function to handle the decoded message data.
   */
  public on<T extends keyof ReceiveMap>(type: T, callback: (data: ReceiveMap[T]) => void | Promise<void>) {
    if (!this.callbacks[type]) {
      this.callbacks[type] = [];
    }
    this.callbacks[type]!.push(callback);
  }

  /**
   * Unsubscribes a specific callback from a message type.
   *
   * @param type - The message type.
   * @param callback - The handler function to remove.
   */
  public off<T extends keyof ReceiveMap>(type: T, callback: (data: ReceiveMap[T]) => void | Promise<void>) {
    const handlers = this.callbacks[type];
    if (handlers) {
      const index = handlers.indexOf(callback);
      if (index !== -1) handlers.splice(index, 1);
    }
  }

  /**
   * Sends a message of the given type with the provided payload.
   *
   * - Applies compression if enabled.
   * - Uses schema encoding if available.
   * - Applies backpressure when write buffer exceeds threshold.
   *
   * @param type - The message type key.
   * @param data - The payload to send for the message type.
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
   * Optional hook invoked every time a heartbeat is sent.
   * Can be used to log or trigger custom behavior.
   */
  public onHeartbeat?: () => void;

  /** Returns true if transport is under backpressure */
  public get isBackpressured(): boolean {
    return this.getPendingBytes() >= this.backpressureThresholdBytes;
  }

  /**
   * Stops the automatic heartbeat mechanism (if active).
   * Use this when tearing down a connection intentionally.
   */
  public destroyHeartBeat() {
    if (this.heartbeatTimeout) {
      clearInterval(this.heartbeatTimeout);
    }
  }

  /**
   * Fully cleans up internal state: stops heartbeat, clears queues, detaches listeners.
   * Should be called on disconnect or shutdown.
   */
  public destroy(): void {
    this.destroyHeartBeat();
    this.callbacks = {};
    this.postQueue.length = 0;
    this.queue.kill?.();
  }

  /**
   * Routes an incoming raw message to the correct handler(s).
   * Also drains the post-send backpressure queue if needed.
   *
   * @param message - An object containing a `type` and raw `data`.
   */
  protected async routeMessage(message: { type: keyof ReceiveMap; data: any }) {
    this.emit(message.type, message.data);

    if (!this.draining && this.postQueue.length > 0) {
      this.draining = true;
      while (this.postQueue.length > 0 && this.isBackpressured) {
        const next = this.postQueue.shift();
        if (next) {
          await next();
        }
      }
      this.draining = false;
    }
  }

  /**
   * Decodes, decompresses (if enabled), and dispatches a message to registered listeners.
   *
   * @param type - The message type.
   * @param payload - Raw binary data received from transport.
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

    this.globalListener?.(type, data);
    this.queue.push({ type, data });
  }

  /**
   * Internal fastq task that executes all handlers for a given message.
   *
   * @param message - The fully decoded message with type and data.
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
   * Returns the number of bytes buffered for writing on the underlying stream.
   * Used for applying backpressure when needed.
   */
  private getPendingBytes(): number {
    const stream = (this.transport as any).stream;
    if (stream && typeof stream.writableLength === 'number') {
      return stream.writableLength;
    }
    return 0;
  }

  /**
   * Validates the structure of an incoming message object.
   * Ensures it contains both `type` and `data` keys.
   *
   * @param message - The unknown object to validate.
   * @returns `true` if the message is structurally valid.
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
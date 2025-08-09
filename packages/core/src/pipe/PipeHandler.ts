import type { Transport } from '../transports/Transport.js';
import type { SchemaRegistry } from '../schema/SchemaRegistry.js';
import type { PipeHandlerOptions } from './types.js';

import os from 'os';
import { type queueAsPromised, promise as fastqPromise } from 'fastq';
import { compress, decompress } from '../utils/compression.js';
import { dlog } from '../utils/debug.js';
import { Deque } from './Deque.js';

/**
 * PipeHandler provides a typed abstraction over a duplex {@link Transport}.
 *
 * It manages:
 * - **Schema-aware serialization** (Protobuf via {@link SchemaRegistry} or JSON fallback)
 * - **Optional gzip compression** for outbound payloads
 * - **Backpressure detection** with an internal message queue
 * - **Application-level in-flight throttling** for request/response flows
 * - **Async processing queue** for incoming messages
 * - **Heartbeat messages** for connection liveness
 *
 * @template SendMap - Outgoing message types and payload shapes.
 * @template ReceiveMap - Incoming message types and payload shapes.
 * @template Context - Optional user-defined context bound to this handler.
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
  private postQueue = new Deque<() => void>();

  private compressionEnabled: boolean;
  private backpressureThresholdBytes: number;
  private heartbeatTimeout?: NodeJS.Timeout;
  private pumping = false;
  private maxInFlight?: number;
  private inFlight = 0;
  private releaseOn = new Set<string>();

  /**
   * Creates a new instance of {@link PipeHandler}.
   *
   * @param transport - The underlying duplex transport (e.g., TCP, IPC, WebSocket).
   * @param schema - Optional {@link SchemaRegistry} for Protobuf-based serialization.
   * @param options - Configuration flags for compression, backpressure, heartbeat, and in-flight gating.
   * @param context - Optional application context bound to this instance.
   *
   * @example
   * const handler = new PipeHandler(
   *   new WebSocketTransport(ws),
   *   schemaRegistry,
   *   {
   *     compression: true,
   *     backpressureThresholdBytes: 4 * 1024 * 1024,
   *     heartbeat: { intervalMs: 10_000 },
   *     maxInFlight: 256,
   *     releaseOn: ['pong', 'ack']
   *   },
   *   { userId: 123 }
   * );
   */
  constructor(
    protected transport: Transport,
    private schema?: SchemaRegistry<SendMap, ReceiveMap>,
    options: PipeHandlerOptions<ReceiveMap> = {},
    public readonly context?: Context,
  ) {
    this.context = context ?? ({} as Context);
    this.compressionEnabled = options.compression ?? false;
    this.backpressureThresholdBytes = options.backpressureThresholdBytes ?? 5 * 1024 * 1024;
    this.maxInFlight = options.maxInFlight;
    if (options.releaseOn) {
      for (const t of options.releaseOn) this.releaseOn.add(String(t));
    }

    if (schema) {
      this.ready = new Promise((resolve) => (this.resolveReady = resolve));
      this.useSchema(schema);
    } else {
      this.readyResolved = true;
      this.ready = Promise.resolve();
      this.resolveReady = () => { };
    }

    this.queue = fastqPromise(this, this.process.bind(this), Math.floor(os.cpus().length / 2));

    this.transport.onMessage((message: unknown) => {
      if (this.isValidMessage(message)) {
        if (typeof message.type === 'string' && message.type.startsWith('system_')) return;
        this.routeMessage(message);
      } else {
        dlog('pipe:warn', `Invalid message received: ${message}`);
      }
    });

    if (options.heartbeat) {
      const intervalMs = typeof options.heartbeat === 'object'
        ? options.heartbeat.intervalMs ?? 5000
        : 5000;

      this.heartbeatTimeout = setInterval(() => {
        void this.transport.send({ type: 'system_heartbeat', data: new Uint8Array() });
        this.onHeartbeat?.();
      }, intervalMs);
    }
  }

  /**
   * Whether this handler has completed its initialization and is ready to send messages.
   *
   * @remarks
   * - If a schema is provided, `isReady` becomes `true` only after the schema is registered.
   * - Useful for delaying posts until serialization is available.
   */
  public get isReady() {
    return this.readyResolved;
  }

  /**
   * Returns the serialization mode in use:
   *
   * - `'protobuf'` → Using {@link SchemaRegistry} for encoding/decoding.
   * - `'json'` → Fallback to JSON.stringify / JSON.parse.
   */
  public get serialization(): 'protobuf' | 'json' {
    return this.schema ? 'protobuf' : 'json';
  }

  /**
   * Registers a **global listener** invoked for every decoded message
   * before any type-specific handlers.
   *
   * @param listener - `(type, data) => void`
   */
  public onAny(listener: (type: keyof ReceiveMap, data: ReceiveMap[keyof ReceiveMap]) => void): void {
    this.globalListener = listener;
  }

  /**
   * Subscribe to a specific message type.
   *
   * @param type - Message type to listen for.
   * @param callback - Handler for that message type.
   */
  public on<T extends keyof ReceiveMap>(type: T, callback: (data: ReceiveMap[T]) => void | Promise<void>) {
    if (!this.callbacks[type]) this.callbacks[type] = [];
    this.callbacks[type]!.push(callback);
  }

  /**
   * Unsubscribe a previously registered handler for a specific type.
   *
   * @param type - Message type.
   * @param callback - Exact function reference to remove.
   */
  public off<T extends keyof ReceiveMap>(type: T, callback: (data: ReceiveMap[T]) => void | Promise<void>) {
    const arr = this.callbacks[type];
    if (!arr) return;
    const i = arr.indexOf(callback);
    if (i !== -1) arr.splice(i, 1);
  }

  /**
   * Sends a message of the given type and payload.
   *
   * - Encodes with Protobuf if a schema is registered, otherwise falls back to JSON.
   * - Compresses payload with gzip if enabled.
   * - Respects application-level in-flight gating if `maxInFlight` is set.
   * - Respects transport-level backpressure if no in-flight limit is set.
   *
   * @remarks
   * - If `maxInFlight` is reached, the message is queued until a `releaseOn` type arrives.
   * - System messages (`system_*`) bypass in-flight gating.
   *
   * @param type - Outgoing message type.
   * @param data - Outgoing payload.
   *
   * @example
   * handler.post('ping', { id: 123 });
   */
  public post<T extends keyof SendMap>(type: T, data: SendMap[T]): void {
    if (!this.readyResolved) { this.ready.then(() => this.post(type, data)); return; }

    const nonSystem = typeof type === 'string' && !type.startsWith('system_');
    if (this.maxInFlight && nonSystem && this.inFlight >= this.maxInFlight) {
      const task = () => this._sendNow(type, data);
      this.postQueue.push(task);
      if (!this.pumping) this.schedulePump();
      return;
    }

    this._sendNow(type, data);

    if (this.isPressured() && this.postQueue.length > 0 && !this.pumping) this.schedulePump();
  }

  /**
   * Encodes (and optionally compresses) then sends the message immediately.
   *
   * @internal
   * @remarks
   * - If `maxInFlight` is configured and the message is **non-system**, this
   *   increments `inFlight` **before** attempting to send.
   * - Compression is performed asynchronously; we don't block the caller and
   *   send the compressed payload when ready.
   * - On synchronous send failure, in-flight count is rolled back.
   *
   * @param type - Outgoing message type (string keys supported).
   * @param data - Outgoing payload (protobuf/JSON).
   */
  private _sendNow<T extends keyof SendMap>(type: T, data: SendMap[T]) {
    const nonSystem = typeof type === 'string' && !type.startsWith('system_');
    if (this.maxInFlight && nonSystem) this.inFlight++;

    try {
      let payload = this.schema
        ? this.schema.send[type].encode(data).finish()
        : Buffer.from(JSON.stringify(data));

      if (this.compressionEnabled) {
        compress(payload).then((pz) => this.transport.send({ type: String(type), data: pz }));
        return;
      }
      this.transport.send({ type: String(type), data: payload });
    } catch {
      if (this.maxInFlight && nonSystem) this.inFlight = Math.max(0, this.inFlight - 1);
    }
  }


  /**
   * Optional hook fired every time a heartbeat message is sent.
   */
  public onHeartbeat?: () => void;

  /**
   * Whether the transport is currently experiencing backpressure.
   *
   * @remarks
   * This reflects transport-level buffering — independent of `maxInFlight`.
   */
  public get isBackpressured(): boolean {
    return this.isPressured();
  }

  /**
   * Stops automatic heartbeat messages.
   *
   * @remarks
   * Call this when shutting down or intentionally closing a connection.
   */
  public destroyHeartBeat() {
    if (this.heartbeatTimeout) clearInterval(this.heartbeatTimeout);
  }

  /**
   * Fully destroys the handler:
   * - Stops heartbeat
   * - Clears message queues
   * - Removes all listeners
   */
  public destroy(): void {
    this.destroyHeartBeat();
    this.callbacks = {};
    this.postQueue.kill();
    this.queue.kill?.();
  }

  /**
   * Registers the provided schema and resolves the handler's readiness.
   *
   * @internal
   * @remarks
   * - Called once during construction when a schema is passed.
   * - Resolves the internal `ready` promise so `post()` can encode using protobuf.
   */
  private useSchema(schema: SchemaRegistry<SendMap, ReceiveMap>) {
    this.schema = schema;
    if (!this.readyResolved) {
      this.resolveReady();
      this.readyResolved = true;
    }
  }

  /**
   * Kicks off the self-pump loop for the outbound queue (`postQueue`).
   *
   * @internal
   * @remarks
   * - Ensures only one pump is active at a time via `this.pumping`.
   * - Schedules ticks with `setImmediate` to avoid starving the event loop.
   * - Does **not** rely on stream `'drain'`; pump policy is decided in `pumpOnce()`.
   */
  private schedulePump() {
    if (this.pumping) return;
    this.pumping = true;
    const tick = () => {
      this.pumpOnce().finally(() => {
        if (this.postQueue.length > 0) {
          setImmediate(tick);
        } else {
          this.pumping = false;
        }
      });
    };
    setImmediate(tick);
  }

  /**
   * Attempts to flush queued outbound tasks under current gating rules.
   *
   * @internal
   * @remarks
   * Flush conditions (loop continues while all are satisfied):
   *  1) There is at least one queued task (`postQueue.length > 0`)
   *  2) If an app window is set (`maxInFlight`), we have available slots
   *     (`inFlight < maxInFlight`)
   *  3) If NO app window is set, transport is not pressure-signaled
   *     (`!isPressured()`). With `maxInFlight` set, transport pressure is ignored
   *     so we rely purely on app-level gating.
   *
   * The queue holds **thunks** (no args) that perform: encode → (optional) compress → send.
   * Any synchronous error in a task simply breaks the flush loop to avoid tight retry.
   */
  private async pumpOnce() {
    while (this.postQueue.length > 0) {
      if (this.maxInFlight && this.inFlight >= this.maxInFlight) break;
      if (!this.maxInFlight && this.isPressured()) break;

      const next = this.postQueue.shift();
      if (!next) break;
      try { next(); } catch { break; }
    }
  }

  /**
   * Routes an incoming raw message (type, binary payload) into the decode path.
   *
   * @internal
   * @remarks
   * - Skips scheduling if nothing is queued; otherwise re-arms the pump so
   *   responses can release in-flight slots and allow queued posts to proceed.
   * - Delegates actual decode + dispatch to {@link emit}.
   */
  protected async routeMessage(message: { type: keyof ReceiveMap; data: any }) {
    this.emit(message.type, message.data);

    if (this.postQueue.length > 0 && !this.pumping) {
      this.schedulePump();
    }
  }

  /**
   * Decodes an incoming payload, invokes global and per-type handlers,
   * and manages in-flight release.
   *
   * @internal
   * @remarks
   * - If compression is enabled, the payload is decompressed first.
   * - If a schema exists, uses it to decode; otherwise falls back to JSON.parse.
   * - If `maxInFlight` is configured and the message type appears in `releaseOn`,
   *   this decrements the `inFlight` counter and (if backlog exists) tries to
   *   resume the pump.
   *
   * @param type - Decoded message type.
   * @param payload - Raw binary payload (Uint8Array/Buffer-like).
   */
  protected emit<T extends keyof ReceiveMap>(type: T, payload: any) {
    let raw = this.compressionEnabled ? decompress(payload) : payload;

    let data: ReceiveMap[T];
    if (this.schema) {
      const entry = this.schema.receive[type];
      if (!entry) {
        dlog('pipe:schema', `missing schema.receive for "${String(type)}" (drop)`);
        return;
      }
      data = entry.decode(raw);
    } else {
      // data = JSON.parse(Buffer.isBuffer(raw) ? raw.toString() : Buffer.from(raw).toString());
      const asBuf = (raw instanceof Uint8Array) ? Buffer.from(raw) : raw;
      data = JSON.parse(Buffer.isBuffer(asBuf) ? asBuf.toString() : String(asBuf));
    }

    this.globalListener?.(type, data);
    if (this.maxInFlight && this.releaseOn.has(String(type))) {
      this.inFlight = Math.max(0, this.inFlight - 1);
      if (this.postQueue.length > 0 && !this.pumping) this.schedulePump();
    }
    this.queue.push({ type, data });
  }

  /**
   * Processes a decoded message by invoking all registered handlers for that type.
   *
   * @internal
   * @remarks
   * - Handlers may be `async`; they are awaited in registration order.
   * - Failures in a handler do not stop other handlers for the same type.
   *
   * @param param0 - Object with `type` and decoded `data`.
   */
  private async process({ type, data }: { type: keyof ReceiveMap; data: ReceiveMap[keyof ReceiveMap] }) {
    const handlers = this.callbacks[type];
    if (!handlers) return;

    for (const handler of handlers)
      await handler(data);
  }

  /**
   * Returns the current number of bytes pending in the underlying transport’s write buffer.
   *
   * @internal
   * @remarks
   * - Uses `transport.getWritableInfo()` if available.
   * - When unavailable, returns 0 so backpressure decisions fall back to in-flight rules.
   */
  private getPendingBytes(): number {
    const info = this.transport.getWritableInfo?.();
    return info?.writableLength ?? 0;
  }

  /**
   * Indicates whether the transport layer reports backpressure.
   *
   * @internal
   * @remarks
   * - True when the transport signals `writableNeedDrain` or when the pending
   *   bytes exceed `backpressureThresholdBytes`.
   * - Ignored by the pump when `maxInFlight` is set (app-level window takes precedence).
   */
  private isPressured(): boolean {
    const info = this.transport.getWritableInfo?.();
    if (!info) return false;
    return info.writableNeedDrain || this.getPendingBytes() >= this.backpressureThresholdBytes;
  }

  private isValidMessage(message: unknown): message is { type: keyof ReceiveMap; data: any } {
    return typeof message === 'object' && message !== null && 'type' in message && 'data' in message;
  }
}
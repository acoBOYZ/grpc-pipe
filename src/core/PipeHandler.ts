// src/core/PipeHandler.ts
import type { Transport } from '../transports/Transport';
import type { SchemaRegistry } from '../schema/SchemaRegistry';
import os from 'os';
import { type queueAsPromised, promise as fastqPromise } from 'fastq';
import { compress, decompress } from '../utils/compression';

interface PipeHandlerOptions {
  compression?: boolean;
  backpressureThresholdBytes?: number;
}

export class PipeHandler<SendMap, ReceiveMap> {
  protected queue: queueAsPromised<{ type: keyof ReceiveMap; data: ReceiveMap[keyof ReceiveMap] }>;
  protected callbacks: { [K in keyof ReceiveMap]?: ((data: ReceiveMap[K]) => void | Promise<void>)[] } = {};

  private ready: Promise<void>;
  private resolveReady!: () => void;
  private readyResolved = false;

  private postQueue: (() => Promise<void>)[] = [];
  private draining = false;

  private compressionEnabled: boolean;
  private backpressureThresholdBytes: number;

  constructor(
    protected transport: Transport,
    private schema?: SchemaRegistry<SendMap, ReceiveMap>,
    options: PipeHandlerOptions = {},
  ) {
    this.compressionEnabled = options.compression ?? false;
    this.backpressureThresholdBytes = options.backpressureThresholdBytes ?? 5 * 1024 * 1024; // 5MB default

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

  public useSchema(schema: SchemaRegistry<SendMap, ReceiveMap>) {
    this.schema = schema;
    if (!this.readyResolved) {
      this.resolveReady();
      this.readyResolved = true;
    }
  }

  public on<T extends keyof ReceiveMap>(type: T, callback: (data: ReceiveMap[T]) => void | Promise<void>) {
    if (!this.callbacks[type]) {
      this.callbacks[type] = [];
    }
    this.callbacks[type]!.push(callback);
  }

  public off<T extends keyof ReceiveMap>(type: T, callback: (data: ReceiveMap[T]) => void | Promise<void>) {
    const handlers = this.callbacks[type];
    if (handlers) {
      const index = handlers.indexOf(callback);
      if (index !== -1) handlers.splice(index, 1);
    }
  }

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

  protected emit<T extends keyof ReceiveMap>(type: T, payload: any) {
    let data: ReceiveMap[T];
    let raw = payload;

    if (this.compressionEnabled) {
      raw = decompress(payload);
    }

    if (this.schema) {
      data = this.schema.receive[type].decode(raw);
    } else {
      data = JSON.parse(raw.toString());
    }
    this.queue.push({ type, data });
  }

  private async process({ type, data }: { type: keyof ReceiveMap; data: ReceiveMap[keyof ReceiveMap] }) {
    const handlers = this.callbacks[type];
    if (handlers) {
      for (const handler of handlers) {
        await handler(data);
      }
    }
  }

  private getPendingBytes(): number {
    const stream = (this.transport as any).stream;
    if (stream && typeof stream.writableLength === 'number') {
      return stream.writableLength;
    }
    return 0;
  }

  private isValidMessage(message: unknown): message is { type: keyof ReceiveMap; data: any } {
    return (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      'data' in message
    );
  }
}
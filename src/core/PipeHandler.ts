// src/core/PipeHandler.ts
import type { Transport } from '../transports/Transport';
import type { SchemaRegistry } from '../schema/SchemaRegistry';
import os from 'os';
import { type queueAsPromised, promise as fastqPromise } from 'fastq';

export class PipeHandler<SendMap, ReceiveMap> {
  protected queue: queueAsPromised<{ type: keyof ReceiveMap; data: ReceiveMap[keyof ReceiveMap] }>;
  protected callbacks: { [K in keyof ReceiveMap]?: ((data: ReceiveMap[K]) => void | Promise<void>)[] } = {};

  private ready: Promise<void>;
  private resolveReady!: () => void;
  private readyResolved = false;

  constructor(
    protected transport: Transport,
    private schema?: SchemaRegistry<SendMap, ReceiveMap>
  ) {
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
    const payload = this.schema
      ? this.schema.send[type].encode(data).finish()
      : Buffer.from(JSON.stringify(data));

    this.transport.send({ type, data: payload });
  }

  protected routeMessage(message: { type: keyof ReceiveMap; data: any }) {
    this.emit(message.type, message.data);
  }

  protected emit<T extends keyof ReceiveMap>(type: T, payload: any) {
    let data: ReceiveMap[T];
    if (this.schema) {
      data = this.schema.receive[type].decode(payload);
    } else {
      data = JSON.parse(payload.toString());
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

  /**
   * Type guard to validate incoming messages at runtime.
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
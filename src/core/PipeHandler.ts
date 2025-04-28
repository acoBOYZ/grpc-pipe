import type { Transport } from '../transports/Transport';
import os from 'os';
import { type queueAsPromised, promise as fastqPromise } from 'fastq';

export class PipeHandler<SendMap, ReceiveMap> {
  protected queue: queueAsPromised<{ type: keyof ReceiveMap; data: ReceiveMap[keyof ReceiveMap] }>;
  protected callbacks: { [K in keyof ReceiveMap]?: ((data: ReceiveMap[K]) => void | Promise<void>)[] } = {};

  constructor(protected transport: Transport) {
    this.queue = fastqPromise(this, this.process.bind(this), os.cpus().length);

    this.transport.onMessage((message: unknown) => {
      if (this.isValidMessage(message)) {
        this.routeMessage(message);
      } else {
        console.error('Invalid message received:', message);
      }
    });
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

  public post<T extends keyof SendMap>(type: T, data: SendMap[T]) {
    this.transport.send({ type, data });
  }

  protected routeMessage(message: { type: keyof ReceiveMap; data: any }) {
    this.emit(message.type, message.data);
  }

  protected emit<T extends keyof ReceiveMap>(type: T, data: ReceiveMap[T]) {
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
   * @param message - The message received.
   * @returns True if the message has type and data fields.
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
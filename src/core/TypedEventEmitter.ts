// src/core/TypedEventEmitter.ts
import { EventEmitter } from 'events';

/**
 * A type-safe EventEmitter wrapper.
 */
export class TypedEventEmitter<Events extends Record<string, (...args: any[]) => void>> {
  private readonly emitter = new EventEmitter();

  public on<K extends keyof Events>(event: K, listener: Events[K]): this {
    this.emitter.on(event as unknown as string, listener as (...args: any[]) => void);
    return this;
  }

  public once<K extends keyof Events>(event: K, listener: Events[K]): this {
    this.emitter.once(event as unknown as string, listener as (...args: any[]) => void);
    return this;
  }

  public off<K extends keyof Events>(event: K, listener: Events[K]): this {
    this.emitter.off(event as unknown as string, listener as (...args: any[]) => void);
    return this;
  }

  public emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>): boolean {
    return this.emitter.emit(event as unknown as string, ...args);
  }
}
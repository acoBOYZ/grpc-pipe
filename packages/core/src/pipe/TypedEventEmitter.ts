import { EventEmitter } from 'events';

/**
 * A type-safe EventEmitter wrapper.
 * 
 * @template Events - A map of event names to listener signatures.
 */
export class TypedEventEmitter<Events extends { [K in keyof Events]: (...args: any[]) => void }> {
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

  public removeAllListeners<K extends keyof Events>(event?: K): this {
    if (event) {
      this.emitter.removeAllListeners(event as unknown as string);
    } else {
      this.emitter.removeAllListeners();
    }
    return this;
  }
}
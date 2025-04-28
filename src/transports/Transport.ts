// src/transports/Transport.ts

export interface Transport {
  send(data: unknown): void | Promise<void>;
  onMessage(callback: (data: unknown) => void): void;
}
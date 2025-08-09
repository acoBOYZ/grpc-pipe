export interface Transport {
  /**
   * Send a frame over the transport.
   */
  send(data: unknown): void | Promise<void>;

  /**
   * Subscribe to incoming frames.
   */
  onMessage(callback: (data: unknown) => void): void;

  onDrain?(cb: () => void): void;

  /**
   * Optional: expose writable buffer stats for backpressure heuristics.
   * If not implemented, PipeHandler will assume "no pressure".
   */
  getWritableInfo?(): { writableLength: number; writableNeedDrain: boolean } | null;
}
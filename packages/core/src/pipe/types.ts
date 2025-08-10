import type { CompressionSetting } from "../utils/compression.js";

/**
 * Configuration options for {@link PipeHandler}.
 */
export interface PipeHandlerOptions<ReceiveMap> {
  /**
   * Compression:
   *  - false (default)           → disabled
   *  - true                      → gzip
   *  - { codec: 'gzip'|'snappy'} → explicit object form
   */
  compression?: CompressionSetting;

  /**
   * Transport-level backpressure guard. If the underlying stream reports
   * a queued byte size >= this threshold, `post()` stops writing directly
   * and enqueues messages into an internal queue until pressure subsides.
   *
   * This is a safety net against unbounded memory growth when the transport
   * is slow. For high-throughput request/response flows, consider combining
   * this with {@link PipeHandlerOptions.maxInFlight}.
   *
   * @default 5 * 1024 * 1024 (5MB)
   */
  backpressureThresholdBytes?: number;

  /**
   * Enables periodic "system_heartbeat" messages to keep connections warm.
   *
   * - `true`  → send every 5000ms
   * - `{ intervalMs }` → custom interval
   * - `false` / omitted → disabled
   *
   * @example
   * heartbeat: { intervalMs: 10_000 }
   *
   * @default false
   */
  heartbeat?: boolean | { intervalMs?: number };

  /**
   * Application-level in-flight window for request/response style throttling.
   * When set, non-`system_*` messages posted via {@link PipeHandler.post}
   * will be held once the current in-flight count reaches this limit.
   *
   * A slot is released automatically when a received message’s type matches
   * any entry in {@link PipeHandlerOptions.releaseOn}.
   *
   * Notes:
   * - Works independently of transport backpressure and can be used as the
   *   primary gating mechanism for steady RTT/latency under load.
   * - If a matching reply never arrives (e.g., failures), you should ensure
   *   your protocol sends an error/terminal reply that is included in
   *   {@link PipeHandlerOptions.releaseOn}.
   *
   * @example
   * // Allow at most 512 outstanding requests at a time.
   * maxInFlight: 512
   *
   * @default undefined (no in-flight gating)
   */
  maxInFlight?: number;

  /**
   * Message types (from the receive side) that release a window slot created
   * by {@link PipeHandlerOptions.maxInFlight}.
   *
   * When the handler receives a message whose `type` is included here, the
   * internal in-flight counter is decremented by one, allowing the next queued
   * outbound message to proceed.
   *
   * Tips:
   * - Include all terminal replies for your request types (e.g., `"pong"`,
   *   `"user_updated"`, or `"error"`).
   * - Keys are typed as `keyof ReceiveMap` for safety.
   *
   * @example
   * // Classic ping/pong
   * releaseOn: ['pong']
   *
   * @example
   * // Multiple terminal outcomes
   * releaseOn: ['ok', 'error']
   *
   * @default [] (no automatic releases; not useful without maxInFlight)
   */
  releaseOn?: (keyof ReceiveMap)[];
}
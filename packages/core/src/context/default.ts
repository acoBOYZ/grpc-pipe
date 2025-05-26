import type { Metadata, ServerDuplexStream } from "@grpc/grpc-js";
import type { Transport } from "../transports/index.js";
import type { PipeMessage } from "../com.js";

export type Context = Record<string, unknown>;

export type PipeConnectionHook<Ctx> = (
  info: {
    metadata: Metadata;
    transport: Transport;
    rawStream: ServerDuplexStream<PipeMessage, PipeMessage>;
  }
) => Promise<Ctx | void> | (Ctx | void);
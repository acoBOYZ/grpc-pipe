import type { Metadata, ServerDuplexStream } from "@grpc/grpc-js";
import type { Transport } from "../transports";
import type { PipeMessage } from "../types";

export type Context = Record<string, unknown>;

export type PipeConnectionHook<Ctx> = (
  info: {
    metadata: Metadata;
    transport: Transport;
    rawStream: ServerDuplexStream<PipeMessage, PipeMessage>;
  }
) => Promise<Ctx | void> | (Ctx | void);
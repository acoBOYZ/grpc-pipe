import type { Metadata, ServerDuplexStream } from "@grpc/grpc-js";
import type { Transport } from "../transports";
import type { PipeMessage } from "../types";

export type AuthContext = Record<string, unknown>;

export type PipeConnectionHook<Context> = (
  info: {
    metadata: Metadata;
    transport: Transport;
    rawStream: ServerDuplexStream<PipeMessage, PipeMessage>;
  }
) => Promise<Context | void>;
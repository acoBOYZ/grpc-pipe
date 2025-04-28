import type { MessageFns } from "./pipe";

export type InferSend<T extends { send: Record<string, MessageFns<any>> }> = {
  [K in keyof T["send"]]: T["send"][K] extends MessageFns<infer U> ? U : never;
};

export type InferReceive<T extends { receive: Record<string, MessageFns<any>> }> = {
  [K in keyof T["receive"]]: T["receive"][K] extends MessageFns<infer U> ? U : never;
};
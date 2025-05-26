import type { MessageFns } from "./pipe.js";

/**
 * Infers the argument types for each message function in the `send` field of a given object type.
 *
 * This utility type extracts the input parameter type `U` from each `MessageFns<U>` 
 * in the `send` record of the provided type `T`.
 *
 * @template T - An object type with a `send` field, which is a record of message functions.
 * @returns An object type where each key corresponds to a key in `T["send"]`, 
 *          and the value is the inferred input type `U` for the corresponding `MessageFns<U>`.
 */
export type InferSend<T extends { send: Record<string, MessageFns<any>> }> = {
  [K in keyof T["send"]]: T["send"][K] extends MessageFns<infer U> ? U : never;
};

/**
 * Infers the argument types for each message function in the `receive` field of a given object type.
 *
 * This utility type extracts the input parameter type `U` from each `MessageFns<U>` 
 * in the `receive` record of the provided type `T`.
 *
 * @template T - An object type with a `receive` field, which is a record of message functions.
 * @returns An object type where each key corresponds to a key in `T["receive"]`, 
 *          and the value is the inferred input type `U` for the corresponding `MessageFns<U>`.
 */
export type InferReceive<T extends { receive: Record<string, MessageFns<any>> }> = {
  [K in keyof T["receive"]]: T["receive"][K] extends MessageFns<infer U> ? U : never;
};
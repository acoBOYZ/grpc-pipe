import type { MessageFns } from "../types/index.js";

/**
 * SchemaRegistry is a map of type names to their protobuf constructors.
 * It provides type safety for sending and receiving messages.
 */
export interface SchemaRegistry<SendMap = any, ReceiveMap = any> {
  send: { [K in keyof SendMap]: MessageFns<SendMap[K]> };
  receive: { [K in keyof ReceiveMap]: MessageFns<ReceiveMap[K]> };
}

/**
 * Helper to create a schema registry.
 * @param schema - The schema definition
 * @returns Typed SchemaRegistry
 */
export function createSchemaRegistry<SendMap, ReceiveMap>(schema: {
  send: { [K in keyof SendMap]: MessageFns<SendMap[K]> };
  receive: { [K in keyof ReceiveMap]: MessageFns<ReceiveMap[K]> };
}): SchemaRegistry<SendMap, ReceiveMap> {
  return schema;
}
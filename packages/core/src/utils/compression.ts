// src/utils/compression.ts
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import * as snappy from 'snappy';

const gzipAsync = {
  deflate: promisify(zlib.gzip),
  inflate: promisify(zlib.gunzip),
};

export type CompressionCodec = 'snappy' | 'gzip';
export type CompressionSetting = boolean | { codec: CompressionCodec };

export function isCompressionEnabled(
  v: CompressionSetting | undefined
): v is true | { codec: CompressionCodec } {
  return !!v;
}

function toUint8(buf: Buffer): Uint8Array {
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function ensureBuffer(x: Buffer | string): Buffer {
  return Buffer.isBuffer(x) ? x : Buffer.from(x);
}

export async function compress(
  buf: Uint8Array,
  setting?: CompressionSetting
): Promise<Uint8Array> {
  if (!setting) return buf;

  const codec = setting === true ? 'snappy' : setting.codec;

  if (codec === 'gzip') {
    const out = await gzipAsync.deflate(Buffer.from(buf));
    return toUint8(out);
  }

  const out = await snappy.compress(Buffer.from(buf));
  return toUint8(ensureBuffer(out));
}

export function decompress(
  buf: Uint8Array,
  setting?: CompressionSetting
): Uint8Array {
  if (!setting) return buf;

  const codec = setting === true ? 'snappy' : setting.codec;

  if (codec === 'gzip') {
    const out = zlib.gunzipSync(Buffer.from(buf));
    return toUint8(out);
  }

  const out = snappy.uncompressSync(Buffer.from(buf), { asBuffer: true });
  return toUint8(ensureBuffer(out));
}
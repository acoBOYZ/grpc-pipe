import { gunzipSync, gzipSync } from 'zlib';

export async function compress(data: Uint8Array): Promise<Uint8Array> {
  return gzipSync(data);
}

export function decompress(data: Uint8Array): Uint8Array {
  return gunzipSync(data);
}
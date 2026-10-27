import { createClient } from "@supabase/supabase-js";

export interface BlobStore {
  put(bucket: string, path: string, buf: Buffer, contentType: string): Promise<void>;
  get(bucket: string, path: string): Promise<Buffer>;
  publicUrl(bucket: string, path: string): string;
}

export function createSupabaseBlobStore(supabaseUrl: string, serviceKey: string): BlobStore {
  const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async put(bucket, path, buf, contentType) {
      const { error } = await client.storage.from(bucket).upload(path, buf, { contentType, upsert: true });
      if (error) throw new Error(`storage put failed: ${error.message}`);
    },
    async get(bucket, path) {
      const { data, error } = await client.storage.from(bucket).download(path);
      if (error || !data) throw new Error(`storage get failed: ${error?.message ?? "no data"}`);
      return Buffer.from(await data.arrayBuffer());
    },
    publicUrl(bucket, path) {
      return client.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    },
  };
}

export function createMemoryBlobStore(): BlobStore {
  const files = new Map<string, { buf: Buffer; contentType: string }>();
  const key = (b: string, p: string) => `${b}/${p}`;
  return {
    async put(bucket, path, buf, contentType) {
      files.set(key(bucket, path), { buf: Buffer.from(buf), contentType });
    },
    async get(bucket, path) {
      const f = files.get(key(bucket, path));
      if (!f) throw new Error(`not found: ${key(bucket, path)}`);
      return Buffer.from(f.buf);
    },
    publicUrl(bucket, path) {
      return `memory://${key(bucket, path)}`;
    },
  };
}

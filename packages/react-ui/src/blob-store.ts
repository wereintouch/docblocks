/**
 * The blob bridge: the library does not own storage. Documents hold only an
 * opaque file id; the consumer's store returns the bytes and authoritative
 * metadata, and notifies open views when that metadata changes.
 */

/** The blob's authoritative display metadata. */
interface BlobMeta {
  /** The current display and suggested download name. */
  name: string;
  /** The MIME type; application/octet-stream stands for an unknown type. */
  mimeType: string;
}

/** A blob payload returned by the consumer's store. */
interface BlobRef {
  blob: Blob;
  meta: BlobMeta;
}

/** The consumer's blob bridge, injected via the EditorProvider `blobStore` prop. */
interface BlobStore {
  /** File id → bytes + authoritative metadata; rejects an unknown id. */
  get(fileId: string): Promise<BlobRef>;
  /** Upload a file and return its opaque id. */
  upload(file: File): Promise<string>;
  /** Rename the stored object, return its metadata, and notify subscribers. */
  rename(fileId: string, name: string): Promise<BlobMeta>;
  /** Subscribe to byte or metadata replacement; the callback starts a fresh get. */
  subscribe(fileId: string, onChange: () => void): () => void;
  /** Optional garbage collection. */
  remove?(fileId: string): Promise<void>;
}

/** The default in-memory store: blobs live for the JS session only. */
function createMemoryBlobStore(): BlobStore {
  const blobs = new Map<string, BlobRef>();
  const listeners = new Map<string, Set<() => void>>();
  let sequence = 0;

  const notify = (fileId: string): void => {
    for (const listener of listeners.get(fileId) ?? []) listener();
  };

  return {
    get: async (fileId) => {
      const ref = blobs.get(fileId);
      if (ref === undefined) throw new Error(`Blob not found: ${fileId}`);
      return ref;
    },
    upload: async (file) => {
      sequence += 1;
      const fileId = `blob-${sequence}`;
      blobs.set(fileId, {
        blob: file,
        meta: { name: file.name, mimeType: file.type || "application/octet-stream" },
      });
      return fileId;
    },
    rename: async (fileId, name) => {
      const ref = blobs.get(fileId);
      if (ref === undefined) throw new Error(`Blob not found: ${fileId}`);
      const meta = { ...ref.meta, name };
      blobs.set(fileId, { ...ref, meta });
      notify(fileId);
      return meta;
    },
    subscribe: (fileId, onChange) => {
      let entries = listeners.get(fileId);
      if (entries === undefined) {
        entries = new Set();
        listeners.set(fileId, entries);
      }
      entries.add(onChange);
      return () => {
        entries.delete(onChange);
        if (entries.size === 0) listeners.delete(fileId);
      };
    },
    remove: async (fileId) => {
      blobs.delete(fileId);
      notify(fileId);
    },
  };
}

let defaultStore: BlobStore | null = null;

/** One shared default store per page, so sibling editors resolve the same uploads. */
function getDefaultBlobStore(): BlobStore {
  if (defaultStore === null) defaultStore = createMemoryBlobStore();
  return defaultStore;
}

export type { BlobMeta, BlobRef, BlobStore };
export { createMemoryBlobStore, getDefaultBlobStore };

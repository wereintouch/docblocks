/**
 * The blob bridge: the library does not own storage.
 *
 * The bytes live where the consumer stored them (S3, disk, a CDN — the
 * package does not know and does not care). The document holds only an
 * opaque key, and the consumer's callbacks are the only path key →
 * displayable url and file → key. Both directions carry the metadata:
 * `upload` accepts a `meta` (the consumer decides the subtype), and
 * `resolve` returns the key's url plus the authoritative metadata — the
 * UI renders from `meta.subtype` and never guesses (an image blob stands
 * an `<img>`, a pdf an iframe viewer, a file a download card).
 *
 * The legacy `blobResolver` prop (synchronous key → src string) wraps as
 * a store: view-only (no upload), subtype "image".
 */

/** The blob's media class; the consumer decides, extends additively. */
type BlobSubtype = "image" | "pdf" | "file";

/** The blob's display metadata (the consumer is the source of truth). */
interface BlobMeta {
  subtype: BlobSubtype;
  /** The file name (the file card's caption). */
  name?: string;
  /** The mime type. */
  type?: string;
  /** The byte size. */
  size?: number;
}

/** A resolved blob: the displayable url and its authoritative metadata. */
interface BlobRef {
  /** The displayable url (http(s)/data/object — the form is the consumer's). */
  url: string;
  meta: BlobMeta;
}

/** The consumer's blob bridge (injected via the EditorProvider `blobStore` prop). */
interface BlobStore {
  /** Key → the displayable url + the authoritative metadata; rejects an unknown key. */
  resolve(key: string): Promise<BlobRef>;
  /** Upload: file → the opaque key (the doc holds only the key).
   *  The consumer may extend or override `meta` (it decides the subtype).
   *  Throws a typed error on the backend's refusal. */
  upload(file: File | Blob, meta?: Partial<BlobMeta>): Promise<string>;
  /** Optional: drop the bit (gc). Not required by the v contract. */
  remove?(key: string): Promise<void>;
}

/** Derive the subtype from the file's mime (the consumer's `meta.subtype` wins). */
function blobSubtypeOf(file: File | Blob): BlobSubtype {
  const type = file.type ?? "";
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf") return "pdf";
  return "file";
}

/** Read a file as a data url (the in-memory store's byte form). */
function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read the file."));
    reader.readAsDataURL(file);
  });
}

/**
 * The package's default in-memory store (the consumer passes no `blobStore`):
 * uploads stand data urls for the JS session, cleared on the page reload.
 */
function createMemoryBlobStore(): BlobStore {
  const blobs = new Map<string, BlobRef>();
  let sequence = 0;
  return {
    resolve: async (key: string) => {
      const ref = blobs.get(key);
      if (ref === undefined) throw new Error(`Blob not found: ${key}`);
      return ref;
    },
    upload: async (file, meta) => {
      sequence += 1;
      const key = `blob-${sequence}`;
      const url = await fileToDataUrl(file);
      // The store fills the display defaults from the file itself (name,
      // mime, size); the caller's meta overrides them (it decides the subtype).
      const base: BlobMeta = { subtype: blobSubtypeOf(file) };
      if (file instanceof File) base.name = file.name;
      if (file.type !== "") base.type = file.type;
      if (file.size !== 0) base.size = file.size;
      blobs.set(key, { url, meta: { ...base, ...meta } });
      return key;
    },
    remove: async (key: string) => {
      blobs.delete(key);
    },
  };
}

let defaultStore: BlobStore | null = null;

/**
 * The shared default in-memory store (one per page): every editor without
 * its own `blobStore` resolves against the same store, so a blob uploaded
 * through one pane is resolvable in another (the playground's A/B).
 */
function getDefaultBlobStore(): BlobStore {
  if (defaultStore === null) defaultStore = createMemoryBlobStore();
  return defaultStore;
}

/**
 * Wrap the legacy synchronous resolver as a store (the `blobResolver`
 * prop's compatibility): view-only — the upload rejects, and the subtype
 * stands "image". An empty src from the resolver rejects (the block then
 * renders its placeholder, as before).
 */
function legacyBlobStore(resolver: (key: string) => string): BlobStore {
  return {
    resolve: async (key: string) => {
      const url = resolver(key);
      if (url === null || url === "") throw new Error(`Blob not found: ${key}`);
      return { url, meta: { subtype: "image" } };
    },
    upload: async () => {
      throw new Error("Upload is unavailable: the legacy blobResolver holds no upload path.");
    },
  };
}

export type { BlobMeta, BlobRef, BlobSubtype, BlobStore };
export { blobSubtypeOf, createMemoryBlobStore, getDefaultBlobStore, legacyBlobStore };

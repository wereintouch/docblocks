/** The provider's offline buffer bookkeeping: a byte count + a flag, not a
 *  copy of each update (the updates live in the internal doc and are
 *  coalesced into one state update on the open). */
import type { PendingStats } from "./models";

class PendingBuffer {
  #bytes = 0;
  #hasPending = false;
  #overflow = false;
  #maxBytes: number;

  constructor(maxBytes: number) {
    this.#maxBytes = maxBytes;
  }

  /** Count one buffered update's bytes (the update itself stands the
   *  internal doc); the overflow flag stands set once the count passes the
   *  ceiling. */
  count(bytes: number): void {
    this.#bytes += bytes;
    this.#hasPending = true;
    if (this.#bytes > this.#maxBytes) this.#overflow = true;
  }

  /** One or more updates stand buffered. */
  get hasPending(): boolean {
    return this.#hasPending;
  }

  /** The buffer's stats (the observable backpressure). */
  get stats(): PendingStats {
    return { pendingBytes: this.#bytes, overflow: this.#overflow };
  }

  /** The open's flush clear (the coalesced state update's send stands the
   *  caller). */
  flush(): void {
    this.#bytes = 0;
    this.#hasPending = false;
    this.#overflow = false;
  }
}

export { PendingBuffer };

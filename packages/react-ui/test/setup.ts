// The jsdom's Range stands no rect API (the browser's layout API — the
// product's reads fall back to the document order over the degenerate
// rect): the suite-level stub keeps the deferred selectionchange's reseat
// from throwing over the test files without the per-file stub. The stub
// is idempotent — the per-file stubs (the explicit ones) stay no-ops over
// it.
if (typeof Range !== "undefined" && typeof Range.prototype.getBoundingClientRect !== "function") {
  Range.prototype.getBoundingClientRect = () =>
    ({
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => null,
    }) as DOMRect;
}

// jsdom has no object-url implementation; the deterministic stand keeps the
// blob renderers exercisable without a browser.
let objectUrlSequence = 0;
if (typeof URL !== "undefined" && typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => `blob:test-${++objectUrlSequence}`;
  URL.revokeObjectURL = () => {};
}

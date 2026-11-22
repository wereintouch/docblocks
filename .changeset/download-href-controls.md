---
"docblocks-react-ui": patch
---

The download-href gate over the consumer's `BlobStore` url now normalizes the
browser's WHATWG control handling (the mid-string U+0009/U+000A/U+000D strip +
the leading / trailing C0 / space trim) before the scheme check, in parity with
the link-href's classifier — a `downloadUrl` carrying a control-split
`javascript:` scheme no longer stands an anchor.

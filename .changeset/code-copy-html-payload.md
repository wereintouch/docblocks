---
"docblocks-react-ui": patch
---

The code block's copy button now copies the `text/html` payload (the `PRE`
over the code's child, the `language-*` class on the `code` element) plus
the `text/plain` fallback — the paste into a text block materializes the
code block verbatim through the rich pipeline (the plain payload's
markdown pipeline stood the distortion: the newlines collapsed, the
indentation lost, the markdown-flavored lines re-blocked — the `---` to
the divider, the `# x` to the heading, …). The rich pipeline now reads
the `language-*` class back over the `PRE`'s materialization (the
language's round-trip's stand — over the `PRE`'s own class or the
`code`'s child's, the producer's convention's positions); the paste into
the code block keeps the plain payload's stand (the `plainWins`'s gate),
and the external apps receive the plain fallback unchanged (the legacy
engines without `ClipboardItem` stand the plain write).

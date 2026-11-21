---
"docblocks-react-ui": patch
---

The react-ui layer stands a typed error family (`DocBlocksUiError` base +
the `EditorProviderError`, `BlobNotFoundError`, `PdfFetchError`,
`CanvasPasteError`, `UnknownSlashCommandError`, `UnhandledValueError`
conditions, all exported from the base entry): the former raw `Error`
throws of the provider's prop contract, the blob store's missing-id
rejections, the PDF fetch's non-ok response, and the internal invariant
guards now throw the named class — the messages are unchanged, so a
consumer can catch by class.

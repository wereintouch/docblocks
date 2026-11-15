---
"docblocks-react-ui": patch
---

The new optional `mentionInteractions` provider prop
(`{ renderCard, onClick? }`) stands the mention chip's interactions
(independent of the `mentionProvider` — it works for any mention in the
document): the hover card — the consumer's content and design over the
package's portaled host (the position and the lifecycle are the
package's: the hover's open delay, the exit / Escape / scroll's close, and
the anchor chip's removal's close) — and the chip's click delivery (the
native `MouseEvent` to the consumer's `onClick`; the package opens nothing
on the click and stands no default behavior). The target stands the
document's `mention` mark (the core's `MentionMark` — re-exported for the
consumer's convenience). Without the prop the chip stands as before (no
card, the click is the browser's stand).

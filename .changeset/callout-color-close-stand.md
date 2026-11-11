---
"docblocks-react-ui": patch
---

The callout's custom color picker commits the last scrubbed value when
the picker section closes without an explicit commit (the former close
discarded the draft); an untouched picker still commits nothing. The
swatch grid's custom swatch carries the current color when it matches
no preset (a small dot over the rainbow swatch).

---
"docblocks-core": minor
---

The `link` mark's href takes the `mailto:` email and the `tel:` phone forms
alongside the http/https URLs and relative paths (the validator's and the
writer's single gate). `linkHrefKindOf` classifies the normalized href as
`web` / `mailto` / `tel` / `relative`, or `null` for any other scheme.

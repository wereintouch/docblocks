---
"docblocks-react-ui": minor
---

The collapsible document-attributes panel over the editor page column
(collapsed by default, session-only state): the system rows (id /
created / last updated, read-only — the dates stand the locale's
medium date, the id over the monospace), the preset rows (description,
tags, the `createdBy` creator reference (the id-only mention, display
over the consumer's resolution), cover, the `status` stand
(display-only — the consumer's own data, the panel's editor stands
absent), published date) with the inline editors, the custom
attributes (the add's flow over the list's tail's button — the popover's
one-line sliding-pill type pick (the document view's selector's parity

- the light bounce's animation) + the name's draft (the `Name`'s
  placeholder) + the commit's button over the input's right (the disabled
  over the empty name); the `ATTRIBUTE_TYPES` enum over the type's
  vocabulary; the mention's name stands the target's id; the custom
  value's edit over the row's zone — the string / number / list / mention
  inline inputs over the typed form's write-back (the invalid number's
  no-write), the boolean's click's toggle), and the consumer's
  `hiddenAttributes` + `tagEditor` + `renderAttribute` + `attributeTypePicker`
  provider props. The `renderAttribute` callback replaces a row's value
  zone over its key (the `null` / the absent stands the built-in); the
  `attributeTypePicker` component replaces the built-in type picker over
  the add flow. Markdown import and paste now read the YAML-frontmatter
  subset into the meta over the fresh documents (the title + the mapped
  attribute presets — the `author` / `created_by` keys map to the
  `createdBy` id-only reference) and strip it before the blocks parse; the
  HTML import keeps the frontmatter as a plain paragraph.

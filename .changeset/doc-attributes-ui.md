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
  value's edit over the row's zone — the string / number / mention inline
  inputs over the typed form's write-back (the invalid number's no-write),
  the list over the vertical's line editor (each item over its own line —
  the line's input + the ×'s removal + the "Add a line"'s input over the
  stack's tail; every discrete change commits the whole list over the
  value's form: plain `string[]` → plain, typed → typed; the read-only's
  stacked display; the row's key + the remove button stand opposite the
  first line over the stack (the row's center stand dropped)), the boolean over the project's checkbox (the checked's
  toggle — one write over the value's form: the plain's plain stand, the
  typed's typed stand; the read-only's disabled stand over the view /
  published's modes); the row's value zone centers its content vertically
  (the page's inherited line-height no longer stands the value's text
  above the label's center — the value's "jump" stand dropped) and the
  single value's rows stand the uniform height (the row's `min-h` — the
  checkbox's row's shorter stand dropped), the custom key's rename over
  the key's click (the inline input over the key's column — the
  select-all's mount stand, the Enter / the blur's commit over the
  `renameAttribute`, the Escape's cancel, the invalid target's (the
  reserved / the taken key) open stand over the `aria-invalid`'s
  destructive frame, the preset / the system rows' and the read-only's
  no-entry stand), the tags' add input stands the
  value column's font size (the placeholder's `text-xs` stand over the
  `text-sm`'s column's parity), the custom rows' display order
  (the preset rows' fixed order; the custom rows over `attributesOrder` —
  last-added last, drag-reorderable over the grip with the block's
  grip's offset parity: the hover's reveal, the framer's live slide's
  preview, the release's `reorderAttributes` commit over the wire, the
  undo's single step, the no-move release's no-op stand), and the
  consumer's `hiddenAttributes` + `tagEditor` + `renderAttribute` +
  `attributeTypePicker` provider props. The `renderAttribute` callback replaces a row's value
  zone over its key (the `null` / the absent stands the built-in); the
  `attributeTypePicker` component replaces the built-in type picker over
  the add flow. The panel's in-row fields (the tags' add input, the
  list's line / the new-line inputs, the key's rename input, the typed
  value's inline edits) all stand the shared `Input` primitive over its
  new flat `inline` variant (the frame / the background / the shadow
  stand off — the focus's border stand only), replacing the ad-hoc raw
  inputs. The `AttributesPanel` stands the composition over the unit's
  row files (the `CustomAttributeRow`'s custom row, the preset's
  editors, the add's popover, the value's pure reads). Markdown import and paste now read the YAML-frontmatter
  subset into the meta over the fresh documents (the title + the mapped
  attribute presets — the `author` / `created_by` keys map to the
  `createdBy` id-only reference) and strip it before the blocks parse; the
  HTML import keeps the frontmatter as a plain paragraph.

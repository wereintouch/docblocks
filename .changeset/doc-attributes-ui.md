---
"docblocks-react-ui": minor
---

The collapsible document-attributes panel over the editor page column
(collapsed by default, session-only state): the system rows (id /
created / last updated, read-only), the preset rows (description,
tags, author mention, cover, status, published date) with the inline
editors, the custom attributes (add / edit / remove), and the
consumer's `hiddenAttributes` + `tagEditor` provider props.
Markdown import and paste now read the YAML-frontmatter subset into
the meta over the fresh documents (the title + the mapped attribute
presets) and strip it before the blocks parse; the HTML import keeps
the frontmatter as a plain paragraph.

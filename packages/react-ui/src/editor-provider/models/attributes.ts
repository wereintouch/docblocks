/** The document-attributes panel's consumer renderers: the per-key value
 *  zone and the add flow's type picker. */
import type { ComponentType, ReactNode } from "react";

import type { AttributeType, DocAttributeValue } from "docblocks-core";

/** The props an attribute-value renderer receives (the `renderAttribute` provider prop). */
interface RenderAttributeProps {
  /** The attribute's key (the preset key or the custom key). */
  key: string;
  /** The attribute's current value (`undefined` when unset). */
  value: DocAttributeValue | undefined;
  /** The write commit (one `setAttribute`). */
  onChange: (value: DocAttributeValue) => void;
  /** The removal commit (one `removeAttribute`). */
  onRemove: () => void;
  /** The read-only stand (the view / published's modes): display-only. */
  readOnly: boolean;
}

/** The consumer's per-key attribute-value renderer (the `renderAttribute` provider prop): the value zone of a named row (a preset or a custom key); `null` / the absent stand the built-in editor. */
type RenderAttribute = (props: RenderAttributeProps) => ReactNode;

/** The props an attribute type-picker receives (the `attributeTypePicker` provider prop). */
interface AttributeTypePickerProps {
  /** The selected type (the panel's pick — the default `"string"` over the add's popover). */
  value: AttributeType;
  /** Commits the type pick (the built-in picker's enum is `ATTRIBUTE_TYPES`). */
  onChange: (type: AttributeType) => void;
}

/** The consumer's replacement of the default type picker (the `attributeTypePicker` provider prop): the custom-attribute's add popover's type selection. The built-in's enum (`ATTRIBUTE_TYPES`) is the shared vocabulary. */
type AttributeTypePicker = ComponentType<AttributeTypePickerProps>;

export type { AttributeTypePicker, AttributeTypePickerProps, RenderAttribute, RenderAttributeProps };

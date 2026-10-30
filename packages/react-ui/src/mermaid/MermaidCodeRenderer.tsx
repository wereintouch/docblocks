/** A BlockRenderer for the `code` type (the mermaid diagram capability).
 * The registry dispatches by type: a renderer registered under "code"
 * only receives code blocks (the union cannot express that narrowing at
 * the call site). One code block with the diagram capability: a
 * `language: "mermaid"` block renders per its `mermaidMode` (default
 * "code") — the modes are exclusive: `code` renders the editable code
 * only (the diagram stands hidden), `preview` renders the diagram only
 * (the code body hidden — the editable stays mounted for the text sync);
 * every other code block is the plain built-in code rendering. The
 * code/preview mode segment of one mermaid code block's header (the
 * header's left group — right of the language button): the mode is the
 * `mermaidMode` attr (default "code"); a switch is one `updateBlock` (one
 * undo step, one wire update), a repeat of the current mode a no-op. */
import type { BlockId, CodeBlock } from "docblocks-core";

import { CodeHeader, TextBlock, childrenSlot, textOf } from "../blocks";
import type { BlockRendererProps } from "../blocks";
import { useEditorContext } from "../editor-provider";
import { SegmentSelector } from "../shared/ui/SegmentSelector";
import { CodeXml, Eye } from "../shared/ui/icons";
import { MermaidDiagram } from "./MermaidDiagram";

function MermaidModeSelector({ id, block }: { id: BlockId; block: CodeBlock }) {
  const { doc } = useEditorContext();
  const mode = block.attrs?.mermaidMode ?? "code";
  const pick = (next: "code" | "preview"): void => {
    if (next === mode) return;
    doc.updateBlock(id, { mermaidMode: next });
  };
  return (
    <SegmentSelector
      options={[
        { value: "code", label: "Show the code", icon: <CodeXml className="size-4" /> },
        { value: "preview", label: "Show the diagram preview", icon: <Eye className="size-4" /> },
      ]}
      value={mode}
      onChange={pick}
      ariaLabel="Mermaid display mode"
      slot="docblocks/mermaid-mode"
      pillSlot="docblocks/mermaid-mode-pill"
      buttonAttrName="mermaid-mode-button"
    />
  );
}

/**
 * One code block with the diagram capability: a `language: "mermaid"`
 * block renders per its `mermaidMode` (default "code") — the modes are
 * exclusive: `code` renders the editable code only (the diagram stands
 * hidden), `preview` renders the diagram only (the code body hidden —
 * the editable stays mounted for the text sync); every other code block
 * is the plain built-in code rendering.
 */
function MermaidCodeBlock({ id, block }: { id: BlockId; block: CodeBlock }) {
  const nested = childrenSlot(id, block.children);
  if (block.attrs?.language !== "mermaid") {
    return <TextBlock id={id} block={block} tag="pre" header={<CodeHeader id={id} block={block} />} nested={nested} />;
  }
  // The mode is the `mermaidMode` attr (default "code"): the modes are
  // exclusive — the preview renders the diagram instead of the code body.
  const mode = block.attrs?.mermaidMode ?? "code";
  return (
    <TextBlock
      id={id}
      block={block}
      tag="pre"
      header={<CodeHeader id={id} block={block} center={<MermaidModeSelector id={id} block={block} />} />}
      codeBodyHidden={mode === "preview"}
      nested={
        mode === "preview" ? (
          <>
            <MermaidDiagram id={id} text={textOf(block.content)} />
            {nested}
          </>
        ) : (
          nested
        )
      }
    />
  );
}

/**
 * A BlockRenderer for the `code` type. The registry dispatches by type:
 * a renderer registered under "code" only receives code blocks (the union
 * cannot express that narrowing at the call site).
 */
function MermaidCodeRenderer({ id, block }: BlockRendererProps) {
  return <MermaidCodeBlock id={id} block={block as CodeBlock} />;
}

export { MermaidCodeRenderer };

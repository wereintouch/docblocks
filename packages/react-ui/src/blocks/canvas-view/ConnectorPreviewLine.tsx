/** The connector's pending preview line: the solid cyan segment from the
 *  pending block's edge anchor (the box's edge the cursor points at) to the
 *  cursor (the world's space, so it scales with the zoom). It stands PER THE
 *  DATA — the pending new line has no stroke style, so it is the solid
 *  default (the cyan color is the preview's stand, not a dash). */
function ConnectorPreviewLine({
  id,
  from,
  point,
}: {
  id?: string;
  from: { x: number; y: number };
  point: { x: number; y: number };
}) {
  return (
    <svg
      data-slot="docblocks/canvas-connector-preview"
      data-connector-preview-id={id}
      className="pointer-events-none absolute top-1/2 left-1/2 overflow-visible"
      width={1}
      height={1}
    >
      <line
        x1={from.x}
        y1={from.y}
        x2={point.x}
        y2={point.y}
        stroke="var(--docblocks-canvas-selection-border-color)"
        strokeWidth={1.5}
      />
    </svg>
  );
}

export { ConnectorPreviewLine };

/** The cover mode's row's selector (the panel's toggle over the stored
 *  cover): the tile / the centering's options stand the switch's gate —
 *  an option stands disabled when its gate is known unmet over the
 *  current image (the centering's minimum width over the editor width,
 *  the tile's minimum height; the unknown's dimensions' fail-open keeps
 *  it enabled). The editor width stands measured over the anchor's
 *  nearest editor frame. */
import { useTranslation } from "react-i18next";

import { useLayoutEffect, useRef, useState } from "react";

import { useBlobFile } from "../blocks/use-blob-file";
import { SegmentSelector } from "../shared/ui/SegmentSelector";
import { COVER_MODE_ORDER, COVER_RENDERS_BYTES, coverModeGating, readImageDimensions } from "./cover";
import type { CoverMode, ImageDimensions } from "./cover";

/** The editor frame's selector (the width's measurement's source). */
const EDITOR_SELECTOR = '[data-slot="docblocks/editor"]';

function CoverModeSelector({
  coverId,
  mode,
  readOnly,
  onChange,
}: {
  /** The stored cover's file id (the dimensions' probe's source). */
  coverId: string;
  mode: CoverMode;
  readOnly: boolean;
  onChange: (mode: CoverMode) => void;
}) {
  const { t } = useTranslation("editor");
  const { state: file } = useBlobFile(coverId, COVER_RENDERS_BYTES, { eager: true });
  const blob = file.status === "ready" ? file.blob : null;

  /** The intrinsic dimensions' probe (the gate's input — the undecodable's
   *  payload keeps the gate's fail-open stand). */
  const [dimensions, setDimensions] = useState<ImageDimensions | null>(null);
  useLayoutEffect(() => {
    if (blob === null) {
      setDimensions(null);
      return;
    }
    let alive = true;
    void readImageDimensions(blob).then((next) => {
      if (alive) setDimensions(next);
    });
    return () => {
      alive = false;
    };
  }, [blob]);

  /** The editor frame's live width (the centering's gate's input): the
   *  anchor's nearest editor frame's box over the mount's measure + the
   *  resize's watch (the jsdom's no-layout's stand keeps the zero's value
   *  — the gate's fail-open). */
  const zoneRef = useRef<HTMLDivElement | null>(null);
  const [editorWidth, setEditorWidth] = useState(0);
  useLayoutEffect(() => {
    const editor = zoneRef.current?.closest(EDITOR_SELECTOR) ?? null;
    if (editor === null) return;
    const measure = (): void => {
      setEditorWidth((prev) => (prev === editor.clientWidth ? prev : editor.clientWidth));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(editor);
    return () => observer.disconnect();
  }, []);

  // The switch's gate's stand over the current image (the option's
  // disabled stands the gate's known-unmet; the read-only's stand keeps
  // both options inert).
  const gating = coverModeGating(dimensions, editorWidth);
  const options = COVER_MODE_ORDER.map((value) => ({
    value,
    label: t(value === "tile" ? "attributes.coverModeTile" : "attributes.coverModeCenter"),
    disabled: readOnly || (value === "tile" ? gating.tileDisabled : gating.centerDisabled),
  }));

  return (
    <div ref={zoneRef}>
      <SegmentSelector
        size="text"
        ariaLabel={t("attributes.coverMode")}
        slot="docblocks/attributes-cover-mode"
        pillSlot="docblocks/attributes-cover-mode-pill"
        buttonAttrName="mode"
        options={options}
        value={mode}
        onChange={(next) => {
          if (next === mode) return;
          onChange(next);
        }}
      />
    </div>
  );
}

export { CoverModeSelector };

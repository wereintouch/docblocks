/** The picker's content's width's clamp (the min = the cell's width, the
 *  widest option's drive, the 220 px's ceiling): measured over the
 *  content's mount (the font's read stands the portaled content's own
 *  computed stand). */
import { useEffect, useState } from "react";

import { PICKER_CHROME_MULTI_PX, PICKER_CHROME_SINGLE_PX, PICKER_MAX_WIDTH_PX } from "./constants";
import { measureOptionLabelPx } from "./utils";

function usePickerWidthPx(
  open: boolean,
  trigger: HTMLElement | null,
  labels: readonly string[],
  multi: boolean
): number | undefined {
  const [width, setWidth] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!open || trigger === null) {
      setWidth(undefined);
      return;
    }
    const cellWidth = trigger.getBoundingClientRect().width;
    const fontFamily = getComputedStyle(trigger).fontFamily;
    const widest = labels.reduce((max, label) => Math.max(max, measureOptionLabelPx(label, fontFamily)), 0);
    const chrome = multi ? PICKER_CHROME_MULTI_PX : PICKER_CHROME_SINGLE_PX;
    setWidth(Math.min(PICKER_MAX_WIDTH_PX, Math.max(cellWidth, widest + chrome)));
  }, [open, trigger, labels, multi]);
  return width;
}

export { usePickerWidthPx };

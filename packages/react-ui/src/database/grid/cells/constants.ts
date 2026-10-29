/** The chip's ink (the option's colors stand the pastel data — the dark
 *  ink stands legible on them over both themes). */
const OPTION_CHIP_INK = "#262626";
/** The picker's content's width's clamp: the cell's width's floor, the
 *  widest option's width's drive, the 220 px's ceiling (the option's
 *  ellipsis over the ceiling's stand). */
const PICKER_MAX_WIDTH_PX = 220;
/** The picker's width's chrome over the widest label (the row's px-2 +
 *  the chip's px-2 + the content's p-2 — the 16 px × 3); the multi's
 *  stand adds the checkbox's size-4 + the row's gap-2. */
const PICKER_CHROME_SINGLE_PX = 48;
const PICKER_CHROME_MULTI_PX = 72;

export { OPTION_CHIP_INK, PICKER_CHROME_MULTI_PX, PICKER_CHROME_SINGLE_PX, PICKER_MAX_WIDTH_PX };

/** The in-memory bridge's constants: the fractional order step, the default
 *  page size, and the bridge-managed pk / order column names. */

/** The fractional order step (the value between two rows is their mean). */
const ORDER_STEP = 1024;

/** The default page size. */
const DEFAULT_LIMIT = 200;

/** The package's pk / order column names (the describeTable defaults). */
const PK_COLUMN = "id";
const ROW_ORDER_COLUMN = "rowOrder";

export { DEFAULT_LIMIT, ORDER_STEP, PK_COLUMN, ROW_ORDER_COLUMN };

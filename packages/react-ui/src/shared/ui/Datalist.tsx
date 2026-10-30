/**
 * The native datalist primitive: the browser-native suggestion list for a
 * field (the `list` attribute's target). A plain HTML datalist — the
 * suggestions are the native stand (no radix dependency); the options'
 * elements are the datalist's own children (the native stand, the same
 * as the bare select's options).
 */
import * as React from "react";

function Datalist({ className, ...props }: React.ComponentProps<"datalist">) {
  return <datalist data-slot="datalist" className={className} {...props} />;
}

export { Datalist };

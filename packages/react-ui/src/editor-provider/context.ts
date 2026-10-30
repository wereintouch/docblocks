/** The editor provider's per-instance context (the store, the doc, the
 *  selection handle, the customization values) + the read hook. */
import { createContext, useContext } from "react";

import type { EditorContextValue } from "./models";

const EditorContext = createContext<EditorContextValue | null>(null);

/** Read the per-instance editor context; throws outside an EditorProvider. */
function useEditorContext(): EditorContextValue {
  const context = useContext(EditorContext);
  if (context === null) throw new Error("Editor hooks must be used inside an EditorProvider.");
  return context;
}

export { EditorContext, useEditorContext };

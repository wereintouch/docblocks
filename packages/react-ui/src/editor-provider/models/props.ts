/** The provider's props: the base stand, the customization surface, and
 *  the access stand composed into the public `EditorProviderProps`. */
import type { EditorProviderAccessProps } from "./props-access";
import type { EditorProviderBaseProps } from "./props-base";
import type { EditorProviderCustomizationProps } from "./props-customization";

interface EditorProviderProps
  extends EditorProviderBaseProps, EditorProviderCustomizationProps, EditorProviderAccessProps {}

export type { EditorProviderProps };

/**
 * docblocks-react-ui — public entry.
 *
 * React rendering layer for docblocks: the per-instance provider and store
 * projection, hooks, and block renderers. Builds strictly on the public
 * API of docblocks-core — direct yjs imports are forbidden (ESLint gate).
 */
export type { BlockRenderer, BlockRendererMap, BlockRendererProps } from "./blocks/renderers";
export { Editor } from "./Editor";
export type { EditorView } from "./Editor";
export { EditorProvider, useEditorContext } from "./EditorProvider";
export type { EditorContextValue, EditorProviderProps, SyncEmbedResolver } from "./EditorProvider";
export type { SyncEmbedRef } from "docblocks-core";
export { useBlock, useDoc, useMeta, usePresence, useSelection, useSelectionView, useText } from "./hooks";
export { FORMAT_PALETTE } from "./editing/format-toolbar";
export { markToggleAction } from "./editing/keyboard";
export type { FormatMark } from "./editing/keyboard";
export { renderRuns } from "./text/runs";
// The design system primitives (shared/ui) — styled by the compiled
// utility layer shipped inside docblocks-react-ui/styles.css.
export {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  badgeVariants,
  Button,
  buttonVariants,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  cn,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./shared/ui";

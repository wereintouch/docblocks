/**
 * docblocks-react-ui — public entry.
 *
 * React rendering layer for docblocks: the per-instance provider and store
 * projection, hooks, and block renderers. Builds strictly on the public
 * API of docblocks-core — direct yjs imports are forbidden (ESLint gate).
 */
export type { BlockRenderer, BlockRendererMap, BlockRendererProps } from "./blocks";
export { Editor } from "./Editor";
export type { EditorView } from "./Editor";
export { EditorErrorBoundary } from "./EditorErrorBoundary";
export type { EditorErrorBoundaryProps } from "./EditorErrorBoundary";
export { DEFAULT_EMBED_SANDBOX, EditorProvider, useEditorContext } from "./editor-provider";
export type {
  AccessLevel,
  AttributeTypePicker,
  AttributeTypePickerProps,
  BlobLoading,
  CoverPresetSets,
  DocDescription,
  DocTag,
  DocTags,
  EditorContextValue,
  EditorMode,
  EditorProviderProps,
  EmbedSandboxPolicy,
  MentionEntry,
  MentionInteractions,
  MentionProvider,
  PdfPreview,
  PdfPreviewProps,
  PresenceConfig,
  RenderAttribute,
  RenderAttributeProps,
  SelectionRef,
  SyncEmbedResolver,
} from "./editor-provider";
export { DocHeader } from "./DocHeader";
export type { DocHeaderAvatarContentContext } from "./DocHeader";
export { DocblocksI18nProvider } from "./i18n";
export type { DocblocksI18nProviderProps } from "./i18n";
export { createMemoryBlobStore } from "./blob-store";
export type { BlobMeta, BlobRef, BlobStore } from "./blob-store";
export {
  BlobNotFoundError,
  CanvasPasteError,
  DocBlocksUiError,
  EditorProviderError,
  HookMisuseError,
  PdfFetchError,
  UnhandledValueError,
  UnknownSlashCommandError,
} from "./shared/errors";
export {
  BASELINE_CAPABILITIES,
  BRIDGE_ERROR_CODES,
  BridgeError,
  DatabaseTable,
  TEXT_TYPES,
  cellValueEqual,
  columnAnnotation,
  conditionMatches,
  emptyFilter,
  filterIsComplete,
  FilterBuilder,
  isBridgeError,
  isBridgeErrorCode,
  isDatabaseBridge,
  newMutationContext,
  parseCellValue,
  PROTOCOL_VERSION,
  toBridgeError,
  useDatabaseTable,
  useTableList,
  validateProtocolDescriptor,
} from "./database";
export type {
  BatchOp,
  BridgeColumn,
  BridgeColumnAnnotation,
  BridgeErrorCode,
  BridgeTableDescription,
  BridgeValueInput,
  CellMap,
  CellValueParse,
  Column,
  DatabaseBridge,
  DatabaseTablePhase,
  DatabaseTableProps,
  DatabaseTableRow,
  DatabaseTableSection,
  DatabaseTableView,
  DomainEvent,
  FilterConditionInput,
  FilterInput,
  Id,
  IsoInstant,
  MutationContext,
  MutationReceipt,
  OperationStatus,
  PageQuery,
  PageSnapshot,
  ProtocolCapability,
  ProtocolDescriptor,
  ProtocolLimits,
  QueryOperator,
  QuerySemantics,
  Revision,
  RowPage,
  RowWire,
  SortInput,
  SubscriptionHandle,
  SubscriptionObserver,
  SubscriptionStatus,
  TableDescription,
  TableEnvelopeBase,
  TableEvent,
  TableRef,
  TableSnapshot,
  UseDatabaseTable,
  UseTableList,
} from "./database";
export type { AttributeType, MentionMark, SyncEmbedRef, TypedAttributeValue } from "docblocks-core";
export {
  useBlock,
  useDoc,
  useMeta,
  usePresence,
  usePresenceSharing,
  useSelection,
  useSelectionView,
  useText,
} from "./hooks";
export type { PresenceCrypto, PresenceIdentity, PresencePeer, PresenceSharing, PresenceSharingMode } from "./presence";
export { FORMAT_PALETTE } from "./editing/format-toolbar";
export { useCoverAverageColor } from "./attributes/cover-tint";
export { ImportDocumentError, importDocument } from "./editing/import";
export { markToggleAction } from "./editing/keyboard";
export type { FormatMark } from "./editing/keyboard";
export { renderRuns } from "./text/runs";
export { MONO_FONT_STACK, SHAPE_FONT_OPTIONS, SHAPE_FONT_STACKS, UI_FONT_ID, UI_FONT_STACK } from "./fonts";
// The design system primitives (shared/ui) — styled by the compiled
// utility layer shipped inside docblocks-react-ui/styles.css.
export {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  badgeVariants,
  BareSelect,
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
  Input,
  Label,
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
  ScrollArea,
  Separator,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./shared/ui";

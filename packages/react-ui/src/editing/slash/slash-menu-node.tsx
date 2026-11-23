/** The slash menu's node: the editor-level hidden file input (the File
 *  command's OS picker's stand — it stands for the editor's whole
 *  lifetime) and the menu panel (the items / the pickers / the form). */
import type { ChangeEvent, RefObject } from "react";
import { useEffect, useRef } from "react";

import { Input } from "../../shared/ui/Input";
import { SlashMenu } from "./SlashMenu";
import type { SlashMenuState } from "./models";

interface SlashMenuNodeProps {
  rootRef: RefObject<HTMLElement | null>;
  state: SlashMenuState | null;
  fileClickRef: RefObject<{ open: () => void } | null>;
  handleFile: (file: File | null) => void;
  hover: (index: number) => void;
  pick: (index: number) => void;
  close: () => void;
  databasePick: boolean;
  databaseAvailable: boolean;
  cancelDatabasePick: () => void;
  commitDatabase: (tableId: string) => void;
  framePick: boolean;
  cancelFramePick: () => void;
  commitFrame: (frameId: string) => void;
  embedForm: boolean;
  cancelEmbedForm: () => void;
  commitEmbed: (src: string) => void;
}

function SlashMenuNode({
  rootRef,
  state,
  fileClickRef,
  handleFile,
  hover,
  pick,
  close,
  databasePick,
  databaseAvailable,
  cancelDatabasePick,
  commitDatabase,
  framePick,
  cancelFramePick,
  commitFrame,
  embedForm,
  cancelEmbedForm,
  commitEmbed,
}: SlashMenuNodeProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // The hidden file input's open ref (a programmatic click opens the OS
  // picker — no pointer events reach the editor).
  useEffect(() => {
    fileClickRef.current = fileInputRef.current !== null ? { open: () => fileInputRef.current?.click() } : null;
  });

  // The hidden file input of the File command: it stands for the editor's
  // whole lifetime — the OS picker stands bound to the element that opened
  // it, and the delivered file's change lands on that same element (a
  // conditional unmount would detach it and lose the delivery — the menu's
  // popover stands closed over the File's pick). A programmatic click
  // opens the picker (no pointer events reach the editor).
  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    const file = files !== null && files.length > 0 ? (files[0] ?? null) : null;
    event.target.value = "";
    handleFile(file);
  };
  const fileInput = (
    <Input
      ref={fileInputRef}
      type="file"
      data-slot="docblocks/slash-file-input"
      className="
        pointer-events-none absolute h-0 w-0 border-0 bg-transparent p-0 opacity-0 shadow-none
        file:h-0
        dark:bg-transparent
      "
      onChange={onFileChange}
    />
  );
  const menuNode = (
    <>
      {fileInput}
      {state !== null ? (
        <SlashMenu
          rootRef={rootRef}
          state={state}
          onHover={hover}
          onPick={pick}
          onClose={close}
          databasePick={databasePick}
          databaseAvailable={databaseAvailable}
          onDatabasePickCancel={cancelDatabasePick}
          onDatabaseCommit={commitDatabase}
          framePick={framePick}
          onFramePickCancel={cancelFramePick}
          onFrameCommit={commitFrame}
          embedForm={embedForm}
          onEmbedCancel={cancelEmbedForm}
          onEmbedCommit={commitEmbed}
        />
      ) : null}
    </>
  );

  return menuNode;
}

export { SlashMenuNode };

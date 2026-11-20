/** The format toolbar's LIST-TYPE menu (single-block paragraph / heading /
 * list-item targets only): a non-modal dropdown — a radio group that turns
 * the block into a bullet/numbered/to-do list (a list-item swap is a
 * `list` attr update; any other target is a changeBlockType) or into a
 * paragraph / a quote (the flat model: a list item's derived segment
 * re-attaches to the paragraph as its nested content — nothing is lost).
 * The portaled content keeps the bar's mousedown guard (a default
 * mousedown would blur the editable and kill the selection the gesture is
 * about to re-seat); the outside dismiss (pointer and focus) is
 * suppressed — the editor owns the focus, and the selection state owns
 * the visibility. */
import { useTranslation } from "react-i18next";

import { Button } from "../../shared/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../../shared/ui/DropdownMenu";
import { Menu as MenuIcon } from "../../shared/ui/icons";
import { preventDefault } from "../../shared/utils";
import { LIST_MENU_OPTIONS, MENU_SIDE_OFFSET_PX } from "./constants";

interface FormatListMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The radio group's value (the block's list attr / the paragraph / the quote's stand). */
  value: string;
  onOption: (option: (typeof LIST_MENU_OPTIONS)[number]["option"]) => void;
}

function FormatListMenu({ open, onOpenChange, value, onOption }: FormatListMenuProps) {
  const { t } = useTranslation("editor");
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title={t("formatToolbar.listType")}
          aria-label={t("formatToolbar.listType")}
          className="data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
        >
          <MenuIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={MENU_SIDE_OFFSET_PX}
        data-slot="docblocks/format-list-menu"
        onMouseDown={preventDefault}
        onPointerDownOutside={preventDefault}
        onFocusOutside={preventDefault}
      >
        <DropdownMenuRadioGroup value={value}>
          {LIST_MENU_OPTIONS.map(({ option, label, icon: Icon }) => (
            <DropdownMenuRadioItem
              key={option}
              value={option}
              data-list-option={option}
              title={t(label)}
              onSelect={() => onOption(option)}
            >
              <Icon className="size-4" />
              {t(label)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { FormatListMenu };
export type { FormatListMenuProps };

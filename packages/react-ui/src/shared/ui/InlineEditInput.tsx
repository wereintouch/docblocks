/**
 * The inline edit's input (the document meta's inline editors — the
 * header's title / the attributes panel's rows): the focus with the caret
 * seated at the end (no select-all) on mount, the commit on the blur /
 * the Enter (one write), the Escape cancels without a write (the guard
 * stops the blur's commit over the unmount).
 */
import { useEffect, useRef } from "react";

import { Input } from "./Input";

interface InlineEditInputProps {
  /** The value the edit starts from (the field's seed). */
  initial: string;
  /** The field's accessible name. */
  ariaLabel: string;
  /** The structural data-slot of the field. */
  slot: string;
  className?: string;
  /** The field's placeholder (the empty value's stand). */
  placeholder?: string;
  /** The blur / Enter commit (one write). */
  onCommit: (value: string) => void;
  /** The Escape cancel (no write). */
  onCancel: () => void;
}

function InlineEditInput({
  initial,
  ariaLabel,
  slot,
  className,
  placeholder,
  onCommit,
  onCancel,
}: InlineEditInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (input === null) return;
    input.focus();
    // The caret seats at the end (the edit continues the value — a
    // select-all would replace it on the first keystroke).
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  const commit = (value: string): void => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(value);
  };

  const onInputBlur = (event: React.FocusEvent<HTMLInputElement>) => commit(event.target.value);
  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit(event.currentTarget.value);
    } else if (event.key === "Escape") {
      // The guard stops the blur's commit (the unmount's blur).
      committedRef.current = true;
      onCancel();
    }
  };

  return (
    <Input
      ref={inputRef}
      data-slot={slot}
      aria-label={ariaLabel}
      placeholder={placeholder}
      defaultValue={initial}
      className={className}
      onBlur={onInputBlur}
      onKeyDown={onInputKeyDown}
    />
  );
}

export { InlineEditInput };
export type { InlineEditInputProps };

// @vitest-environment jsdom
// The inline edit's input: the seed's reseed over an open edit (a pristine
// field follows the incoming value, a typed draft stands), the commit's
// guard, and the Escape's cancel.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InlineEditInput } from "../src/shared/ui/InlineEditInput";

const SLOT = "test/inline-edit";

function field(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`[data-slot="${SLOT}"]`);
  expect(input, "the field should be rendered").not.toBeNull();
  return input!;
}

afterEach(cleanup);

describe("the inline edit's seed", () => {
  it("follows the incoming value over a pristine field (the reseed's stand)", () => {
    const onCommit = vi.fn();
    const { container, rerender } = render(
      <InlineEditInput initial="first" ariaLabel="Title" slot={SLOT} onCommit={onCommit} onCancel={() => {}} />
    );
    const input = field(container);
    expect(input.value).toBe("first");
    // The reader's value changes while the field stands untouched: the
    // field follows (the seed's reseed), nothing commits.
    rerender(
      <InlineEditInput initial="second" ariaLabel="Title" slot={SLOT} onCommit={onCommit} onCancel={() => {}} />
    );
    expect(field(container).value).toBe("second");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("keeps a typed draft over the incoming value (the input wins until the commit)", () => {
    const onCommit = vi.fn();
    const { container, rerender } = render(
      <InlineEditInput initial="first" ariaLabel="Title" slot={SLOT} onCommit={onCommit} onCancel={() => {}} />
    );
    const input = field(container);
    fireEvent.change(input, { target: { value: "draft" } });
    expect(input.value).toBe("draft");
    rerender(
      <InlineEditInput initial="second" ariaLabel="Title" slot={SLOT} onCommit={onCommit} onCancel={() => {}} />
    );
    // The draft stands (no clobber mid-edit) and the commit sends it.
    expect(field(container).value).toBe("draft");
    fireEvent.keyDown(field(container), { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("draft");
  });

  it("follows the incoming value again once the draft is typed back to the seed", () => {
    const onCommit = vi.fn();
    const { container, rerender } = render(
      <InlineEditInput initial="first" ariaLabel="Title" slot={SLOT} onCommit={onCommit} onCancel={() => {}} />
    );
    const input = field(container);
    fireEvent.change(input, { target: { value: "draft" } });
    // The user returns the field to the seed's value: it strides back to
    // the pristine stand (a following external change reseeds it).
    fireEvent.change(field(container), { target: { value: "first" } });
    rerender(
      <InlineEditInput initial="second" ariaLabel="Title" slot={SLOT} onCommit={onCommit} onCancel={() => {}} />
    );
    expect(field(container).value).toBe("second");
  });

  it("keeps the caret over a reseed (the offset's stand)", () => {
    const { container, rerender } = render(
      <InlineEditInput initial="abcdef" ariaLabel="Title" slot={SLOT} onCommit={() => {}} onCancel={() => {}} />
    );
    const input = field(container);
    input.focus();
    input.setSelectionRange(2, 2);
    rerender(
      <InlineEditInput initial="abcdefgh" ariaLabel="Title" slot={SLOT} onCommit={() => {}} onCancel={() => {}} />
    );
    expect(field(container).value).toBe("abcdefgh");
    expect(field(container).selectionStart).toBe(2);
  });

  it("cancels without a write over the Escape", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    const { container } = render(
      <InlineEditInput initial="first" ariaLabel="Title" slot={SLOT} onCommit={onCommit} onCancel={onCancel} />
    );
    fireEvent.keyDown(field(container), { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
});

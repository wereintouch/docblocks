// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EmojiPicker } from "../src/shared/ui/EmojiPicker";
import { AVATAR_EMOJI } from "../src/shared/ui/emoji-catalog";

afterEach(cleanup);

describe("EmojiPicker", () => {
  it("stands the catalog's options (the labels, the selected highlight) and reports the pick / the clear", () => {
    const picks: string[] = [];
    const clears: number[] = [];
    render(<EmojiPicker selected="🦊" onPick={(emoji) => picks.push(emoji)} onClear={() => clears.push(1)} />);
    // Every catalog option stands (the accessible label, the emoji's data pin).
    expect(document.querySelectorAll('[data-slot="docblocks/emoji-picker-option"]').length).toBe(AVATAR_EMOJI.length);
    const fox = screen.getByRole("button", { name: "Fox" }) as HTMLButtonElement;
    expect(fox.getAttribute("data-emoji")).toBe("🦊");
    expect(fox.getAttribute("aria-pressed")).toBe("true"); // the selected stand
    expect(screen.getByRole("button", { name: "Cat" }).getAttribute("aria-pressed")).toBe("false");
    // A pick reports the emoji (not the label).
    fireEvent.click(screen.getByRole("button", { name: "Rocket" }));
    expect(picks).toEqual(["🚀"]);
    // The clear reports.
    fireEvent.click(screen.getByRole("button", { name: "Remove avatar" }));
    expect(clears).toEqual([1]);
  });

  it("stands no selection when the avatar is absent", () => {
    render(<EmojiPicker selected={null} onPick={() => {}} onClear={() => {}} />);
    expect(
      [...document.querySelectorAll<HTMLElement>('[data-slot="docblocks/emoji-picker-option"]')].every(
        (el) => el.getAttribute("aria-pressed") === "false"
      )
    ).toBe(true);
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SlashEmbedForm } from "../src/editing/slash/SlashEmbedForm";

afterEach(cleanup);

const URL_PLACEHOLDER = "Embed URL (https://…)";
const UNSAFE_HINT = /Only absolute http/;

function renderForm() {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  render(<SlashEmbedForm onCommit={onCommit} onCancel={onCancel} />);
  const input = screen.getByPlaceholderText(URL_PLACEHOLDER) as HTMLInputElement;
  return { input, onCommit, onCancel };
}

describe("the slash's embed form stands the unsafe-scheme gate (the core's write posture)", () => {
  it("stands no commit over the javascript: src (the hint stands)", () => {
    const { input, onCommit } = renderForm();
    fireEvent.change(input, { target: { value: "javascript:alert(1)" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText(UNSAFE_HINT)).toBeTruthy();
  });

  it("stands no commit over the foreign data: src (the iframe kind stands the http(s) only)", () => {
    const { input, onCommit } = renderForm();
    fireEvent.change(input, { target: { value: "data:text/html,<script>x</script>" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText(UNSAFE_HINT)).toBeTruthy();
  });

  it("stands the https commit (the form stands the URL only — the kind's default is the commit's caller)", () => {
    const { input, onCommit } = renderForm();
    fireEvent.change(input, { target: { value: "https://example.com/embed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("https://example.com/embed");
  });

  it("stands the absolute http commit (the http scheme is a safe embed scheme too)", () => {
    const { input, onCommit } = renderForm();
    fireEvent.change(input, { target: { value: "http://example.com/embed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("http://example.com/embed");
  });

  it("the Escape cancels the form (the cancel's callback, no commit)", () => {
    const { input, onCommit, onCancel } = renderForm();
    fireEvent.change(input, { target: { value: "https://example.com/embed" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SlashEmbedForm } from "../src/editing/slash/SlashEmbedForm";

afterEach(cleanup);

const URL_PLACEHOLDER = "Embed URL (https://…)";

function renderForm() {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  render(<SlashEmbedForm onCommit={onCommit} onCancel={onCancel} />);
  const input = screen.getByPlaceholderText(URL_PLACEHOLDER) as HTMLInputElement;
  const kindSelect = document.querySelector("select");
  return { input, kindSelect, onCommit, onCancel };
}

describe("the slash's embed form stands the unsafe-scheme gate (the core's write posture)", () => {
  it("stands no commit over the javascript: src (the hint stands)", () => {
    const { input, onCommit } = renderForm();
    fireEvent.change(input, { target: { value: "javascript:alert(1)" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText(/Only absolute https/)).toBeTruthy();
  });

  it("stands no commit over the foreign data: src (the iframe kind)", () => {
    const { input, onCommit } = renderForm();
    fireEvent.change(input, { target: { value: "data:text/html,<script>x</script>" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByText(/Only absolute https/)).toBeTruthy();
  });

  it("stands the https commit over the default kind", () => {
    const { input, onCommit } = renderForm();
    fireEvent.change(input, { target: { value: "https://example.com/embed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({ kind: "iframe", src: "https://example.com/embed" });
  });

  it("stands the data:text/html commit over the html kind (the kind's purpose)", () => {
    const { input, kindSelect, onCommit } = renderForm();
    fireEvent.change(kindSelect!, { target: { value: "html" } });
    fireEvent.change(input, { target: { value: "data:text/html,<h1>hi</h1>" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith({ kind: "html", src: "data:text/html,<h1>hi</h1>" });
  });
});

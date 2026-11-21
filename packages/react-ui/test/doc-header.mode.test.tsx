// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DocHeader } from "../src/DocHeader";
import { newDoc } from "./doc-header.helpers";

describe("the document mode's switcher (the access level's gate)", () => {
  afterEach(cleanup);

  it("stands the switcher over the editor's level + the callback (the three modes)", () => {
    const doc = newDoc();
    render(<DocHeader doc={doc} view="page" onViewChange={() => {}} onModeChange={() => {}} />);
    expect(document.querySelector('[data-slot="docblocks/doc-header-mode"]')).not.toBeNull();
    // The default's stand: the edit's mode is active.
    expect(document.querySelector('[data-doc-header-mode-button="edit"]')?.getAttribute("aria-pressed")).toBe("true");
  });

  it("stands no switcher over the viewer's level (the published's forced stand)", () => {
    const doc = newDoc();
    render(<DocHeader doc={doc} view="page" onViewChange={() => {}} accessLevel="viewer" onModeChange={() => {}} />);
    expect(document.querySelector('[data-slot="docblocks/doc-header-mode"]')).toBeNull();
  });

  it("stands no switcher over the callback's absence (the consumer's no opt-in)", () => {
    const doc = newDoc();
    render(<DocHeader doc={doc} view="page" onViewChange={() => {}} />);
    expect(document.querySelector('[data-slot="docblocks/doc-header-mode"]')).toBeNull();
  });

  it("the Published's option stands disabled over the snapshot's absence, commits the pick otherwise", () => {
    const doc = newDoc();
    const modes: string[] = [];
    const { rerender } = render(
      <DocHeader doc={doc} view="page" onViewChange={() => {}} mode="view" onModeChange={(mode) => modes.push(mode)} />
    );
    const published = document.querySelector('[data-doc-header-mode-button="published"]') as HTMLButtonElement;
    expect(published.hasAttribute("disabled")).toBe(true);
    const view = document.querySelector('[data-doc-header-mode-button="view"]') as HTMLButtonElement;
    fireEvent.click(view);
    expect(modes).toEqual([]); // the current's value stands no commit
    fireEvent.click(document.querySelector('[data-doc-header-mode-button="edit"]') as HTMLButtonElement);
    expect(modes).toEqual(["edit"]);
    const snapshot = newDoc();
    rerender(
      <DocHeader
        doc={doc}
        view="page"
        onViewChange={() => {}}
        mode="published"
        onModeChange={(mode) => modes.push(mode)}
        publishedDoc={snapshot}
      />
    );
    expect(document.querySelector('[data-doc-header-mode-button="published"]')?.hasAttribute("disabled")).toBe(false);
  });

  it("the published's stand reads the meta from the snapshot (the live's meta stands off)", () => {
    const doc = newDoc();
    doc.setTitle("LIVE");
    const snapshot = newDoc();
    snapshot.setTitle("PUBLISHED");
    render(<DocHeader doc={doc} view="page" onViewChange={() => {}} mode="published" publishedDoc={snapshot} />);
    const title = document.querySelector('[data-slot="docblocks/doc-header-title"]');
    expect(title?.textContent).toBe("PUBLISHED");
  });

  it("the read-only's stand (the view's mode) stands the title display-only (no edit's entry)", () => {
    const doc = newDoc();
    doc.setTitle("Read only");
    render(<DocHeader doc={doc} view="page" onViewChange={() => {}} mode="view" onModeChange={() => {}} />);
    const title = document.querySelector('[data-slot="docblocks/doc-header-title"]');
    expect(title?.tagName).toBe("SPAN");
    fireEvent.click(title as HTMLElement);
    expect(document.querySelector('[data-slot="docblocks/doc-header-title-edit"]')).toBeNull();
  });

  it("the viewer's stand reads the meta from the doc (the doc IS the snapshot — the only stand the consumer passes)", () => {
    const snapshot = newDoc();
    snapshot.setTitle("PUBLISHED META");
    snapshot.setAvatar("📘");
    const { container } = render(<DocHeader doc={snapshot} view="page" onViewChange={() => {}} accessLevel="viewer" />);
    expect(container.querySelector('[data-slot="docblocks/doc-header-title"]')?.textContent).toBe("PUBLISHED META");
    expect(container.querySelector('[data-slot="docblocks/doc-header-avatar"]')?.textContent).toBe("📘");
  });

  it("the no-snapshot's published's stand stands the neutral's meta (the live's meta stands no leak)", () => {
    // The editor over the published's mode: no snapshot → the header
    // stands the neutral's stand (the Untitled's placeholder, the absent
    // avatar). The viewer over the absent's stand (no doc at all — the
    // reader's browser holds nothing) stands the same neutral's stand.
    const cases: Array<Record<string, unknown>> = [
      { mode: "published" as const, onModeChange: () => {}, doc: undefined },
      { accessLevel: "viewer" as const, doc: undefined },
    ];
    for (const props of cases) {
      const { container, unmount } = render(<DocHeader view="page" onViewChange={() => {}} {...props} />);
      expect(container.querySelector('[data-slot="docblocks/doc-header-title"]')?.textContent).toBe("Untitled");
      expect(container.querySelector('[data-slot="docblocks/doc-header-avatar"]')?.textContent).toBe("");
      unmount();
    }
  });
});

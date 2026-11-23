// @vitest-environment jsdom
// The viewport entry's hook: the above-the-fold eager stand, the observer's
// band flips, the eager fallback without an observer, and the cleanup.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useInView } from "../src/shared/hooks/use-in-view";

interface ObserverRecord {
  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit | undefined;
  observed: Element[];
  disconnected: boolean;
}

const observers: ObserverRecord[] = [];

class FakeIntersectionObserver {
  readonly record: ObserverRecord;

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.record = { callback, options, observed: [], disconnected: false };
    observers.push(this.record);
  }

  observe(element: Element): void {
    this.record.observed.push(element);
  }

  unobserve(): void {}

  disconnect(): void {
    this.record.disconnected = true;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

function standObservers(): void {
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
}

/** Every element's box sits at `top` (the fold's stand). */
function standRect(top: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    top,
    bottom: top + 100,
    left: 0,
    right: 100,
    width: 100,
    height: 100,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);
}

function enter(record: ObserverRecord, isIntersecting: boolean): void {
  act(() => {
    record.callback([{ isIntersecting } as IntersectionObserverEntry], record as unknown as IntersectionObserver);
  });
}

function Probe() {
  const { ref, inView } = useInView<HTMLDivElement>();
  return <div ref={ref} data-slot="probe" data-in-view={inView ? "true" : "false"} />;
}

function probe(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-slot="probe"]');
  expect(element, "the probe should render").not.toBeNull();
  return element!;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  observers.length = 0;
});

describe("useInView", () => {
  it("stands in view over a runtime without an IntersectionObserver (the eager fallback)", () => {
    render(<Probe />);
    expect(probe().getAttribute("data-in-view")).toBe("true");
  });

  it("stands in view at once above the fold (the observer never runs)", () => {
    standObservers();
    standRect(10);
    render(<Probe />);
    expect(probe().getAttribute("data-in-view")).toBe("true");
    expect(observers).toHaveLength(0);
  });

  it("follows the observer's first intersection below the fold (then stops tracking)", () => {
    standObservers();
    standRect(2_000);
    render(<Probe />);
    expect(probe().getAttribute("data-in-view")).toBe("false");
    expect(observers).toHaveLength(1);
    expect(observers[0]!.observed).toHaveLength(1);
    enter(observers[0]!, true);
    expect(probe().getAttribute("data-in-view")).toBe("true");
    // The first entry ends the tracking: the caller's work stands over the
    // in-view decision and the box's further moves do not gate it.
    expect(observers[0]!.disconnected).toBe(true);
  });

  it("stands the observer's preload band on the token's fallback (200%)", () => {
    standObservers();
    standRect(2_000);
    render(<Probe />);
    expect(observers[0]!.options?.rootMargin).toBe("200%");
  });

  it("reads the preload margin from the element's token", () => {
    standObservers();
    standRect(2_000);
    // jsdom computes nothing for the package's stylesheet; the token's read
    // stands the computed style's stand over the observed element.
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name: string) => (name === "--docblocks-image-preload-margin" ? " 37%" : ""),
    } as CSSStyleDeclaration);
    render(<Probe />);
    expect(observers[0]!.options?.rootMargin).toBe("37%");
  });

  it("stands in view over the disabled (eager) policy", () => {
    standObservers();
    standRect(2_000);
    function EagerProbe() {
      const { ref, inView } = useInView<HTMLDivElement>({ disabled: true });
      return <div ref={ref} data-slot="probe" data-in-view={inView ? "true" : "false"} />;
    }
    render(<EagerProbe />);
    expect(probe().getAttribute("data-in-view")).toBe("true");
    expect(observers).toHaveLength(0);
  });

  it("disconnects the observer on unmount", () => {
    standObservers();
    standRect(2_000);
    const { unmount } = render(<Probe />);
    expect(observers[0]!.disconnected).toBe(false);
    unmount();
    expect(observers[0]!.disconnected).toBe(true);
  });
});

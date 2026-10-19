// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useState } from "react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  FigureBorderSelector,
  Popover,
  PopoverTrigger,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../src/shared/ui";

afterEach(cleanup);

// Smoke test: every shared/ui component renders without crashing in its
// closed/neutral state. The shipped stylesheet contract (dist/styles.css)
// is pinned separately in styles-css.test.ts; this suite renders with no CSS.
describe("shared/ui smoke", () => {
  it("renders Button, Badge, Skeleton, Separator, Card and Alert", () => {
    render(
      <>
        <Button>Save</Button>
        <Badge>new</Badge>
        <Skeleton />
        <Separator />
        <Card>
          <CardHeader>
            <CardTitle>Title</CardTitle>
            <CardDescription>Subtitle</CardDescription>
          </CardHeader>
          <CardContent>Body</CardContent>
        </Card>
        <Alert>
          <AlertTitle>Heads up</AlertTitle>
          <AlertDescription>Something happened</AlertDescription>
        </Alert>
      </>
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDefined();
    expect(screen.getByText("new")).toBeDefined();
    expect(document.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="separator-root"]')).not.toBeNull();
    expect(screen.getByText("Title")).toBeDefined();
    expect(screen.getByText("Subtitle")).toBeDefined();
    expect(screen.getByText("Body")).toBeDefined();
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText("Heads up")).toBeDefined();
    expect(screen.getByText("Something happened")).toBeDefined();
  });

  it("renders ScrollArea with the thin-scrollbar contract (the consumer classes merge)", () => {
    render(
      <ScrollArea className="max-h-40 p-2">
        <p>scrollable content</p>
      </ScrollArea>
    );
    const el = document.querySelector('[data-slot="scroll-area"]');
    expect(el).not.toBeNull();
    // The thin native scrollbar (the theme border color over a transparent
    // track) + the keyboard-scroll focus ring stand on the base classes.
    expect(el!.className).toContain("[scrollbar-color:var(--border)_transparent]");
    expect(el!.className).toContain("scrollbar-thin");
    expect(el!.className).toContain("overflow-auto");
    // The consumer's classes merge in (twMerge: the max-h/p stand, no
    // class is dropped by the base).
    expect(el!.className).toContain("max-h-40");
    expect(el!.className).toContain("p-2");
    expect(screen.getByText("scrollable content")).toBeDefined();
  });

  it("renders Checkbox", () => {
    render(<Checkbox />);
    expect(screen.getByRole("checkbox")).toBeDefined();
  });

  it("renders Popover with a closed trigger", () => {
    render(
      <Popover>
        <PopoverTrigger>Open popover</PopoverTrigger>
      </Popover>
    );
    expect(screen.getByRole("button", { name: "Open popover" })).toBeDefined();
  });

  it("renders DropdownMenu with a closed trigger", () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
    expect(screen.getByRole("button", { name: "Open menu" })).toBeDefined();
    // The content is portal-mounted only when the menu is open.
    expect(screen.queryByText("Item")).toBeNull();
  });

  it("renders Select with a closed trigger", () => {
    render(
      <Select>
        <SelectTrigger>
          <SelectValue placeholder="Pick a value" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Alpha</SelectItem>
        </SelectContent>
      </Select>
    );
    // The trigger role is combobox (not name-from-content), so the name is
    // asserted through the rendered placeholder text instead.
    expect(screen.getByRole("combobox")).toBeDefined();
    expect(screen.getByText("Pick a value")).toBeDefined();
    expect(screen.queryByText("Alpha")).toBeNull();
  });

  it("renders Tabs with a list, triggers, and the active panel", () => {
    render(
      <Tabs defaultValue="one">
        <TabsList>
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="two">Two</TabsTrigger>
        </TabsList>
        <TabsContent value="one">First panel</TabsContent>
        <TabsContent value="two">Second panel</TabsContent>
      </Tabs>
    );
    expect(document.querySelector('[data-slot="tabs-list"]')).not.toBeNull();
    const tabs = Array.from(document.querySelectorAll<HTMLElement>("[data-slot='tabs-trigger']"));
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("false");
    expect(document.querySelector('[data-slot="tabs-content"]')?.textContent).toBe("First panel");
    // Radix 1.2 activates a tab on mousedown (a real click includes it;
    // a jsdom click-only dispatch would not reach the activation handler).
    fireEvent.mouseDown(tabs[1]!);
    expect(tabs[1]?.getAttribute("data-state")).toBe("active");
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");
    const activeContent = [...document.querySelectorAll<HTMLElement>('[data-slot="tabs-content"]')].find(
      (el) => el.getAttribute("data-state") === "active"
    );
    expect(activeContent?.textContent).toBe("Second panel");
  });

  it("renders Tooltip with a closed trigger", () => {
    render(
      <Tooltip>
        <TooltipTrigger>Show tip</TooltipTrigger>
        <TooltipContent>Bubble</TooltipContent>
      </Tooltip>
    );
    expect(screen.getByRole("button", { name: "Show tip" })).toBeDefined();
    expect(screen.queryByText("Bubble")).toBeNull();
  });
});

describe("FigureBorderSelector (the border's width dots)", () => {
  it("renders the dots (the handle stands on the current dot, the aria slider stands)", () => {
    render(<FigureBorderSelector points={4} value={1} onChange={() => undefined} label="Border width" />);
    const slider = screen.getByRole("slider", { name: "Border width" });
    expect(slider.getAttribute("aria-valuemax")).toBe("3");
    expect(slider.getAttribute("aria-valuenow")).toBe("1");
    expect(slider.getAttribute("aria-valuetext")).toBe("2");
    // The four dots (the track's line + the handle + the dots' spans: 4 dots).
    const dots = slider.querySelectorAll(".rounded-full");
    expect(dots.length).toBe(5); // the 4 dots + the handle
  });

  it("steps by the keyboard (the arrows / the edges, the clamped stand)", () => {
    const changes: number[] = [];
    function StatefulSelector({ start }: { start: number }) {
      const [value, setValue] = useState(start);
      return (
        <FigureBorderSelector
          points={4}
          value={value}
          onChange={(index) => {
            changes.push(index);
            setValue(index);
          }}
          label="Border width"
        />
      );
    }
    render(<StatefulSelector start={0} />);
    const slider = screen.getByRole("slider", { name: "Border width" });

    fireEvent.keyDown(slider, { key: "ArrowLeft" }); // the floor (0)
    expect(changes).toEqual([]);
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(changes).toEqual([1, 2]);

    changes.length = 0;
    cleanup();
    render(<StatefulSelector start={2} />);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Border width" }), { key: "End" });
    fireEvent.keyDown(screen.getByRole("slider", { name: "Border width" }), { key: "Home" });
    expect(changes).toEqual([3, 0]);
  });

  it("snaps to the nearest dot on the pointer's stand (the magnet's drag)", () => {
    const changes: number[] = [];
    function StatefulSelector() {
      const [value, setValue] = useState(0);
      return (
        <FigureBorderSelector
          points={4}
          value={value}
          onChange={(index) => {
            changes.push(index);
            setValue(index);
          }}
          label="Border width"
        />
      );
    }
    render(<StatefulSelector />);
    const slider = screen.getByRole("slider", { name: "Border width" });
    // The press + the move stand the snap's arithmetic on the stubbed
    // rect (the drag's real geometry is the e2e's pin).
    const rect = { left: 0, width: 64, top: 0, height: 20, right: 64, bottom: 20, x: 0, y: 0, toJSON: () => ({}) };
    Object.defineProperty(slider, "getBoundingClientRect", { value: () => rect, configurable: true });
    fireEvent.pointerDown(slider, { clientX: 58 }); // ~90% -> the dot 3
    expect(changes).toEqual([3]);
    fireEvent.pointerMove(slider, { clientX: 8, buttons: 1 }); // ~12% -> the dot 0
    expect(changes).toEqual([3, 0]);
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

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
  Popover,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../src/shared/ui";

afterEach(cleanup);

// Smoke test: every shared/ui component renders without crashing in its
// closed/neutral state. The compiled utility CSS contract (dist/ui.css)
// is pinned separately in ui-css.test.ts; this suite renders with no CSS.
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

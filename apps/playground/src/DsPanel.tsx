import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
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
} from "docblocks-react-ui";

import { useState } from "react";
import type { CSSProperties } from "react";

const row: CSSProperties = { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" };
const label: CSSProperties = { width: 110, fontSize: 12, color: "var(--muted-foreground)" };

/**
 * The design system preview (harness-only, `?ds=1`): the shared/ui
 * primitives rendered outside any editor root — the visual gate before the
 * wiring steps and the e2e surface for the compiled utility CSS
 * (the utility layer of the shipped docblocks-react-ui/styles.css: the
 * standard token seed, the dark: class variant, and the popup content
 * styling).
 */
function DsPanel() {
  const [checked, setChecked] = useState(true);
  return (
    <main className="grid gap-[14px] p-4 font-[family-name:system-ui,sans-serif] max-w-[780px]">
      <header>
        <h1 className="m-0 text-lg">docblocks — design system preview</h1>
        <p className="m-0 mt-1 text-[13px] text-(--muted-foreground)">
          The shared/ui primitives over the compiled utility CSS (the utility layer of docblocks-react-ui/styles.css).
          The dark set flips under the <code>.dark</code> class on <code>&lt;html&gt;</code> (no media query).
        </p>
      </header>

      <div style={row}>
        <span style={label}>Buttons</span>
        <Button data-testid="ds-btn-default">Default</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost" data-testid="ds-btn-ghost">
          Ghost
        </Button>
        <Button variant="link">Link</Button>
        <Button size="sm">Small</Button>
        <Button disabled>Disabled</Button>
      </div>

      <div style={row}>
        <span style={label}>Badges</span>
        <Badge data-testid="ds-badge">Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="destructive">Destructive</Badge>
        <Badge variant="outline">Outline</Badge>
      </div>

      <div style={row}>
        <span style={label}>Checkbox</span>
        <Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} data-testid="ds-checkbox" />
        <span className="text-[13px]">checked: {String(checked)}</span>
      </div>

      <div style={row}>
        <span style={label}>Popups</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" data-testid="ds-menu-trigger">
              Dropdown
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem data-testid="ds-menu-item">First item</DropdownMenuItem>
            <DropdownMenuItem>Second item</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Third item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" data-testid="ds-popover-trigger">
              Popover
            </Button>
          </PopoverTrigger>
          <PopoverContent>
            <div style={{ fontSize: 13, maxWidth: 200 }}>The popover content, styled by the utility CSS.</div>
          </PopoverContent>
        </Popover>
        <Select>
          <SelectTrigger size="sm" data-testid="ds-select-trigger" className="w-[140px]">
            <SelectValue placeholder="Pick" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="one">One</SelectItem>
            <SelectItem value="two">Two</SelectItem>
            <SelectItem value="three">Three</SelectItem>
          </SelectContent>
        </Select>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm">
              Tooltip
            </Button>
          </TooltipTrigger>
          <TooltipContent>The tooltip content</TooltipContent>
        </Tooltip>
        <ScrollArea data-testid="ds-scroll-area" className="h-24 w-40 rounded-md border border-border p-2">
          <div style={{ fontSize: 12, lineHeight: "18px" }}>
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i}>Row {i + 1}</div>
            ))}
          </div>
        </ScrollArea>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        <div style={row}>
          <span style={label}>Card</span>
          <Card className="w-[340px]" data-testid="ds-card">
            <CardHeader>
              <CardTitle>Card title</CardTitle>
              <CardDescription>The card description</CardDescription>
            </CardHeader>
            <CardContent className="text-[13px]">The card content.</CardContent>
            <CardFooter className="text-[13px]">The card footer.</CardFooter>
          </Card>
        </div>

        <div style={row}>
          <span style={label}>Alert</span>
          <Alert className="w-[340px]">
            <AlertTitle>The alert title</AlertTitle>
            <AlertDescription>The alert description.</AlertDescription>
          </Alert>
          <Alert variant="destructive" className="w-[340px]" data-testid="ds-alert-destructive">
            <AlertTitle>Destructive title</AlertTitle>
            <AlertDescription>The destructive alert description.</AlertDescription>
          </Alert>
        </div>

        <div style={row}>
          <span style={label}>Separators</span>
          <Separator className="w-[120px]" />
          <Separator orientation="vertical" className="h-6" />
          <span className="text-[13px]">between rows</span>
        </div>

        <div style={row}>
          <span style={label}>Skeleton</span>
          <Skeleton className="h-4 w-40" data-testid="ds-skeleton" />
        </div>
      </div>
    </main>
  );
}

export { DsPanel };

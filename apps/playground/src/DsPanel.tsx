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
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: 16,
        display: "grid",
        gap: 14,
        maxWidth: 780,
      }}
    >
      <header>
        <h1 style={{ margin: 0, fontSize: 18 }}>docblocks — design system preview</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted-foreground)" }}>
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
        <span style={{ fontSize: 13 }}>checked: {String(checked)}</span>
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
          <SelectTrigger size="sm" data-testid="ds-select-trigger" style={{ width: 140 }}>
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
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        <div style={row}>
          <span style={label}>Card</span>
          <Card style={{ width: 340 }} data-testid="ds-card">
            <CardHeader>
              <CardTitle>Card title</CardTitle>
              <CardDescription>The card description</CardDescription>
            </CardHeader>
            <CardContent style={{ fontSize: 13 }}>The card content.</CardContent>
            <CardFooter style={{ fontSize: 13 }}>The card footer.</CardFooter>
          </Card>
        </div>

        <div style={row}>
          <span style={label}>Alert</span>
          <Alert style={{ width: 340 }}>
            <AlertTitle>The alert title</AlertTitle>
            <AlertDescription>The alert description.</AlertDescription>
          </Alert>
          <Alert variant="destructive" style={{ width: 340 }} data-testid="ds-alert-destructive">
            <AlertTitle>Destructive title</AlertTitle>
            <AlertDescription>The destructive alert description.</AlertDescription>
          </Alert>
        </div>

        <div style={row}>
          <span style={label}>Separators</span>
          <Separator style={{ width: 120 }} />
          <Separator orientation="vertical" style={{ height: 24 }} />
          <span style={{ fontSize: 13 }}>between rows</span>
        </div>

        <div style={row}>
          <span style={label}>Skeleton</span>
          <Skeleton style={{ width: 160, height: 16 }} data-testid="ds-skeleton" />
        </div>
      </div>
    </main>
  );
}

export { DsPanel };

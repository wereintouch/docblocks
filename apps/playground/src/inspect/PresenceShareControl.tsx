import { Button, usePresenceSharing } from "docblocks-react-ui";

/**
 * The harness's sharing grant's control (the consumer-side UI over the
 * hook — the library ships hooks only, the UI is the consumer's stand):
 * the grant's flip buttons, rendered inside the provider (the hook's
 * context). The buttons stand the active grant's highlight.
 */
function PresenceShareControl({ client, peerUserId }: { client: "a" | "b"; peerUserId: string }) {
  const { sharing, setSharing } = usePresenceSharing();
  const target = Array.isArray(sharing) ? sharing : null;
  const label = sharing === "off" ? "off" : sharing === "everyone" ? "everyone" : sharing.join(", ");
  const btn = "h-auto gap-0 rounded px-2 py-0.5 text-xs font-normal shadow-none";
  return (
    <div
      data-testid={`presence-share-${client}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontSize: 12,
        color: "var(--muted-foreground)",
        padding: "4px 8px",
        flexWrap: "wrap",
      }}
    >
      <span>
        share: <strong data-testid={`presence-share-${client}-label`}>{label}</strong>
      </span>
      <Button
        type="button"
        size="sm"
        variant={sharing === "off" ? "default" : "outline"}
        className={btn}
        data-testid={`share-${client}-off`}
        aria-pressed={sharing === "off"}
        onClick={() => setSharing("off")}
      >
        off
      </Button>
      <Button
        type="button"
        size="sm"
        variant={sharing === "everyone" ? "default" : "outline"}
        className={btn}
        data-testid={`share-${client}-everyone`}
        aria-pressed={sharing === "everyone"}
        onClick={() => setSharing("everyone")}
      >
        everyone
      </Button>
      <Button
        type="button"
        size="sm"
        variant={target?.length === 1 && target[0] === peerUserId ? "default" : "outline"}
        className={btn}
        data-testid={`share-${client}-target`}
        aria-pressed={target?.length === 1 && target[0] === peerUserId}
        onClick={() => setSharing([peerUserId])}
      >
        {peerUserId}
      </Button>
      <Button
        type="button"
        size="sm"
        variant={target?.length === 1 && target[0] === "user-x" ? "default" : "outline"}
        className={btn}
        data-testid={`share-${client}-stranger`}
        aria-pressed={target?.length === 1 && target[0] === "user-x"}
        onClick={() => setSharing(["user-x"])}
      >
        user-x
      </Button>
    </div>
  );
}

export { PresenceShareControl };

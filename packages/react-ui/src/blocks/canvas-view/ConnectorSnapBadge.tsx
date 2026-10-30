/** The connector snap's stand (the hover snap and the preview end's snap —
 *  the endpoint drag's parity): the green circle at the snapped edge point
 *  (the dot's stand) + the Link badge outside along the port's outward
 *  normal (the "the point is connected" indicator, the endpoint drag's
 *  badge's parity). A world-space overlay (the 1x1 overflow-visible svg —
 *  the ConnectorLayer's parity), so it scales with the zoom. */
import { Link } from "../../shared/ui/icons";
import { PORT_NORMAL } from "../canvas-geometry";
import { CONNECT_COLOR, SNAP_BADGE_LIFT, SNAP_BADGE_RADIUS } from "../connector-constants";

function ConnectorSnapBadge({
  slot,
  point,
  port,
}: {
  slot: string;
  point: { x: number; y: number };
  port: "north" | "east" | "south" | "west";
}) {
  const normal = PORT_NORMAL[port];
  const badgeX = point.x + normal.nx * SNAP_BADGE_LIFT;
  const badgeY = point.y + normal.ny * SNAP_BADGE_LIFT;
  return (
    <svg
      data-slot={slot}
      className="pointer-events-none absolute top-1/2 left-1/2 overflow-visible"
      width={1}
      height={1}
    >
      <circle cx={point.x} cy={point.y} r={3.5} fill={CONNECT_COLOR} stroke={CONNECT_COLOR} strokeWidth={1} />
      <circle
        cx={badgeX}
        cy={badgeY}
        r={SNAP_BADGE_RADIUS}
        fill="var(--docblocks-canvas-surface-background, var(--card, #ffffff))"
        stroke={CONNECT_COLOR}
        strokeWidth={1.5}
      />
      <Link
        x={badgeX - 7}
        y={badgeY - 7}
        width={14}
        height={14}
        viewBox="0 0 24 24"
        fill="none"
        stroke={CONNECT_COLOR}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export { ConnectorSnapBadge };

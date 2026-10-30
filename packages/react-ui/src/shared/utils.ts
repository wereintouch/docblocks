/** Clamps a value into the inclusive [min, max] range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The DOM event's default-cancelling handler (the chrome's press stand). */
function preventDefault(event: { preventDefault: () => void }): void {
  event.preventDefault();
}

/** The DOM event's propagation-stopping handler (the inner chrome's press
 * stands over the outer gesture). */
function stopPropagation(event: { stopPropagation: () => void }): void {
  event.stopPropagation();
}

export { clamp, preventDefault, stopPropagation };

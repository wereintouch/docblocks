/** The option's label's measurement (the row's `text-sm`'s stand): the
 *  probe reads the label's width over the popover content's own font
 *  (the portaled content stands the body's font, not the editor's). */
function measureOptionLabelPx(label: string, fontFamily: string): number {
  const probe = document.createElement("span");
  probe.style.cssText = `position:fixed;left:-9999px;top:0;visibility:hidden;white-space:nowrap;font-size:14px;font-family:${fontFamily};`;
  probe.textContent = label;
  document.body.appendChild(probe);
  const width = probe.offsetWidth;
  probe.remove();
  return width;
}

export { measureOptionLabelPx };

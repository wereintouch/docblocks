// @vitest-environment jsdom
// The makeGroup / dissolveGroup commands' stands: the group over the
// same-surface selection in one transact (the members' stand, the single
// undo step), the ineligible selection's refusal, and the dissolve's stand
// (the non-group stands no dissolve).
import { describe, expect, it } from "vitest";

import { dissolveGroup, makeGroup } from "../src/canvas/insert";
import { seededDoc } from "./canvas-groups.helpers";

describe("the makeGroup / dissolveGroup commands", () => {
  it("stands the group over the same-surface selection in one transact", () => {
    const { doc, a, b } = seededDoc(false);
    const created = makeGroup(doc, [a, b]);
    expect(created).not.toBeNull();
    const group = doc.getBlock(created!);
    expect(group).toMatchObject({ type: "group", attrs: { members: [a, b] } });
    // The members stand where they are (the container is not a structural
    // parent — the membership is the weak ref list).
    expect(doc.getBlock(a)).not.toBeNull();
    expect(doc.getBlock(b)).not.toBeNull();
    // One undo step: the group goes, the members' geometry stands.
    const aBefore = doc.getBlock(a);
    doc.undo();
    expect(doc.getBlock(created!)).toBeNull();
    expect(doc.getBlock(a)).toEqual(aBefore);
  });

  it("refuses the ineligible selection (one member, the connector, the cross-surface)", () => {
    const { doc, a, b, c } = seededDoc(false);
    expect(makeGroup(doc, [a])).toBeNull(); // one member
    void c;
    const surface2 = doc.insertBlock("surface");
    const foreign = doc.insertBlock("shape", { variant: "rect" }, { parent: surface2 });
    doc.setGeometry(foreign, { x: 0, y: 0, w: 40, h: 40 });
    expect(makeGroup(doc, [a, foreign])).toBeNull(); // the cross-surface
    // A connector member (the same surface): the ineligible set.
    const surface = doc.getChildren(doc.meta.id).find((id) => doc.getBlock(id)?.type === "surface")!;
    const sameConnector = doc.insertBlock(
      "connector",
      { start: { blockId: a }, end: { blockId: b } },
      {
        parent: surface,
      }
    );
    expect(makeGroup(doc, [a, sameConnector])).toBeNull();
    // The doc stands unchanged (no group written).
    for (const id of doc.getChildren(doc.meta.id)) {
      for (const child of doc.getChildren(id)) expect(doc.getBlock(child)?.type).not.toBe("group");
    }
  });

  it("the dissolve removes the group, the members stand (the non-group stands no dissolve)", () => {
    const { doc, a, b } = seededDoc(true);
    const surface = doc.getChildren(doc.meta.id)[0]!;
    const group = doc.getChildren(surface).find((id) => doc.getBlock(id)?.type === "group")!;
    expect(dissolveGroup(doc, group)).toBe(true);
    expect(doc.getBlock(group)).toBeNull();
    expect(doc.getBlock(a)).not.toBeNull();
    expect(doc.getBlock(b)).not.toBeNull();
    expect(dissolveGroup(doc, a)).toBe(false); // the non-group: the caller's path owns it
    expect(doc.getBlock(a)).not.toBeNull();
  });
});

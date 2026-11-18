---
"docblocks-react-ui": patch
---

Fixed the code block's caption line losing the focus (and the empty line
unmounting) over a press of the caption's button while a caret stood in
the code: the page container's stranded-caret re-seat mistook the form
control's focus residue (the document selection standing a collapsed caret
at a container position while the input holds the focus) for a stranded
caret and re-seated it into the block on every frame, blurring the
just-seated input. The re-seat now stands no while a form control inside
the container holds the focus (the control's landing stands a genuine
one).

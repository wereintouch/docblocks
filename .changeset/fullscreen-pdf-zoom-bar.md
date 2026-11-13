---
"docblocks-react-ui": minor
---

Add a zoom bar to the PDF preview's fullscreen mode: a separate pill to the left of the page controls with the zoom in/out buttons (over the fitted scale, 25%-400% bounds), the scale indicator, the fit-width and the fit-height buttons (the page's width/height fills the viewport's width/height, the overflow scrolls). The fullscreen mode pages with the left/right arrow keys, locks the body's scroll while open (the wheel over the overlay no longer scrolls the page behind), and stands a fixed-width page indicator (a digit count change no longer shifts the page buttons). The preview chrome stands no text selection (the page indicator and the controls are not document content), so selecting the page numbers can no longer flag the block or pull up the format toolbar.

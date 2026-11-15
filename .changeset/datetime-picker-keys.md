---
"docblocks-react-ui": patch
---

The filter builder's date-and-time value picker (the shared
`DateTimePicker`) stands the same key contract as the database grid's
datetime cell: Enter commits the draft (the picked date + the typed time)
and closes the picker, Escape cancels the in-flight draft without a
write; the close over the outside press / the trigger press keeps the
deferred commit stand.

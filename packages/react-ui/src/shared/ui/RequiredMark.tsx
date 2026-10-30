/**
 * The required-field marker: a red asterisk (the theme `--destructive`)
 * rendered right after a form field's title in the create / update forms.
 */
function RequiredMark() {
  return (
    <span aria-hidden className="ml-0.5 text-destructive">
      *
    </span>
  );
}

export { RequiredMark };

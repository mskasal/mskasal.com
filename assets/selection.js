export function bindSelectionEvents(
  onSelectionChange,
  onSelectionStart,
  onSelectionEnd,
) {
  document.addEventListener('selectstart', () => {
    if (!onSelectionStart) {
      console.warn('Missing onSelectionStart callback');
      return;
    }
    onSelectionStart();
  });

  document.addEventListener('selectionchange', () => {
    if (!onSelectionChange) {
      console.warn('Missing onSelectionChange callback');
      return;
    }

    const selection = document.getSelection();

    const rangeCount = selection.rangeCount;

    if (rangeCount === 0) {
      return;
    }

    const currentSelectionRange = selection.getRangeAt(0);

    onSelectionChange(currentSelectionRange);
  });

  document.addEventListener('mouseup', () => {
    if (!onSelectionEnd) {
      console.warn('Missing onSelectionEnd callback');
      return;
    }
    const selection = document.getSelection();

    const rangeCount = selection.rangeCount;
    const isCollapsed = selection.isCollapsed;

    if (rangeCount === 0 || isCollapsed) {
      return;
    }

    const ranges = selection.getComposedRanges();
    onSelectionEnd(ranges);
  });
}

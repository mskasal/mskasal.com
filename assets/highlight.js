export function highlight(hightlightName, ranges) {
  if (!hightlightName) {
    throw 'Highlight requires a name';
  }

  if (ranges.length < 1) {
    console.warn('No range found');
  }

  const newHighlight = new Highlight(...ranges);
  CSS.highlights.set(hightlightName, newHighlight);
}

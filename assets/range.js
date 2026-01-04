export function createRange(node, rangeArray) {
  const [start, end] = rangeArray;

  const newRange = new Range();
  newRange.setStart(node, start);
  newRange.setEnd(node, end);

  return newRange;
}

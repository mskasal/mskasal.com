import { highlight } from './highlight.js';
import { createRange } from './range.js';
import { bindSelectionEvents } from './selection.js';

const myRange = createRange(personalInformation, [1, 3]);
highlight('my-persistent', [myRange]);

bindSelectionEvents((range) => {
  if (!range.collapsed) {
    highlight('my-persistent', [range]);
  }
});

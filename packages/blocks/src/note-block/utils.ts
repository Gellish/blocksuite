import type { BlockSelection } from '@blocksuite/block-std';
import { PathFinder } from '@blocksuite/block-std';
import type { BlockElement } from '@blocksuite/lit';
import { getTextNodesFromElement } from '@blocksuite/virgo';

import {
  EDGELESS_BLOCK_CHILD_BORDER_WIDTH,
  EDGELESS_BLOCK_CHILD_PADDING,
} from '../_common/consts.js';
import { almostEqual } from '../_common/utils/math.js';
import { isEdgelessPage } from '../_common/utils/query.js';
import {
  autoScroll,
  caretFromPoint,
} from '../page-block/text-selection/utils.js';
import { getClosestPageBlockComponent } from '../page-block/utils/query.js';
import { deserializeXYWH } from '../surface-block/index.js';
import type { NoteBlockComponent } from './note-block.js';

const getSelection = (blockComponent: BlockElement) =>
  blockComponent.root.selection;

const getView = (blockComponent: BlockElement) => blockComponent.root.view;

export const pathToBlock = (blockElement: BlockElement, path: string[]) =>
  getView(blockElement).viewFromPath('block', path);

export const ensureBlockInContainer = (
  blockElement: BlockElement,
  containerElement: BlockElement
) =>
  containerElement.contains(blockElement) && blockElement !== containerElement;

export function getNextSibling(
  blockElement: BlockElement,
  filter?: (block: BlockElement) => boolean
) {
  const view = getView(blockElement);
  const nextView = view.findNext(blockElement.path, node => {
    if (node.type !== 'block' || node.view.contains(blockElement)) {
      return;
    }
    if (filter && !filter(node.view as BlockElement)) {
      return;
    }
    return true;
  });
  if (!nextView) return null;
  return view.viewFromPath('block', nextView.path);
}

export function getPrevSibling(
  blockElement: BlockElement,
  filter?: (block: BlockElement) => boolean
) {
  const view = getView(blockElement);
  const nextView = view.findPrev(blockElement.path, node => {
    if (node.type !== 'block') {
      return;
    }
    if (filter && !filter(node.view as BlockElement)) {
      return;
    }
    return true;
  });
  if (!nextView) return null;
  return view.viewFromPath('block', nextView.path);
}

function getLastGrandChild(blockElement: BlockElement) {
  const view = getView(blockElement);
  let output = blockElement;
  view.walkThrough((node, _index, parent) => {
    if (
      node.children.filter(n => n.type === 'block').length === 0 &&
      parent.children.filter(n => n.type === 'block').at(-1) === node
    ) {
      output = node.view as BlockElement;
      return true;
    }
    return;
  }, blockElement.path);
  return output;
}

export function setBlockSelection(blockElement: BlockElement) {
  const selection = getSelection(blockElement);
  const path = blockElement.path;
  selection.update(selList => {
    return selList
      .filter(sel => !sel.is('text') && !sel.is('block'))
      .concat(selection.getInstance('block', { path }));
  });
}

export function setTextSelectionBySide(
  blockElement: BlockElement,
  tail: boolean
) {
  const selection = getSelection(blockElement);
  const path = blockElement.path;

  selection.setGroup('note', [
    selection.getInstance('text', {
      from: {
        path,
        index: tail ? blockElement.model.text?.length ?? 0 : 0,
        length: 0,
      },
      to: null,
    }),
  ]);
}

export function getBlockSelectionBySide(
  blockElement: BlockElement,
  tail: boolean
) {
  const selection = getSelection(blockElement);
  const selections = selection.value.filter(sel => sel.is('block'));
  const sel = selections.at(tail ? -1 : 0) as BlockSelection | undefined;
  return sel ?? null;
}

export function getTextSelection(blockElement: BlockElement) {
  const selection = getSelection(blockElement);
  return selection.find('text');
}

function getAnchorBlockSelection(blockElement: BlockElement) {
  const selection = getSelection(blockElement);
  const selections = selection.value.filter(
    sel => sel.is('text') || sel.is('block')
  );
  const sel = selections.find(sel =>
    PathFinder.equals(sel.path, blockElement.path)
  );
  if (!sel) return null;

  return sel;
}

export function getNextBlock(
  blockElement: BlockElement,
  filter?: (block: BlockElement) => boolean
) {
  const focus = getAnchorBlockSelection(blockElement);
  if (!focus) return null;

  const view = getView(blockElement);
  const focusBlock = view.viewFromPath('block', focus.path);
  if (!focusBlock) return null;

  let next: BlockElement | null = null;
  if (focusBlock.childBlockElements[0]) {
    next = focusBlock.childBlockElements[0];
  }

  if (!next) {
    next = getNextSibling(focusBlock, filter);
  }

  if (next && !next.contains(focusBlock)) {
    return next;
  }

  return null;
}

export function getPrevBlock(
  blockElement: BlockElement,
  filter?: (block: BlockElement) => boolean
) {
  const focus = getAnchorBlockSelection(blockElement);
  if (!focus) return null;

  const view = getView(blockElement);
  const focusBlock = view.viewFromPath('block', focus.path);
  if (!focusBlock) return null;

  let prev: BlockElement | null = getPrevSibling(focusBlock, filter);

  if (!prev) {
    return null;
  }

  if (!prev.contains(focusBlock)) {
    prev = getLastGrandChild(prev);
  }

  if (prev && prev !== blockElement) {
    return prev;
  }

  return null;
}

export function selectBetween(
  anchorBlock: BlockElement,
  focusBlock: BlockElement,
  tail: boolean
) {
  const selection = getSelection(anchorBlock);
  if (PathFinder.equals(anchorBlock.path, focusBlock.path)) {
    setBlockSelection(focusBlock);
    return;
  }
  const selections = [...selection.value];
  if (selections.every(sel => !PathFinder.equals(sel.path, focusBlock.path))) {
    if (tail) {
      selections.push(
        selection.getInstance('block', { path: focusBlock.path })
      );
    } else {
      selections.unshift(
        selection.getInstance('block', { path: focusBlock.path })
      );
    }
  }

  let start = false;
  const sel = selections.filter(sel => {
    if (
      PathFinder.equals(sel.path, anchorBlock.path) ||
      PathFinder.equals(sel.path, focusBlock.path)
    ) {
      start = !start;
      return true;
    }
    return start;
  });

  selection.update(selList => {
    return selList
      .filter(sel => !sel.is('text') && !sel.is('block'))
      .concat(sel);
  });
}

export function getCurrentCaretPos(tail: boolean) {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const rects = range.getClientRects();

  return tail ? rects[rects.length - 1] : rects[0];
}

export function horizontalGetNextCaret(
  point: { x: number; y: number },
  block: BlockElement,
  forward = false,
  span = 5
) {
  const current = getCurrentCaretPos(true);
  if (!current) {
    return;
  }

  const rect = block.getBoundingClientRect();

  let _point = {
    x:
      point.x >= rect.left && point.x <= rect.right
        ? point.x
        : point.x < rect.left
        ? rect.left
        : rect.right,
    y:
      point.y >= rect.top && point.y <= rect.bottom
        ? point.y
        : forward && point.y > rect.bottom
        ? rect.bottom - span
        : !forward && point.y < rect.top
        ? rect.top + span
        : point.y,
  };

  let move = caretFromPoint(_point.x, _point.y);

  const needContinue = () => {
    if (!move) {
      return false;
    }
    if (!block.contains(move.node)) {
      return false;
    }
    if (current && Math.abs(current.y - _point.y) < span) {
      return true;
    }
    if (move.node.nodeType === Node.TEXT_NODE) {
      return false;
    }
    return true;
  };

  while (needContinue()) {
    _point = {
      x: _point.x,
      y: _point.y + (forward ? -1 * span : span),
    };
    move = caretFromPoint(_point.x, _point.y);
  }

  if (move && !block.contains(move.node)) {
    return;
  }

  return move;
}

export function moveCursor(caret: { node: Node; offset: number }) {
  const prevCursor = getCurrentCaretPos(true);

  const selection = document.getSelection();
  if (!selection) {
    return;
  }

  const { node, offset } = caret;

  const nextRange = document.createRange();
  nextRange.setStart(node, offset);
  selection.removeAllRanges();
  selection.addRange(nextRange);

  const element = node.parentElement;
  element?.scrollIntoView({ block: 'nearest' });

  const finalCursor = getCurrentCaretPos(true);

  if (
    !finalCursor ||
    (prevCursor &&
      prevCursor.x === finalCursor.x &&
      prevCursor.y === finalCursor.y)
  ) {
    return false;
  }

  return true;
}

export function moveCursorVertically(
  blockElement: BlockElement,
  forward: boolean
) {
  const selection = document.getSelection();
  if (!selection) {
    return false;
  }

  const cursorRect = getCurrentCaretPos(true);

  if (!cursorRect) {
    return false;
  }

  const nextCaret = horizontalGetNextCaret(
    {
      x: cursorRect.x,
      y: forward
        ? cursorRect.top - cursorRect.height / 2
        : cursorRect.bottom + cursorRect.height / 2,
    },
    blockElement,
    forward,
    cursorRect.height / 2
  );

  if (!nextCaret) {
    return;
  }

  return moveCursor(nextCaret);
}

export function moveCursorToBlock(blockElement: BlockElement, tail: boolean) {
  const texts = getTextNodesFromElement(blockElement);
  const text = tail ? texts[texts.length - 1] : texts[0];
  if (!text) {
    return false;
  }
  const nextCaret = {
    node: text,
    offset: tail ? text.textContent?.length ?? 0 : 0,
  };

  const success = moveCursor(nextCaret);
  if (!success) {
    return false;
  }

  const selection = document.getSelection();
  if (!selection) {
    return;
  }
  const range = selection.getRangeAt(0);
  const viewport = blockElement.closest('affine-doc-page')?.viewportElement;
  if (viewport) {
    autoScroll(viewport, range.getBoundingClientRect().top);
  }

  return true;
}

export function tryUpdateNoteSize(noteElement: NoteBlockComponent) {
  requestAnimationFrame(() => {
    const page = noteElement.page;
    if (!page.root) return;

    let zoom = 1;
    const pageElement = getClosestPageBlockComponent(noteElement);
    if (pageElement && isEdgelessPage(pageElement)) {
      zoom = pageElement.surface.viewport.zoom;
    }

    const bound = noteElement.getBoundingClientRect();
    const [x, y, w, h] = deserializeXYWH(noteElement.model.xywh);
    const newModelHeight =
      bound.height / zoom +
      EDGELESS_BLOCK_CHILD_PADDING * 2 +
      EDGELESS_BLOCK_CHILD_BORDER_WIDTH * 2;
    if (!almostEqual(newModelHeight, h)) {
      page.updateBlock(noteElement.model, {
        xywh: JSON.stringify([x, y, w, Math.round(newModelHeight)]),
      });
    }
  });
}

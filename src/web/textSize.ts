import { useCallback, useEffect, useState } from 'react';
import { parseTextSize, textAttribute, TEXT_STORAGE, type TextSize } from './textSizeValue';

/**
 * The text size this device asked for, kept on `<html data-text>`.
 *
 * Modelled on `theme.ts`: the pre-paint script in `index.html` stamps the
 * stored size before the first frame, so the room never paints small and then
 * jumps; this keeps it in step once React is up. The stylesheet does the rest
 * (`:root[data-text]` in tokens.css sets the root font size, and everything in
 * `rem` follows).
 */
export type { TextSize };

function storedTextSize(): TextSize {
  try {
    return parseTextSize(localStorage.getItem(TEXT_STORAGE));
  } catch {
    // A browser that refuses storage gets the normal size.
    return 'normal';
  }
}

function apply(size: TextSize): void {
  const root = document.documentElement;
  const value = textAttribute(size);
  if (value === null) delete root.dataset.text;
  else root.dataset.text = value;
}

export function useTextSize(): [TextSize, (size: TextSize) => void] {
  const [size, setSizeState] = useState<TextSize>(() => storedTextSize());

  useEffect(() => {
    apply(size);
  }, [size]);

  const setSize = useCallback((next: TextSize) => {
    setSizeState(next);
    try {
      localStorage.setItem(TEXT_STORAGE, next);
    } catch {
      // Remembering is a convenience, not a requirement.
    }
  }, []);

  return [size, setSize];
}

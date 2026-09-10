import { useEffect, useRef, type ReactNode } from 'react';
import { useT } from './i18n';

/**
 * A thing you open, look at, and close again.
 *
 * Built on the native `<dialog>` rather than a div with a high z-index: the
 * platform already does the focus trap, the Escape key, the inert background
 * and the backdrop, and every one of those is a thing a hand-rolled overlay
 * gets subtly wrong.
 */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useT();
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (el === null || el.open) return;
    el.showModal();
    // Not closed here on unmount: React has already removed the element by
    // then, and `close()` on a detached dialog does nothing anyway.
  }, []);

  return (
    <dialog
      ref={dialog}
      className="sheet"
      // Fires for Escape as well as close(), so this is the single exit.
      onClose={onClose}
      onClick={(event) => {
        // A click that lands on the dialog itself rather than on anything
        // inside it is a click on the backdrop.
        if (event.target === dialog.current) dialog.current?.close();
      }}
    >
      <header className="sheet-head">
        <h2>{title}</h2>
        <button type="button" className="link" onClick={() => dialog.current?.close()}>
          {t('sheet.close')}
        </button>
      </header>
      <div className="sheet-body">{children}</div>
    </dialog>
  );
}

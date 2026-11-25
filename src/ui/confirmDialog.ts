interface ConfirmOptions {
  title: string;
  /** Plain text; blank lines start a new paragraph. */
  message?: string;
  /** Label of the button that goes ahead, e.g. "Remove all". */
  confirmLabel: string;
  /** Red confirm button, for something that deletes or replaces. */
  danger?: boolean;
}

/**
 * Asks a yes/no question in the app's own dialog, in place of the browser's confirm() box
 * (which drops down from the top of the window and looks different in every browser).
 * Resolves true when the person confirms; Esc, Cancel or a click outside resolve false.
 */
export function confirmDialog({ title, message, confirmLabel, danger }: ConfirmOptions): Promise<boolean> {
  const dialog = document.createElement('dialog');
  dialog.className = 'confirm-dialog';

  const heading = document.createElement('h2');
  heading.textContent = title;
  dialog.append(heading);
  for (const para of (message ?? '').split(/\n\s*\n/).filter(Boolean)) {
    const p = document.createElement('p');
    p.textContent = para.trim();
    dialog.append(p);
  }

  const actions = document.createElement('div');
  actions.className = 'dialog-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.className = danger ? 'confirm-danger' : 'confirm-primary';
  ok.textContent = confirmLabel;
  actions.append(cancel, ok);
  dialog.append(actions);
  document.body.append(dialog);

  return new Promise((resolve) => {
    let answer = false;
    cancel.addEventListener('click', () => dialog.close());
    ok.addEventListener('click', () => {
      answer = true;
      dialog.close();
    });
    // A click on the dimmed area around the box cancels.
    dialog.addEventListener('mousedown', (e) => {
      if (e.target === dialog) {
        const r = dialog.getBoundingClientRect();
        const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (!inside) dialog.close();
      }
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(answer);
    });
    dialog.showModal();
    // Deleting is a step back from: the safe choice has the focus, so Enter cancels.
    (danger ? cancel : ok).focus();
  });
}

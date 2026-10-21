/** Copies text, through the Clipboard API where the page allows it and a selected textarea otherwise. */
export async function copyText(text: string, container: Node): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);

      return true;
    }
  } catch {
    // Not a secure context, or permission denied; the fallback may still work.
  }

  const document = container.ownerDocument ?? globalThis.document;

  if (!document) return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
  // Selecting moves focus; it goes back to the button that copied.
  const focused = (container.getRootNode() as Document | ShadowRoot).activeElement as HTMLElement | null;
  // Inside the overlay's shadow root, so the page's focus and selection listeners don't see it.
  container.appendChild(textarea);

  try {
    textarea.select();

    return document.execCommand?.('copy') ?? false;
  } catch {
    return false;
  } finally {
    textarea.remove();
    focused?.focus?.();
  }
}

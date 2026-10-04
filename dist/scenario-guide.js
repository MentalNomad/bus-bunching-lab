export async function copyExample(text, { clipboard, status, fallback }) {
  try {
    await clipboard.writeText(text);
    fallback.hidden = true;
    status.textContent = 'Complete scenario copied. Paste it into Import scenario in your lab tab.';
  } catch {
    fallback.value = text;
    fallback.hidden = false;
    fallback.focus();
    fallback.select();
    status.textContent =
      'Automatic copy is unavailable. The complete text is selected below; use your device’s Copy command, or download the JSON file.';
  }
}

if (typeof document !== 'undefined') {
  for (const button of document.querySelectorAll('[data-copy-example]')) {
    button.hidden = false;
    button.addEventListener('click', async () => {
      const id = button.dataset.copyExample;
      await copyExample(document.getElementById(id).textContent, {
        clipboard: globalThis.navigator?.clipboard,
        status: document.getElementById(`${id}-status`),
        fallback: document.getElementById(`${id}-fallback`),
      });
    });
  }
}

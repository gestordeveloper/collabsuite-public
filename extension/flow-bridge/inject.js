// Roda no contexto da própria página do Flow. O content script avisa (evento "fb-files") quais imagens enviar; quando o
// Flow tenta abrir a janela de seleção de arquivos (input[type=file].click(), showPicker() ou showOpenFilePicker()),
// entregamos essas imagens no lugar, sem abrir a janela do sistema.
(() => {
  let pending = null;

  const build = (files) => {
    const list = [];
    for (const f of files) {
      const bin = atob(f.b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      list.push(new File([bytes], f.name, { type: f.mime }));
    }
    return list;
  };

  const fill = (input) => {
    if (!pending) return false;
    const dt = new DataTransfer();
    for (const f of build(pending)) dt.items.add(f);
    pending = null;
    input.files = dt.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };

  const origClick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () {
    if (this.type === "file" && pending) { fill(this); return; }
    return origClick.apply(this, arguments);
  };
  if (HTMLInputElement.prototype.showPicker) {
    const origShow = HTMLInputElement.prototype.showPicker;
    HTMLInputElement.prototype.showPicker = function () {
      if (this.type === "file" && pending) { fill(this); return; }
      return origShow.apply(this, arguments);
    };
  }
  if (window.showOpenFilePicker) {
    const origPicker = window.showOpenFilePicker.bind(window);
    window.showOpenFilePicker = async (...args) => {
      if (!pending) return origPicker(...args);
      const files = build(pending);
      pending = null;
      return files.map((file) => ({ kind: "file", name: file.name, getFile: async () => file }));
    };
  }

  window.addEventListener("fb-files", (ev) => { pending = ev.detail.files; });
  // plano B: o Flow não chamou nenhuma API de seleção; se existir um input[type=file] na página, preenche ele
  window.addEventListener("fb-fallback", () => {
    let ok = !pending;
    if (pending) {
      const input = [...document.querySelectorAll("input[type=file]")].pop();
      if (input) ok = fill(input);
    }
    pending = null;
    window.dispatchEvent(new CustomEvent("fb-state", { detail: { consumed: ok } }));
  });
})();

(function () {
  'use strict';

  const preview = document.getElementById('preview');
  let currentRequestId = '';

  function sendStatus(status, message = '', requestId = currentRequestId) {
    window.parent.postMessage({
      type: 'tabwall-note-code-status',
      requestId,
      status,
      message: String(message || '').slice(0, 500),
    }, '*');
  }

  function encodePayload(payload) {
    const text = unescape(encodeURIComponent(JSON.stringify(payload)));
    let binary = '';
    for (let i = 0; i < text.length; i++) binary += String.fromCharCode(text.charCodeAt(i));
    return btoa(binary);
  }

  function buildPreviewDocument(payload) {
    const encoded = encodePayload({
      webSource: typeof payload.webSource === 'string' ? payload.webSource : '',
    });
    const bootstrap = [
      '<!doctype html><html><head><meta charset="utf-8">',
      '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; img-src data: blob:; style-src &#39;unsafe-inline&#39;; script-src &#39;unsafe-inline&#39;; connect-src &#39;none&#39;; font-src data:; object-src &#39;none&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;;">',
      '<style>html,body{margin:0;min-height:100%;font:14px/1.5 system-ui,sans-serif}body{padding:12px;box-sizing:border-box}</style>',
      '</head><body></body><script>',
      '(() => {',
      'const raw = atob("',
      encoded,
      '");',
      'const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));',
      'const payload = JSON.parse(decodeURIComponent(new TextDecoder().decode(bytes)));',
      'const report = (status, message) => parent.postMessage({ type: "tabwall-note-code-inner-status", status, message }, "*");',
      'let failed = false;',
      'window.addEventListener("error", (event) => { failed = true; report("error", event.message || "JavaScript error"); });',
      'window.addEventListener("unhandledrejection", (event) => { failed = true; report("error", event.reason?.message || String(event.reason || "Unhandled promise rejection")); });',
      'try {',
      'const parsed = new DOMParser().parseFromString(payload.webSource, "text/html");',
      'const scripts = [];',
      'parsed.querySelectorAll("script").forEach((node) => { if (!node.src) scripts.push(node.textContent || ""); node.remove(); });',
      'parsed.querySelectorAll("meta[http-equiv],base,link,iframe,object,embed,form").forEach((node) => node.remove());',
      'parsed.querySelectorAll("*").forEach((node) => [...node.attributes].forEach((attribute) => {',
      'const value = String(attribute.value || ""); const blockedUrl = /^(?:javascript|vbscript):/i.test(value); const safeUrl = /^(#|data:image\\/(?:png|gif|jpe?g|webp);|blob:)/i.test(value);',
      'if (/^on/i.test(attribute.name) || /^(action|formaction|srcdoc)$/i.test(attribute.name) || blockedUrl || (/^(href|src|xlink:href|srcset)$/i.test(attribute.name) && !safeUrl)) node.removeAttribute(attribute.name);',
      '}));',
      'parsed.querySelectorAll("style").forEach((node) => { node.textContent = String(node.textContent || "").replace(/@import[^;]+;?/gi, "").replace(/url\\(\\s*["\\\' ]*https?:[^)]*\\)/gi, ""); });',
      'for (const node of [...parsed.head.childNodes]) document.head.appendChild(document.importNode(node, true));',
      'for (const node of [...parsed.body.childNodes]) document.body.appendChild(document.importNode(node, true));',
      'for (const source of scripts) { const script = document.createElement("script"); script.textContent = source; document.body.appendChild(script); }',
      'setTimeout(() => { if (!failed) report("ready", ""); }, 0);',
      '} catch (error) { report("error", error?.message || String(error)); }',
      '})();',
      '<\/script></html>',
    ].join('');
    return bootstrap;
  }

  function render(payload) {
    currentRequestId = String(payload.requestId || '');
    sendStatus('running');
    preview.srcdoc = buildPreviewDocument(payload);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.type !== 'tabwall-note-code-render') return;
    render(data);
  });
  window.addEventListener('message', (event) => {
    if (event.source !== preview.contentWindow) return;
    const data = event.data;
    if (!data || data.type !== 'tabwall-note-code-inner-status') return;
    sendStatus(data.status, data.message);
  });
  sendStatus('ready');
})();

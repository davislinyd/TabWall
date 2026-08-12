(() => {
  const input = document.getElementById('qsInput');
  const list = document.getElementById('qsList');
  let hits = [];
  let index = 0;
  let timer = 0;

  function render() {
    list.replaceChildren();
    hits.forEach((hit, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'qs-row' + (i === index ? ' active' : '');
      const title = document.createElement('strong');
      title.textContent = hit.title || hit.url || hit.id;
      const meta = document.createElement('span');
      meta.textContent = hit.kind === 'note' ? (hit.markdown || hit.note || '') : (hit.url || hit.note || '');
      row.append(title, meta);
      row.addEventListener('click', (event) => restore(hit, event.shiftKey));
      list.appendChild(row);
    });
  }

  function restore(hit, openWall) {
    if (!hit?.id) return;
    if (openWall) {
      chrome.runtime.sendMessage({ type: 'OPEN_PARK_ACTIVE' });
      return;
    }
    chrome.runtime.sendMessage({
      type: hit.kind === 'group' ? 'RESTORE_GROUP' : 'RESTORE_TAB',
      id: hit.id,
    });
  }

  function query(raw) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'SEARCH_PARKED', query: raw, limit: 8 }, (res) => {
        hits = Array.isArray(res?.hits) ? res.hits : [];
        index = 0;
        render();
      });
    }, 80);
  }

  input.addEventListener('input', () => query(input.value));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      window.close();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      index = Math.min(hits.length - 1, index + 1);
      render();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      index = Math.max(0, index - 1);
      render();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      restore(hits[index], event.shiftKey);
    }
  });
  input.focus();
})();

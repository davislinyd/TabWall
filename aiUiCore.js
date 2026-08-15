/**
 * TabWall AI UI core.
 *
 * The service worker owns the agent and privileged APIs. This module owns the
 * shared port protocol and safe text-only rendering for every AI surface.
 */
(function (global) {
  'use strict';

  const DEFAULT_SETTINGS = {
    enabled: false,
    baseUrl: 'http://127.0.0.1:8080/v1',
    model: '',
    bridgeUrl: 'http://127.0.0.1:8787',
    timeoutMs: 120000,
    contextSize: 8192,
    allowedBridgeTools: [],
  };

  function text(value, max = 2000) {
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .slice(0, max);
  }

  function isOptionLetterHotkey(event, code) {
    return Boolean(
      event &&
      event.altKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      event.code === code &&
      !event.repeat &&
      !event.isComposing &&
      event.keyCode !== 229
    );
  }

  const MAX_MARKDOWN_LENGTH = 24000;

  function isSafeAiUrl(value) {
    try {
      const url = new URL(String(value || ''));
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      return url.href.slice(0, 4096);
    } catch {
      return '';
    }
  }

  function parseInlineMarkdown(source, depth = 0) {
    const value = String(source || '');
    if (!value || depth > 4) return value ? [{ type: 'text', value }] : [];
    const nodes = [];
    const pattern = /!\[([^\]\n]{0,2048})\]\(([^)\s]{1,4096})\)|`([^`\n]{0,2048})`|\[([^\]\n]{0,2048})\]\(([^)\s]{1,4096})\)|\*\*([^*\n]{0,2048})\*\*|__([^_\n]{0,2048})__|~~([^~\n]{0,2048})~~|\*([^*\n]{0,2048})\*|_([^_\n]{0,2048})_/g;
    let cursor = 0;
    let match;
    const pushText = (part) => {
      if (!part) return;
      const previous = nodes[nodes.length - 1];
      if (previous?.type === 'text') previous.value += part;
      else nodes.push({ type: 'text', value: part });
    };
    const styled = (type, part) => ({
      type,
      children: parseInlineMarkdown(part, depth + 1),
    });
    while ((match = pattern.exec(value))) {
      pushText(value.slice(cursor, match.index));
      if (match[1] != null) {
        // Images are deliberately left as text; AI output must not load remote media.
        pushText(match[0]);
      } else if (match[3] != null) {
        nodes.push({ type: 'code', value: match[3] });
      } else if (match[4] != null) {
        const href = isSafeAiUrl(match[5]);
        if (!href) pushText(match[0]);
        else nodes.push({ type: 'link', href, children: parseInlineMarkdown(match[4], depth + 1) });
      } else if (match[6] != null) {
        nodes.push(styled('strong', match[6]));
      } else if (match[7] != null) {
        nodes.push(styled('strong', match[7]));
      } else if (match[8] != null) {
        nodes.push(styled('del', match[8]));
      } else if (match[9] != null) {
        nodes.push(styled('em', match[9]));
      } else if (match[10] != null) {
        nodes.push(styled('em', match[10]));
      }
      cursor = pattern.lastIndex;
    }
    pushText(value.slice(cursor));
    return nodes;
  }

  function parseSafeMarkdown(markdown) {
    const lines = text(markdown, MAX_MARKDOWN_LENGTH).replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let paragraph = [];
    let list = null;
    let inCode = false;
    let codeLines = [];
    const flushParagraph = () => {
      if (!paragraph.length) return;
      blocks.push({ type: 'paragraph', children: parseInlineMarkdown(paragraph.join('\n')) });
      paragraph = [];
    };
    const flushList = () => {
      if (!list) return;
      blocks.push(list);
      list = null;
    };
    const flushCode = () => {
      blocks.push({ type: 'code-block', value: codeLines.join('\n') });
      codeLines = [];
      inCode = false;
    };

    for (const line of lines) {
      if (/^\s*```/.test(line)) {
        flushParagraph();
        flushList();
        if (inCode) flushCode();
        else inCode = true;
        continue;
      }
      if (inCode) {
        codeLines.push(line);
        continue;
      }
      if (!line.trim()) {
        flushParagraph();
        flushList();
        continue;
      }
      const heading = /^(#{1,3})\s+(.+)$/.exec(line);
      if (heading) {
        flushParagraph();
        flushList();
        blocks.push({ type: 'heading', level: heading[1].length, children: parseInlineMarkdown(heading[2]) });
        continue;
      }
      const quote = /^\s*>\s?(.*)$/.exec(line);
      if (quote) {
        flushParagraph();
        flushList();
        blocks.push({ type: 'quote', children: parseInlineMarkdown(quote[1]) });
        continue;
      }
      const unordered = /^\s*[-*+]\s+(.+)$/.exec(line);
      const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
      if (unordered || ordered) {
        flushParagraph();
        const orderedList = Boolean(ordered);
        if (!list || list.ordered !== orderedList) {
          flushList();
          list = { type: 'list', ordered: orderedList, items: [] };
        }
        list.items.push({ children: parseInlineMarkdown((unordered || ordered)[1]) });
        continue;
      }
      flushList();
      paragraph.push(line);
    }
    flushParagraph();
    flushList();
    if (inCode) flushCode();
    return blocks;
  }

  function appendInlineNodes(doc, parent, nodes) {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      if (node.type === 'text') {
        parent.appendChild(doc.createTextNode(node.value));
        continue;
      }
      if (node.type === 'link') {
        const link = doc.createElement('a');
        link.href = node.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        appendInlineNodes(doc, link, node.children);
        parent.appendChild(link);
        continue;
      }
      const tag = node.type === 'code' ? 'code' : node.type === 'strong' ? 'strong' : node.type === 'del' ? 'del' : 'em';
      const element = doc.createElement(tag);
      if (node.type === 'code') element.textContent = node.value;
      else appendInlineNodes(doc, element, node.children);
      parent.appendChild(element);
    }
  }

  function renderSafeMarkdown(doc, source) {
    if (!doc?.createDocumentFragment || !doc?.createElement) return null;
    const fragment = doc.createDocumentFragment();
    for (const block of parseSafeMarkdown(source)) {
      if (block.type === 'code-block') {
        const pre = doc.createElement('pre');
        const code = doc.createElement('code');
        code.textContent = block.value;
        pre.appendChild(code);
        fragment.appendChild(pre);
        continue;
      }
      if (block.type === 'heading') {
        const heading = doc.createElement(`h${block.level}`);
        appendInlineNodes(doc, heading, block.children);
        fragment.appendChild(heading);
        continue;
      }
      if (block.type === 'quote') {
        const quote = doc.createElement('blockquote');
        appendInlineNodes(doc, quote, block.children);
        fragment.appendChild(quote);
        continue;
      }
      if (block.type === 'list') {
        const list = doc.createElement(block.ordered ? 'ol' : 'ul');
        for (const item of block.items) {
          const listItem = doc.createElement('li');
          appendInlineNodes(doc, listItem, item.children);
          list.appendChild(listItem);
        }
        fragment.appendChild(list);
        continue;
      }
      const paragraph = doc.createElement('p');
      appendInlineNodes(doc, paragraph, block.children);
      fragment.appendChild(paragraph);
    }
    return fragment;
  }

  function create(options = {}) {
    const env = options.env || {};
    const doc = options.document || global.document;
    const t = typeof options.t === 'function' ? options.t : (key) => key;
    let port = null;
    let initialized = false;
    let busy = false;
    let currentAssistant = null;
    let pendingRequestId = '';
    const sourceKeys = new Set();

    function isNearMessageBottom() {
      const messages = env.aiMessages;
      if (!messages) return true;
      return messages.scrollHeight - messages.scrollTop - messages.clientHeight <= 36;
    }

    function scrollMessages(force = false) {
      if (!env.aiMessages || (force !== true && !isNearMessageBottom())) return;
      env.aiMessages.scrollTop = env.aiMessages.scrollHeight;
    }

    function cancelMessageRender(entry) {
      if (!entry?.renderHandle) return;
      if (entry.renderMode === 'raf') global.cancelAnimationFrame?.(entry.renderHandle);
      else global.clearTimeout?.(entry.renderHandle);
      entry.renderHandle = null;
      entry.renderMode = '';
    }

    function renderMessageBody(entry) {
      if (!entry?.body) return;
      const shouldFollow = isNearMessageBottom();
      const fragment = renderSafeMarkdown(doc, entry.source);
      if (fragment) entry.body.replaceChildren(fragment);
      else entry.body.textContent = entry.source;
      if (shouldFollow) scrollMessages(true);
    }

    function scheduleMessageRender(entry) {
      if (!entry || entry.renderHandle) return;
      const flush = () => {
        entry.renderHandle = null;
        entry.renderMode = '';
        renderMessageBody(entry);
      };
      if (typeof global.requestAnimationFrame === 'function') {
        entry.renderMode = 'raf';
        entry.renderHandle = global.requestAnimationFrame(flush);
      } else {
        entry.renderMode = 'timeout';
        entry.renderHandle = global.setTimeout(flush, 0);
      }
    }

    function flushMessageRender(entry) {
      cancelMessageRender(entry);
      renderMessageBody(entry);
    }

    function setStatus(value, state = '') {
      if (!env.aiStatus) return;
      env.aiStatus.textContent = text(value, 800);
      env.aiStatus.dataset.state = state;
    }

    function appendMessage(role, value = '') {
      if (!env.aiMessages || !doc?.createElement) return null;
      const item = doc.createElement('article');
      item.className = `ai-message ai-message-${role}`;
      item.dataset.role = role;
      const label = doc.createElement('div');
      label.className = 'ai-message-label';
      label.textContent = role === 'user'
        ? t('aiYou')
        : role === 'tool'
          ? t('aiTool')
          : t('aiAssistant');
      const body = doc.createElement('div');
      body.className = 'ai-message-text';
      const entry = {
        item,
        body,
        source: text(value, MAX_MARKDOWN_LENGTH),
        renderHandle: null,
        renderMode: '',
      };
      if (role === 'assistant' || role === 'user') renderMessageBody(entry);
      else body.textContent = entry.source;
      item.append(label, body);
      env.aiMessages.appendChild(item);
      scrollMessages(true);
      return entry;
    }

    function appendEvent(value, state = '') {
      const entry = appendMessage('tool', value);
      if (entry) entry.item.dataset.state = state;
      return entry;
    }

    function clearConfirmation() {
      pendingRequestId = '';
      if (!env.aiToolConfirm) return;
      env.aiToolConfirm.hidden = true;
      env.aiToolConfirm.replaceChildren();
    }

    function clearSources() {
      sourceKeys.clear();
      if (!env.aiSources) return;
      env.aiSources.hidden = true;
      env.aiSources.replaceChildren();
    }

    function appendSources(sources) {
      if (!env.aiSources || !doc?.createElement) return;
      const list = Array.isArray(sources) ? sources : [];
      if (!list.length) return;
      if (!env.aiSources.querySelector('.ai-sources-label')) {
        const label = doc.createElement('span');
        label.className = 'ai-sources-label';
        label.textContent = t('aiSourcesLabel');
        env.aiSources.appendChild(label);
      }
      let added = false;
      for (const source of list) {
        const key = text(source?.key || source?.tabId || source?.ref || '', 200);
        if (!key || sourceKeys.has(key)) continue;
        sourceKeys.add(key);
        const item = doc.createElement('span');
        item.className = 'ai-source';
        const title = text(source.title || source.url || source.ref || key, 1000);
        const url = text(source.url || '', 4096);
        item.textContent = url && url !== title ? `${title} · ${url}` : title;
        env.aiSources.appendChild(item);
        added = true;
      }
      if (added) env.aiSources.hidden = false;
    }

    function showConfirmation(message) {
      if (!env.aiToolConfirm || !doc?.createElement) return;
      pendingRequestId = text(message?.requestId || '', 200);
      env.aiToolConfirm.replaceChildren();
      const heading = doc.createElement('strong');
      heading.textContent = t('aiConfirmTitle');
      const name = doc.createElement('div');
      name.className = 'ai-confirm-name';
      name.textContent = text(message?.name || '', 200);
      const risk = doc.createElement('div');
      risk.className = 'ai-confirm-risk';
      risk.textContent = message?.risk === 'external-data'
        ? t('aiExternalDataConfirm')
        : t('aiWriteConfirm');
      const args = doc.createElement('pre');
      args.className = 'ai-confirm-args';
      try {
        args.textContent = JSON.stringify(message?.arguments || {}, null, 2);
      } catch {
        args.textContent = text(message?.arguments || '', 2000);
      }
      const actions = doc.createElement('div');
      actions.className = 'ai-confirm-actions';
      const reject = doc.createElement('button');
      reject.type = 'button';
      reject.className = 'btn';
      reject.textContent = t('aiReject');
      const approve = doc.createElement('button');
      approve.type = 'button';
      approve.className = 'btn primary';
      approve.textContent = t('aiApprove');
      reject.addEventListener('click', () => confirmTool(false));
      approve.addEventListener('click', () => confirmTool(true));
      actions.append(reject, approve);
      env.aiToolConfirm.append(heading, name, risk, args, actions);
      env.aiToolConfirm.hidden = false;
      setStatus(t('aiNeedsConfirmation'), 'pending');
    }

    function confirmTool(approved) {
      if (!pendingRequestId || !port) return;
      port.postMessage({
        type: 'AI_CONFIRM_TOOL',
        requestId: pendingRequestId,
        approved: approved === true,
      });
      clearConfirmation();
      setStatus(approved ? t('aiApproved') : t('aiRejected'), approved ? 'working' : '');
    }

    function rejectPendingConfirmation() {
      if (pendingRequestId && port) {
        port.postMessage({ type: 'AI_CONFIRM_TOOL', requestId: pendingRequestId, approved: false });
      }
      clearConfirmation();
    }

    function ensurePort() {
      if (port) return port;
      try {
        port = global.chrome?.runtime?.connect?.({ name: 'tabwall-ai' }) || null;
        if (!port) throw new Error('no_runtime_port');
        port.onMessage.addListener(handlePortMessage);
        port.onDisconnect.addListener(() => {
          port = null;
          if (!busy) return;
          busy = false;
          setStatus(t('aiDisconnected'), 'error');
          appendEvent(t('aiDisconnected'), 'error');
        });
      } catch (err) {
        setStatus(`${t('aiConnectFailed')}: ${text(err?.message || err, 500)}`, 'error');
      }
      return port;
    }

    function showUi() {
      options.showUi?.();
    }

    function handlePortMessage(message) {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'AI_CONTEXT') {
        clearSources();
        appendSources(message.sources);
        const count = `${Number(message.openTabCount) || 0} / ${Number(message.savedItemCount) || 0}`;
        if (env.aiContextStatus) env.aiContextStatus.textContent = t('aiContextCount', { n: count });
        setStatus(`${t('aiWorking')} · ${text(message.model || 'local', 300)}`, 'working');
        return;
      }
      if (message.type === 'AI_SOURCES') {
        appendSources(message.sources);
        return;
      }
      if (message.type === 'AI_TOOLS_UNAVAILABLE') {
        setStatus(t('aiToolsUnavailable'), 'working');
        appendEvent(`${t('aiToolsUnavailable')}: ${text(message.error || '', 500)}`, 'error');
        return;
      }
      if (message.type === 'AI_CONTEXT_TRIMMED') {
        appendEvent(t('aiContextTrimmed'), 'done');
        return;
      }
      if (message.type === 'AI_MESSAGE_START') {
        currentAssistant = appendMessage('assistant', '');
        if (currentAssistant) currentAssistant.messageId = text(message.messageId || '', 200);
        return;
      }
      if (message.type === 'AI_DELTA') {
        if (!currentAssistant || currentAssistant.messageId !== message.messageId) {
          currentAssistant = appendMessage('assistant', '');
          if (currentAssistant) currentAssistant.messageId = text(message.messageId || '', 200);
        }
        if (currentAssistant) {
          currentAssistant.source = `${currentAssistant.source}${text(message.text || '', MAX_MARKDOWN_LENGTH)}`
            .slice(0, MAX_MARKDOWN_LENGTH);
          scheduleMessageRender(currentAssistant);
        }
        return;
      }
      if (message.type === 'AI_MESSAGE_END') {
        if (currentAssistant && currentAssistant.messageId === message.messageId) {
          const finalText = text(message.text || '', MAX_MARKDOWN_LENGTH);
          if (finalText && finalText !== currentAssistant.source) currentAssistant.source = finalText;
          flushMessageRender(currentAssistant);
        }
        currentAssistant = null;
        return;
      }
      if (message.type === 'AI_TOOL_REQUEST') {
        busy = true;
        showUi();
        showConfirmation(message);
        return;
      }
      if (message.type === 'AI_TOOL_RESULT') {
        const name = text(message.name || t('aiTool'), 200);
        appendEvent(`${name}: ${message.ok === false ? t('aiToolFailed') : t('aiToolDone')}`, message.ok === false ? 'error' : 'done');
        return;
      }
      if (message.type === 'AI_DONE') {
        busy = false;
        clearConfirmation();
        setStatus(t('aiReady'), 'done');
        return;
      }
      if (message.type === 'AI_CANCELLED') {
        busy = false;
        clearConfirmation();
        setStatus(t('aiCancelled'), '');
        return;
      }
      if (message.type === 'AI_ERROR') {
        busy = false;
        clearConfirmation();
        const error = text(message.error || t('aiUnknownError'), 800);
        setStatus(`${t('aiError')}: ${error}`, 'error');
        appendEvent(`${t('aiError')}: ${error}`, 'error');
      }
    }

    function normalizeSettings(raw) {
      const source = raw && typeof raw === 'object' ? raw : {};
      return {
        ...DEFAULT_SETTINGS,
        ...source,
        enabled: source.enabled === true,
      };
    }

    async function sendPrompt(value = '') {
      const prompt = text(value || env.aiInput?.value || '', 12000).trim();
      if (!prompt || busy) return false;
      let settings;
      try {
        settings = normalizeSettings(await Promise.resolve(options.getSettings?.()));
      } catch (err) {
        setStatus(`${t('aiError')}: ${text(err?.message || err, 500)}`, 'error');
        return false;
      }
      if (!settings.enabled) {
        setStatus(t('aiEnableFirst'), 'error');
        appendEvent(t('aiEnableFirst'), 'error');
        return false;
      }
      const activePort = ensurePort();
      if (!activePort) return false;
      appendMessage('user', prompt);
      if (env.aiInput) env.aiInput.value = '';
      busy = true;
      setStatus(t('aiStarting'), 'working');
      activePort.postMessage({
        type: 'AI_START',
        text: prompt,
        bridgeToken: text(options.getBridgeToken?.() || env.aiBridgeToken?.value || '', 500).trim(),
      });
      return true;
    }

    function open() {
      showUi();
      ensurePort();
      if (env.aiInput) setTimeout(() => env.aiInput.focus(), 0);
    }

    function dismiss() {
      rejectPendingConfirmation();
      options.hideUi?.();
    }

    function stop() {
      if (port) port.postMessage({ type: 'AI_CANCEL' });
      busy = false;
      clearConfirmation();
      setStatus(t('aiStopping'), '');
    }

    function reset() {
      if (port) port.postMessage({ type: 'AI_RESET' });
      cancelMessageRender(currentAssistant);
      currentAssistant = null;
      busy = false;
      clearConfirmation();
      clearSources();
      env.aiMessages?.replaceChildren();
      if (env.aiContextStatus) env.aiContextStatus.textContent = t('aiContextReady');
      setStatus(t('aiReady'), '');
    }

    function destroy() {
      if (busy || pendingRequestId) stop();
      else rejectPendingConfirmation();
      try {
        port?.disconnect?.();
      } catch {
        // ignore
      }
      port = null;
      cancelMessageRender(currentAssistant);
      currentAssistant = null;
    }

    function init() {
      if (initialized) return;
      initialized = true;
      env.aiSendBtn?.addEventListener('click', () => { sendPrompt().catch(() => {}); });
      env.aiStopBtn?.addEventListener('click', stop);
      env.aiClearBtn?.addEventListener('click', reset);
      if (options.handleInputKeydown !== false) {
        env.aiInput?.addEventListener('keydown', (event) => {
          event.stopPropagation();
          if (event.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendPrompt().catch(() => {});
          }
        });
      }
      setStatus(t('aiReady'), '');
    }

    return {
      init,
      open,
      dismiss,
      sendPrompt,
      stop,
      reset,
      destroy,
      ensurePort,
      isBusy: () => busy,
      handlePortMessage,
    };
  }

  global.TabWallAiCore = {
    DEFAULT_SETTINGS,
    isOptionLetterHotkey,
    isSafeAiUrl,
    parseSafeMarkdown,
    renderSafeMarkdown,
    create,
  };
})(typeof self !== 'undefined' ? self : globalThis);

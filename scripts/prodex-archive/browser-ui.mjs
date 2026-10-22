import { setTimeout as sleep } from 'node:timers/promises';

export function selectExactTab(tabs, url) {
  const matches = tabs.filter((t) => t.type === 'page' && t.url === url &&
    typeof t.webSocketDebuggerUrl === 'string' &&
    /^ws:\/\/(127\.0\.0\.1|localhost):\d+\//.test(t.webSocketDebuggerUrl));
  if (matches.length !== 1)
    throw new Error('No unique active Prodex tab matches this exact thread; refusing navigation');
  return matches[0];
}
export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      const call = this.pending.get(msg.id);
      if (!call) return;
      clearTimeout(call.timer);
      this.pending.delete(msg.id);
      if (msg.error) call.reject(new Error('CDP command rejected'));
      else call.resolve(msg.result);
    });
    ws.addEventListener('close', () => {
      for (const call of this.pending.values()) {
        clearTimeout(call.timer);
        call.reject(new Error('CDP disconnected'));
      }
      this.pending.clear();
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('CDP timed out'));
      }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(fn, arg) {
    const expression = '(' + fn.toString() + ')(' + JSON.stringify(arg) + ')';
    const answer = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (answer.exceptionDetails || !answer.result || !('value' in answer.result))
      throw new Error('Cannot inspect ChatGPT page');
    return answer.result.value;
  }
  async mouse(point, click = false) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y))
      throw new Error('UI coordinate is unavailable');
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    if (click) {
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    }
  }
  close() { this.ws.close(); }
}

export function inspectPage(expected) {
  const rect = (element) => {
    const r = element.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  if (globalThis.location.href !== expected || globalThis.document.visibilityState !== 'visible')
    return { error: 'Target thread changed or is hidden' };
  const main = globalThis.document.querySelector('main');
  if (!main) return { error: 'Chat main is missing' };
  const editor = main.querySelector('#prompt-textarea, [contenteditable="true"][data-placeholder], [role="textbox"][contenteditable="true"]');
  if (!editor || editor.textContent.trim()) return { error: 'Composer missing or has an unsent draft' };
  const generating = [...main.querySelectorAll('button')].some((b) => {
    const name = (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('data-testid') || '');
    return /stop generating|stop streaming|stop response|停止生成|stop-button/i.test(name);
  });
  if (generating) return { error: 'ChatGPT is still generating' };
  const links = [...globalThis.document.querySelectorAll('a[href]')].filter((a) => {
    try { return new URL(a.getAttribute('href'), globalThis.location.origin).href === expected; }
    catch { return false; }
  });
  if (links.length !== 1) return { error: 'Thread sidebar row not uniquely identified' };
  const link = links[0];
  let menuButton = null;
  for (let parent = link.parentElement, depth = 0; parent && depth < 5; parent = parent.parentElement, depth++) {
    const chatLinks = [...parent.querySelectorAll('a[href]')].filter((a) => {
      try { return new URL(a.getAttribute('href'), globalThis.location.origin).pathname.includes('/c/'); }
      catch { return false; }
    });
    if (chatLinks.length !== 1) break;
    const buttons = [...parent.querySelectorAll('button')].filter((b) => {
      const label = [b.getAttribute('aria-label'), b.getAttribute('title'), b.getAttribute('data-testid')].filter(Boolean).join(' ');
      return /options|more|menu|更多|选项/i.test(label);
    });
    if (buttons.length === 1) { menuButton = buttons[0]; break; }
  }
  const row = rect(link);
  if (!row) return { error: 'Thread row not visible' };
  // Some ChatGPT layouts mount the options button only after the row is hovered.
  // First inspection only needs the row; after hover the menu button is mandatory.
  const menu = menuButton ? rect(menuButton) : null;
  return { ok: true, row, menu };
}

export function inspectArchiveAction(expected) {
  if (globalThis.location.href !== expected || globalThis.document.visibilityState !== 'visible')
    return { error: 'Thread changed before archive' };
  const matches = [...globalThis.document.querySelectorAll('[role="menuitem"]')]
    .filter((item) => /^(Archive|归档)$/i.test(item.textContent.trim()));
  if (matches.length !== 1) return { error: 'Archive menu action not uniquely found' };
  const r = matches[0].getBoundingClientRect();
  if (r.width < 3 || r.height < 3) return { error: 'Archive action hidden' };
  return { ok: true, point: { x: r.left + r.width / 2, y: r.top + r.height / 2 } };
}

export function inspectSidebarRemoval(expected) {
  const doc = globalThis.document;
  if (!doc || doc.visibilityState !== 'visible' || !doc.querySelector('main')) return false;
  const chatLinks = [...doc.querySelectorAll('a[href]')].filter((a) => {
    try { return new URL(a.getAttribute('href'), expected).pathname.includes('/c/'); }
    catch { return false; }
  });
  // An empty/unloaded sidebar is not proof of success. If this was the last chat,
  // leave the result unconfirmed so a human can inspect Archived chats.
  if (chatLinks.length === 0) return false;
  return chatLinks.every((a) => {
    try { return new URL(a.getAttribute('href'), expected).href !== expected; }
    catch { return true; }
  });
}

export async function archiveConversation({ port, threadUrl }) {
  const response = await fetch('http://127.0.0.1:' + port + '/json/list', {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Prodex browser control endpoint unavailable');
  const tabs = await response.json();
  if (!Array.isArray(tabs)) throw new Error('Invalid browser tabs response');
  const target = selectExactTab(tabs, threadUrl);
  if (typeof WebSocket !== 'function') throw new Error('WebSocket is unavailable in this Node runtime');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP WebSocket connection timed out')), 5000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP WebSocket error')); }, { once: true });
  });
  const cdp = new Cdp(ws);
  try {
    const first = await cdp.eval(inspectPage, threadUrl);
    if (!first.ok) throw new Error(first.error || 'Chat UI changed');
    await cdp.mouse(first.row); // hover the *identified* conversation, not a fixed coordinate
    await sleep(150);
    const second = await cdp.eval(inspectPage, threadUrl);
    if (!second.ok || !second.menu) throw new Error(second.error || 'Thread options unavailable after hover');
    await cdp.mouse(second.menu, true);
    let action;
    for (let attempt = 0; attempt < 8; attempt++) {
      action = await cdp.eval(inspectArchiveAction, threadUrl);
      if (action.ok) break;
      await sleep(120);
    }
    if (!action?.ok) throw new Error(action?.error || 'Archive option unavailable');
    // Check identity once more before the destructive-to-sidebar (but reversible) action.
    const stillTarget = await cdp.eval((expected) => globalThis.location.href === expected &&
      globalThis.document.visibilityState === 'visible', threadUrl);
    if (stillTarget !== true) throw new Error('Thread changed during archive; refusing click');
    await cdp.mouse(action.point, true);
    for (let i = 0; i < 12; i++) {
      await sleep(250);
      if (await cdp.eval(inspectSidebarRemoval, threadUrl)) return { archived: true };
    }
    // No blind retry: the click may have succeeded but the sidebar may not have updated.
    throw new Error('Archive result unconfirmed; inspect Archived chats before retrying');
  } finally { cdp.close(); }
}

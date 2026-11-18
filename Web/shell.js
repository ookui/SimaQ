(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const rpc = (method, args = {}) => window.rpc(method, args);
  const files = new Map(), folders = new Set(), expanded = new Set(), tabs = [], closed = [];
  const previous = [], next = [];
  const documentViews = new Map();
  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
    );
  const nameOf = (p) => (p || '').split('/').pop() || '';
  const parentOf = (p) => (p || '').split('/').slice(0, -1).join('/');
  const extOf = (p) => (nameOf(p).match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
  const stem = (p) => nameOf(p).replace(/\.[^.]+$/, '');
  const isMd = (p) => /^(md|markdown|mdown|mkd)$/i.test(extOf(p));
  const isReader = (p) => /^(pdf|html|htm|png|apng|jpg|jpeg|gif|webp|avif|heic|heif|tif|tiff|bmp|ico)$/i.test(extOf(p));
  const isEditable = (p) => isMd(p) || /^(svg|json|txt|csv)$/i.test(extOf(p));
  const supported = (p) => isEditable(p) || isReader(p);
  const join = (parent, child) => parent ? parent + '/' + child : child;
  const atOrUnder = (p, dir) => p === dir || p.startsWith(dir + '/');
  const copy = (o) => o == null ? o : JSON.parse(JSON.stringify(o));
  const paths = {
    folders: 'M3 8V5h6l2 2h8v2 M3 10h6l2 2h10l-2 8H3z',
    folder: 'M3 6h6l2 2h10v11H3z',
    folderOpen: 'M3 17V6h6l2 2h9v2 M3 18l3-7h16l-3 8H3z',
    doc: 'M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h5',
    pdf: 'M6 3h8l4 4v14H6z M14 3v5h4 M8.5 16c2-1 3-4 3.5-6 .4 3 1.2 4 4 5-3-.5-5 .4-7.5 1z',
    html: 'M6 3h8l4 4v14H6z M14 3v5h4 M10 12l-2 2 2 2 M14 12l2 2-2 2',
    search: 'M16 16l4.5 4.5 M18 10a8 8 0 1 1-16 0a8 8 0 1 1 16 0',
    outline: 'M8 6h12 M8 12h9 M8 18h12 M3 6h1 M3 12h1 M3 18h1',
    panel: 'M3 4h18v16H3z M9 4v16',
    settings:
      'M9 4l1-2h4l1 2 2 1 2-.3 2 3-1.2 2 .2 3 1 2-2 3-2-.4-2 1-1 2h-4l-1-2-2-1-2 .4-2-3 1-2 .2-3L3 8l2-3 2 .3z M15.3 11.5a3.3 3.3 0 1 1-6.6 0 3.3 3.3 0 0 1 6.6 0',
    chevronDown: 'M6 9l6 6 6-6',
    right: 'M9 5l7 7-7 7',
    left: 'M15 5l-7 7 7 7',
    plus: 'M12 5v14 M5 12h14',
    close: 'M6 6l12 12 M18 6L6 18',
    sliders: 'M3 7h6 M13 7h8 M3 17h10 M17 17h4 M9 4v6 M16 14v6',
    more: 'M4 12h.05 M12 12h.05 M20 12h.05',
    command:
      'M8 8h8v8H8z M8 8H5a3 3 0 1 1 3-3z M16 8V5a3 3 0 1 1 3 3z M16 16h3a3 3 0 1 1-3 3z M8 16v3a3 3 0 1 1-3-3z',
    pin: 'M8 3h8l-1 6 3 4v1H6v-1l3-4z M12 14v7',
    calendar: 'M3 5h18v16H3z M3 10h18 M7 3v4 M17 3v4 M8 14h3v3H8z',
    clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 1 1 18 0 M12 6v6l4 2',
    filter: 'M3 5h18l-7 8v6l-4 1v-7z',
    check: 'M4 12l5 5L20 6',
    link: 'M10 14l4-4 M8 13l-1 1a3 3 0 0 0 4 4l3-3 M16 11l1-1a3 3 0 0 0-4-4l-3 3',
    book: 'M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2z M12 6v15',
    filePlus: 'M5 3h9l4 4v7 M14 3v5h4 M5 3v17h7 M17 14v7 M13.5 17.5h7',
    collapse: 'M5 6h14 M9 10l3 3 3-3 M9 18l3-3 3 3',
    menu: 'M3 6h18 M3 12h18 M3 18h18',
    trash: 'M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15',
    edit: 'M4 16l11-11 4 4L8 20l-5 1z',
    copy: 'M8 8h12v13H8z M4 16V3h12',
    external: 'M13 4h7v7 M20 4L10 14 M9 6H4v14h14v-5',
    terminal: 'M4 6h16v13H4z M7 10l2 2-2 2 M11 15h4',
    restore: 'M3 5v6h6 M4 10a8 8 0 1 1 1 8',
    shield: 'M12 3l8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6z',
    info: 'M21 12a9 9 0 1 1-18 0 9 9 0 1 1 18 0 M12 11v6 M12 7v.1',
  };
  function icon(n) {
    return '<svg aria-hidden="true" class="sq-svg" viewBox="0 0 24 24"><path d="' +
      (paths[n] || paths.doc) + '"' + (n === 'more' ? ' style="stroke-width:3.5"' : '') + '/></svg>';
  }
  const directoryStyles = [
    {name:'Sources',      color:'#306bd6', icon:'folders'},
    {name:'Mechanisms',   color:'#8056cc', icon:'sliders'},
    {name:'Theses',       color:'#ad48b1', icon:'link'},
    {name:'LifeOS',       color:'#198468', icon:'calendar'},
    {name:'Library',      color:'#297ba9', icon:'book'},
    {name:'Projects',     color:'#c74778', icon:'edit'},
    {name:'Archive',      color:'#ac691e', icon:'clock'},
    {name:'Tasks',        color:'#758624', icon:'check'},
  ];
  const directoryStyleByName = new Map();
  function assignDirectoryStyles(nodes) {
    const names = nodes.filter(n => n.dir).map(n => n.name).sort();
    const usage = directoryStyles.map(() => 0);
    for (const name of names) {
      const preferred = directoryStyles.find(style => style.name.toLowerCase() === name.toLowerCase());
      if (preferred) directoryStyleByName.set(name, preferred);
      const existing = directoryStyleByName.get(name);
      if (existing) usage[directoryStyles.indexOf(existing)]++;
    }
    for (const name of names) {
      if (directoryStyleByName.has(name)) continue;
      const index = usage.indexOf(Math.min(...usage));
      directoryStyleByName.set(name, directoryStyles[index]);
      usage[index]++;
    }
  }
  function applyDirectoryColor(element, path) {
    const style = directoryStyleByName.get(path.split('/')[0]);
    element.style.setProperty('--directory-accent', style?.color || 'var(--accent)');
    return style;
  }
  function glyph(path) {
    const e = extOf(path);
    return '<span class="file-glyph kind-' + esc(e) + '">' +
      icon(e === 'pdf' ? 'pdf' : /html?/.test(e) ? 'html' : 'doc') + '</span>';
  }
  function iconButton(label, i, attrs = '') {
    const title = esc(window.SimaSettings.menuText(label));
    return '<button class="sq-icon" data-menu-title="' + esc(label) + '" aria-label="' + title + '" title="' + title + '" ' + attrs +
      '>' + icon(i) + '</button>';
  }
  const defaultSearch = () => ({
    q: '',
    scope: 'all',
    document: null,
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    exact: false,
    folder: '',
    extensions: [],
    excludeArchive: false,
    filters: false,
    collapsed: [],
    hitLimits: {},
    selected: null,
    current: null,
    scroll: 0,
  });
  let root = null,
    tree = [],
    recents = [],
    active = null,
    mode = 'tree',
    selectedPath = '',
    search = defaultSearch(),
    groups = [],
    treeScroll = 0;
  let generation = 0,
    treeRequest = 0,
    searchRequest = 0,
    sessionTimer,
    searchTimer,
    toastTimer,
    sidebarWidth = 292,
    sidebarHidden = false,
    outlineHidden = false,
    overlayCount = 0,
    popup = null,
    readerPath = null,
    started = false,
    restoring = false;
  let navigation = Promise.resolve(),
    sessionWrite = Promise.resolve(),
    treeRefreshTimer,
    pendingExternal = new Set(),
    externalTimer;
  function toast(message) {
    if (!message) return;
    const t = $('toast');
    t.textContent = String(message);
    t.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('visible'), 3500);
  }
  function failure(error) {
    toast(error?.message || String(error || '操作失败'));
  }
  function call(fn) {
    Promise.resolve().then(fn).catch(failure);
  }
  function serialize(fn) {
    const g = generation;
    const p = navigation.then(() => g === generation ? fn() : undefined);
    navigation = p.catch(failure);
    return p;
  }
  const settings = () => window.SimaSettings?.settings || {};
  const binding = (id) => window.SimaSettings?.binding?.(id) || '';
  function rememberState(tab) {
    if (tab?.editor) tab.state = tab.editor.getState();
    return tab?.state;
  }
  function snapshot() {
    rememberState(active);
    captureSideScroll();
    return {
      path: active?.path || null,
      journalDay: active?.pendingJournal?.date,
      state: copy(active?.state),
      mode,
      search: copy(search),
      treeScroll,
      selectedPath,
    };
  }
  function pushHistory() {
    if (restoring) return;
    const s = snapshot();
    if (JSON.stringify(previous.at(-1)) !== JSON.stringify(s)) previous.push(s);
    if (previous.length > 80) previous.shift();
    next.length = 0;
    updateNav();
  }
  function updateNav() {
    $('backBtn').disabled = !previous.length;
    $('forwardBtn').disabled = !next.length;
    window.SimaSettings?.refreshCommands?.();
  }
  function captureSideScroll() {
    const sc = $('sideScroll');
    if (!sc) return;
    if (mode === 'search') search.scroll = sc.scrollTop;
    else if (mode === 'tree') treeScroll = sc.scrollTop;
  }
  function sessionData() {
    captureSideScroll();
    return {
      tabs: tabs.filter(t => !t.pendingJournal).map((t) => ({
        path: t.path,
        state: rememberState(t),
        pinned: t.pinned,
        preview: t.preview,
      })),
      active: active?.path || null,
      documentViews: [...documentViews],
      expanded: [...expanded],
      selectedPath,
      mode,
      search,
      treeScroll,
      sidebarWidth,
      sidebarHidden,
      outlineHidden,
    };
  }
  function persistSoon() {
    if (restoring || !root) return;
    clearTimeout(sessionTimer);
    sessionTimer = setTimeout(() => call(persist), 330);
  }
  async function persist() {
    clearTimeout(sessionTimer);
    if (!root) return;
    const session = copy(sessionData());
    sessionWrite = sessionWrite.catch(() => {}).then(() => rpc('saveSession', { session }));
    await sessionWrite;
  }
  function readerRect() {
    if (overlayCount || !active || !isReader(active.path)) return { x: 0, y: 0, width: 0, height: 0 };
    const r = $('readerTarget').getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }
  function reposition() {
    if (readerPath) call(() => rpc('readerRect', { rect: readerRect() }));
  }
  function overlay(show) {
    overlayCount = Math.max(0, overlayCount + (show ? 1 : -1));
    reposition();
  }
  function dismissPopup(value) {
    if (!popup) return;
    const old = popup;
    popup = null;
    old.layer.remove();
    overlay(false);
    old.resolve?.(value);
    if (old.focus?.isConnected) old.focus.focus({ preventScroll: true });
  }
  function makePopup(modal) {
    dismissPopup();
    const focus = document.activeElement;
    const layer = document.createElement('div');
    layer.className = 'sq-popup-layer' + (modal ? ' sq-modal-layer' : '');
    document.body.append(layer);
    overlay(true);
    popup = { layer, focus };
    layer.addEventListener('mousedown', (e) => {
      if (e.target === layer) dismissPopup();
    });
    return layer;
  }
  function menu(point, items) {
    const layer = makePopup(false), box = document.createElement('div');
    box.className = 'sq-menu';
    box.setAttribute('role', 'menu');
    layer.append(box);
    items.filter((x) => x !== false).forEach((item) => {
      if (!item) {
        box.append(document.createElement('hr'));
        return;
      }
      const [label, cb, i, key] = item;
      const b = document.createElement('button');
      b.setAttribute('role', 'menuitem');
      b.innerHTML = (i ? icon(i) : '') + '<span class="menu-label">' + esc(window.SimaSettings.menuText(label)) + '</span>' +
        (key ? '<kbd>' + esc(key) + '</kbd>' : '');
      b.disabled = !cb;
      b.onclick = () => {
        dismissPopup();
        call(cb);
      };
      box.append(b);
    });
    const r = point instanceof Element ? point.getBoundingClientRect() : null;
    box.style.left = Math.max(5, Math.min(r ? r.left : point.x, innerWidth - box.offsetWidth - 6)) + 'px';
    box.style.top = Math.max(5, Math.min(r ? r.bottom + 4 : point.y, innerHeight - box.offsetHeight - 6)) +
      'px';
    box.querySelector('button:not(:disabled)')?.focus();
  }
  function dialog(title, contents, actions, setup, wide = false) {
    const layer = makePopup(true);
    const d = document.createElement('section');
    d.className = 'sq-dialog' + (wide ? ' wide' : '');
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
    d.setAttribute('aria-label', title);
    d.innerHTML = '<header class="dialog-head"><h2>' + esc(title) + '</h2>' +
      iconButton('关闭', 'close', 'data-dismiss') + '</header><div class="dialog-content">' + contents +
      '</div><div class="dialog-actions"></div>';
    layer.append(d);
    d.querySelector('[data-dismiss]').onclick = () => dismissPopup();
    const promise = new Promise((resolve) => popup.resolve = resolve);
    for (const action of actions) {
      const [label, id, klass] = action, b = document.createElement('button');
      b.textContent = label;
      b.className = klass || '';
      b.dataset.answer = id;
      b.onclick = () =>
        dismissPopup({
          id,
          fields: Object.fromEntries(
            [...d.querySelectorAll('[name]')].map(
              (x) => [x.name, x.type === 'checkbox' ? x.checked : x.value],
            ),
          ),
        });
      d.lastChild.append(b);
    }
    setup?.(d);
    const focus = d.querySelector('[autofocus],input:not([type=checkbox]),textarea,select') ||
      d.querySelector('.dialog-actions .primary') || d.querySelector('button');
    focus.focus();
    if (focus.tagName === 'INPUT' && focus.dataset.select) focus.select();
    return promise;
  }
  function field(label, name, value = '', opts = '') {
    return '<label class="field">' + esc(label) + '<input class="dialog-input" name="' + name +
      '" value="' + esc(value) + '" ' + opts + '></label>';
  }
  async function promptText(title, label, value) {
    const a = await dialog(title, field(label, 'value', value, 'data-select="1"'), [['取消', 'cancel'], [
      '确定',
      'ok',
      'primary',
    ]]);
    return a?.id === 'ok' ? a.fields.value.trim() : null;
  }
  function choiceList(title, items, opts = {}) {
    return new Promise((resolve) => {
      const optsHTML = opts.html || '';
      let selected = 0, shown = items;
      const p = dialog(
        title,
        '<div class="search-input">' + icon('search') + '<input name="query" placeholder="' +
          esc(opts.placeholder || '搜索文件名或标题') + '" autocomplete="off"></div>' + optsHTML +
          '<div class="dialog-list"></div>',
        [[window.SimaSettings.menuText('取消'), 'cancel'], [opts.action || '打开', 'ok', 'primary']],
        (d) => {
          const list = d.querySelector('.dialog-list'), q = d.querySelector('[name=query]');
          function draw() {
            const term = q.value.trim().toLowerCase();
            shown = items.filter((i) =>
              (i.label + ' ' + i.detail + ' ' + (i.extra || '')).toLowerCase().includes(term)
            ).slice(0, 200);
            selected = Math.min(Math.max(selected, 0), Math.max(0, shown.length - 1));
            list.replaceChildren();
            for (let n = 0; n < shown.length; n++) {
              const i = shown[n], b = document.createElement('button');
              b.classList.toggle('active', n === selected);
              b.innerHTML = (i.icon ? icon(i.icon) : glyph(i.path || '')) +
                '<span class="list-details"><strong>' + esc(i.label) + '</strong><small>' + esc(i.detail) +
                '</small></span>';
              b.onclick = () => {
                selected = n;
                d.querySelector('[data-answer=ok]').click();
              };
              list.append(b);
            }
            if (!shown.length) list.innerHTML = '<div class="side-empty">没有匹配项</div>';
            d.querySelector('[data-answer=ok]').disabled = !shown.length;
          }
          q.oninput = () => {
            selected = 0;
            draw();
          };
          q.onkeydown = (e) => {
            if (e.isComposing || e.keyCode === 229) return;
            if (['ArrowUp', 'ArrowDown'].includes(e.key)) {
              e.preventDefault();
              selected += e.key === 'ArrowUp' ? -1 : 1;
              draw();
              list.children[selected]?.scrollIntoView({ block: 'nearest' });
            }
          };
          draw();
        },
      );
      p.then((a) =>
        resolve(a?.id === 'ok' && shown[selected] ? { item: shown[selected], fields: a.fields } : null)
      );
    });
  }
  function markElements() {
    document.querySelectorAll('[data-icon]').forEach((el) => el.innerHTML = icon(el.dataset.icon));
  }
  function setLayout() {
    document.documentElement.style.setProperty('--side-width', sidebarWidth + 'px');
    $('workspaceShell').classList.toggle('sidebar-off', sidebarHidden);
    reposition();
  }
  function renderWelcome() {
    const w = $('welcome');
    w.hidden = !!active;
    if (active) return;
    const libName = nameOf(root), items = recents.filter((p) => p !== root).slice(0, 4);
    w.innerHTML = '<div class="welcome-inner"><div class="welcome-icon">' +
      icon(root ? 'folders' : 'book') + '</div><h1>' + esc(root ? libName : '打开本地资料库') + '</h1><p>' +
      esc(
        root
          ? '从左侧目录打开文档，或搜索库中的笔记与报告。'
          : '选择一个文件夹，即可在同一窗口编辑 Markdown 笔记、阅读 HTML 和 PDF 报告。',
      ) + '</p><div class="welcome-actions"><button class="primary" data-run="' +
      (root ? 'file.new' : 'file.openFolder') + '">' + icon(root ? 'filePlus' : 'folderOpen') +
      (root ? '新建笔记' : '选择文件夹…') + '</button><button data-run="' +
      (root ? 'search.workspace' : 'file.sample') + '">' + icon(root ? 'search' : 'book') +
      (root ? '搜索工作区' : '打开示例资料库') + '</button></div>' +
      (!root && items.length
        ? '<div class="welcome-recent"><h2>最近打开</h2>' + items.map((p) =>
          '<button class="recent-btn" data-recent="' + esc(p) + '">' + icon('clock') + esc(nameOf(p)) +
          '<small>' + esc(parentOf(p)) + '</small></button>'
        ).join('') + '</div>'
        : '') +
      '</div>';
  }
  function renderTabs() {
    const b = $('tabBar');
    const left = b.scrollLeft;
    b.replaceChildren();
    tabs.forEach((t) => {
      const el = document.createElement('div');
      el.className = 'tab' + (t.preview ? ' preview' : '') + (t.dirty ? ' dirty' : '');
      el.tabIndex = 0;
      el.draggable = true;
      el.setAttribute('role', 'tab');
      el.setAttribute('aria-selected', String(t === active));
      el.title = t.path;
      el.innerHTML = glyph(t.path) + '<span class="tab-name">' + esc(nameOf(t.path)) + '</span>' +
        (t.pinned ? '<span class="pin-mark">' + icon('pin') + '</span>' : '') +
        iconButton('关闭标签', 'close', 'data-close');
      el.querySelector('[data-close]').className = 'sq-icon tab-close';
      el.querySelector('[data-close]').onclick = (e) => {
        e.stopPropagation();
        call(() => serialize(() => closeTab(t)));
      };
      el.onclick = () => call(() => openPath(t.path));
      el.ondblclick = () => {
        t.preview = false;
        renderTabs();
        persistSoon();
      };
      el.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          el.click();
        }
      };
      el.onauxclick = (e) => {
        if (e.button === 1) {
          e.preventDefault();
          call(() => serialize(() => closeTab(t)));
        }
      };
      el.oncontextmenu = (e) => {
        e.preventDefault();
        menu(e, [
          [t.pinned ? '取消固定' : '固定标签', () => {
            t.preview = false;
            t.pinned = !t.pinned;
            renderTabs();
            persistSoon();
          }, 'pin'],
          !t.pendingJournal && ['复制相对路径', () => rpc('copyText', { text: t.path }), 'copy'],
          !t.pendingJournal && ['在 Finder 中显示', () => rpc('reveal', { path: t.path }), 'external'],
          null,
          ['关闭标签', () => serialize(() => closeTab(t)), 'close'],
          ['关闭其他未固定标签', () => closeTabs(o => o !== t && !o.pinned)],
          ['关闭所有标签', () => closeTabs(() => true)],
        ]);
      };
      el.ondragstart = (e) => {
        e.dataTransfer.setData('application/x-simaq-tab', t.path);
        e.dataTransfer.effectAllowed = 'move';
      };
      el.ondragover = (e) => {
        if (e.dataTransfer.types.includes('application/x-simaq-tab')) e.preventDefault();
      };
      el.ondrop = (e) => {
        e.preventDefault();
        const src = tabs.find((x) => x.path === e.dataTransfer.getData('application/x-simaq-tab'));
        if (!src || src === t) return;
        const target = tabs.indexOf(t);
        tabs.splice(tabs.indexOf(src), 1);
        tabs.splice(target, 0, src);
        renderTabs();
        persistSoon();
      };
      b.append(el);
    });
    b.scrollLeft = left;
  }
  function renderStatus() {
    const t = active;
    const count = files.size;
    $('statusLeft').innerHTML = t
      ? (t.conflict
        ? icon('info') + '磁盘版本已更改'
        : t.dirty
        ? icon('edit') + '待保存'
        : t.pendingJournal
        ? icon('edit') + esc(window.SimaSettings.menuText('日记草稿'))
        : isEditable(t.path)
        ? icon('check') + '已保存'
        : icon('book') + '阅读模式')
      : (root ? icon('folder') + esc(nameOf(root)) : '本地工作区');
    $('statusRight').innerHTML = t
      ? (t.editor
        ? '<span>' + t.editor.getText().replace(/\s/gu, '').length.toLocaleString() +
          ' 字符</span><span>' + (isMd(t.path) ? 'Markdown' : esc(extOf(t.path).toUpperCase())) + '</span>'
        : '<span>' + esc(extOf(t.path).toUpperCase()) + '</span>')
      : (root ? '<span>' + count + ' 个文件</span>' : '');
    $('conflictBar').hidden = !t?.conflict;
    if (t?.conflict) {
      $('conflictBar').innerHTML = '磁盘上的文件已更改，未保存的编辑已保留。<button>比较版本…</button>';
      $('conflictBar').querySelector('button').onclick = () => call(() => conflictDialog(t));
    }
  }
  function renderFrame() {
    scheduleOutline(true);
    if (mode === 'journals') renderSide();
    renderTabs();
    renderWelcome();
    $('docTools').hidden = !active;
    if (active) {
      const parts = active.path.split('/');
      $('breadcrumbs').innerHTML = icon('folder') + '<span>' + esc(nameOf(root)) + '</span>' +
        parts.map((p, i) =>
          icon('right') + '<span class="' + (i === parts.length - 1 ? 'crumb-file' : '') + '" title="' +
          esc(active.path) + '">' + esc(p) + '</span>'
        ).join('');
    }
    renderStatus();
    updateNav();
  }
  function section(title, controls = '') {
    return '<div class="side-section"><span data-menu-text="' + esc(title) + '">' + esc(window.SimaSettings.menuText(title)) + '</span><div class="side-tools">' + controls +
      '</div></div>';
  }
  let outlineEditTimer, outlineFrame=0, outlineDirty=false, outlineTab=null, outlineRows=[], currentOutline=null;
  const outlineResize = new ResizeObserver(() => scheduleOutline());
  function scheduleOutline(rebuild=false) {
    if (rebuild) clearTimeout(outlineEditTimer);
    outlineDirty ||= rebuild;
    if (!outlineFrame) outlineFrame=requestAnimationFrame(updateOutline);
  }
  function updateOutline() {
    outlineFrame=0;
    const panel=$('documentOutline'), list=$('outlineList');
    const tab=active?.editor && isMd(active.path) && !outlineHidden ? active : null;
    if (outlineTab!==tab) {
      outlineResize.disconnect();
      outlineTab=tab;
      outlineRows=[]; currentOutline=null; list.replaceChildren();
      if (tab) {
        outlineResize.observe(tab.host.querySelector('.sima-editor'));
        outlineResize.observe(tab.host.querySelector('.sima-document'));
      }
      outlineDirty=true;
    }
    if (outlineDirty) {
      outlineDirty=false;
      const items=tab?.editor.outlineLocations() || [];
      panel.hidden=!items.length;
      $('stage').classList.toggle('outline-open',!panel.hidden);
      if (outlineRows.length!==items.length || items.some((h,i)=>h.title!==outlineRows[i].title || h.level!==outlineRows[i].level)) {
        list.replaceChildren(...items.map(h=>{
          const button=document.createElement('button');
          button.type='button'; button.className='outline-row'; button.textContent=h.title;
          button.style.paddingInlineStart=(8+(h.level-1)*15)+'px';
          return button;
        }));
        currentOutline=null;
      }
      outlineRows=items;
    }
    if (!tab || panel.hidden) return;
    const start=tab.editor.centeredHeading(outlineRows);
    const index=outlineRows.findIndex(h=>h.start===start);
    const button=list.children[index];
    if (currentOutline===button) return;
    currentOutline?.removeAttribute('aria-current');
    currentOutline=button;
    if (button) {
      button.setAttribute('aria-current','location');
      const rect=button.getBoundingClientRect(), bounds=list.getBoundingClientRect();
      if (rect.top<bounds.top) list.scrollTop+=rect.top-bounds.top;
      else if (rect.bottom>bounds.bottom) list.scrollTop+=rect.bottom-bounds.bottom;
    }
  }
  const localDay = (date) => [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
  const monthOf = (day) => new Date(Number(day.slice(0,4)), Number(day.slice(5,7))-1, 1, 12);
  let journalRows = [], journalMonth = monthOf(localDay(new Date())), journalRequest = 0, journalOpenRequest = 0;
  let configuredJournalFolder = null;
  function journalFolder() {
    if (!root) return null;
    if (configuredJournalFolder !== null) {
      return configuredJournalFolder === '' || folders.has(configuredJournalFolder) ? configuredJournalFolder : null;
    }
    if (/\/lifeos\/journals$/i.test(root)) return '';
    return [...folders].find(path => /\/lifeos\/journals$/i.test(join(root,path))) ?? null;
  }
  async function refreshJournals() {
    const folder = journalFolder(), req = ++journalRequest, g = generation;
    if (folder == null) return;
    const rows = await rpc('journals',{folder});
    if (g !== generation || req !== journalRequest) return;
    journalRows = rows;
    if (mode === 'journals') renderSide();
  }
  async function openDay(day, newTab = false) {
    const folder = journalFolder(), g = generation, request = ++journalOpenRequest;
    if (folder == null) return;
    activateSide('journals');
    journalMonth = monthOf(day);
    const entry = await rpc('openJournal',{folder,day,root});
    if (g !== generation || request !== journalOpenRequest || mode !== 'journals') return;
    await refreshJournals();
    if (g !== generation || request !== journalOpenRequest || mode !== 'journals') return;
    await openPath(entry.path,{newTab,pendingJournal:entry.pending ? entry : null,preview:!!entry.pending && !newTab,permanent:newTab || !entry.pending});
  }
  function journalTrashMenu(event, rows) {
    event.preventDefault();
    const action = window.SimaSettings.menuText('移入废纸篓…');
    const open = window.SimaSettings.menuText('在新标签页中打开');
    menu(event, rows.flatMap(row => {
      const duplicate = rows.some(other => other.path !== row.path && other.title === row.title);
      const suffix = rows.length === 1 ? '' : ' · ' + (duplicate ? row.path : row.title);
      return [[open + suffix, () => openPath(row.path,{newTab:true,permanent:true}), 'doc'],
        [action + suffix, () => trashPath(row.path), 'trash']];
    }));
  }
  function renderJournals(box, scroll) {
    const tr = window.SimaSettings.menuText, locale = window.SimaSettings.effectiveLanguage();
    const y = journalMonth.getFullYear(), m = journalMonth.getMonth();
    const today = localDay(new Date()), dates = new Set(journalRows.map(r => r.date));
    const selected = active?.pendingJournal?.date ?? journalRows.find(r => r.path === active?.path)?.date;
    const calendar = document.createElement('div');
    calendar.className = 'journal-calendar';
    const name = journalMonth.toLocaleDateString(locale,{month:'long',year:'numeric'});
    calendar.innerHTML = '<div class="journal-month">'+iconButton('上个月','left','data-month="-1"')+'<strong>'+esc(name)+'</strong>'+iconButton('下个月','right','data-month="1"')+'</div>';
    const grid = document.createElement('div');
    grid.className = 'journal-days';
    for (let n=0; n<7; n++) {
      const day = document.createElement('span');
      day.textContent = new Date(2024,0,1+n).toLocaleDateString(locale,{weekday:'short'});
      grid.append(day);
    }
    const offset = (journalMonth.getDay()+6)%7;
    for (let n=1; n<=new Date(y,m+1,0).getDate(); n++) {
      const date = localDay(new Date(y,m,n,12)), button = document.createElement('button');
      button.textContent = n;
      if (n === 1) button.style.gridColumnStart = offset+1;
      button.classList.toggle('has-journal',dates.has(date));
      if (date === selected) button.classList.add('selected');
      if (date === today) button.setAttribute('aria-current','date');
      button.title = date + ' · ' + tr('打开日记');
      button.setAttribute('aria-label',button.title);
      button.onclick = e => call(() => openDay(date, e.metaKey));
      if (dates.has(date)) button.oncontextmenu = e => journalTrashMenu(e, journalRows.filter(row => row.date === date));
      grid.append(button);
    }
    calendar.append(grid);
    calendar.querySelectorAll('[data-month]').forEach(button => button.onclick = () => {
      journalMonth = new Date(y,m+Number(button.dataset.month),1,12);
      renderSide();
    });
    box.append(calendar);
    box.insertAdjacentHTML('beforeend',section('全部日记'));
    const list = document.createElement('div');
    list.className = 'journal-list side-scroll';
    for (const row of journalRows) {
      const button = document.createElement('button');
      button.className = 'journal-entry';
      button.dataset.path = row.path;
      button.setAttribute('aria-current',String(row.path === active?.path));
      button.innerHTML = '<small>'+esc(row.date || tr('日期未记'))+'</small><span>'+esc(row.title)+'</span>';
      button.title = row.path;
      button.oncontextmenu = e => journalTrashMenu(e, [row]);
      button.onclick = e => call(async () => {
        if (row.date) journalMonth = monthOf(row.date);
        await openPath(row.path,{newTab:e.metaKey,permanent:true});
        renderSide();
      });
      list.append(button);
    }
    box.append(list);
    list.scrollTop = scroll;
  }
  let treeResize;
  function renderSide() {
    treeResize?.disconnect();
    document.querySelectorAll('[data-mode]').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
      b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    });
    const box = $('sideContent');
    const journalScroll = box.querySelector('.journal-list')?.scrollTop || 0;
    $('todayButton').hidden = journalFolder() == null;
    const journal = mode === 'journals' && journalRows.find(row => row.path === active?.path);
    $('journalHeading').hidden = !journal?.date || journal.title === journal.date;
    $('journalHeading').textContent = journal?.date || '';
    box.replaceChildren();
    if (!root) {
      box.innerHTML = section('工作区') +
        '<div class="side-empty">选择文件夹后，在这里浏览目录和文档。</div>';
      return;
    }
    if (mode === 'journals') { renderJournals(box,journalScroll); return; }
    if (mode === 'search') {
      renderSearch();
      return;
    }
    box.innerHTML = section(
      '文件目录',
      iconButton('新建笔记', 'filePlus', 'data-run="file.new"') +
        iconButton('折叠全部', 'collapse', 'data-run="tree.collapse"') +
        iconButton('目录操作', 'more', 'id="treeMenu"'),
    ) + '<div id="sideScroll" class="side-scroll" role="tree"></div>';
    $('treeMenu').onclick = (e) => treeMenu(e.currentTarget, '', true);
    const sc = $('sideScroll');
    sc.ondragover = (e) => {
      if (e.dataTransfer.types.includes('application/x-simaq-path')) e.preventDefault();
    };
    sc.ondrop = (e) => {
      e.preventDefault();
      const p = e.dataTransfer.getData('application/x-simaq-path');
      if (p && parentOf(p)) call(() => moveFile(p, nameOf(p)));
    };
    const visible = [];
    const flatten = (nodes, depth) => {
      for (const node of nodes) {
        visible.push({node, depth});
        if (node.dir && expanded.has(node.path)) flatten(node.children || [], depth + 1);
      }
    };
    flatten(tree, 0);
    const row = (n, depth) => {
        const b = document.createElement('button');
        b.className = 'tree-row' + (selectedPath === n.path ? ' selected' : '');
        b.dataset.path = n.path;
        const style = n.dir ? applyDirectoryColor(b, n.path) : null;
        b.draggable = true;
        b.setAttribute('role', 'treeitem');
        b.setAttribute('aria-level', depth + 1);
        b.title = n.path;
        b.style.paddingLeft = (4 + depth * 14) + 'px';
        if (n.dir) b.setAttribute('aria-expanded', String(expanded.has(n.path)));
        b.innerHTML = '<span class="expander">' +
          (n.dir ? icon(expanded.has(n.path) ? 'chevronDown' : 'right') : '') + '</span>' + (n.dir
            ? '<span class="file-glyph folder-icon">' +
              icon(depth === 0 && style ? style.icon : expanded.has(n.path) ? 'folderOpen' : 'folder') + '</span>'
            : glyph(n.path)) +
          '<span class="tree-name">' + esc(n.name) + '</span>';
        b.onclick = (e) => {
          if (n.dir) {
            captureSideScroll();
            selectedPath = n.path;
            expanded.has(n.path) ? expanded.delete(n.path) : expanded.add(n.path);
            renderSide();
            persistSoon();
          } else call(() => openPath(n.path,{newTab:e.metaKey,permanent:true}));
        };
        b.oncontextmenu = (e) => {
          e.preventDefault();
          selectedPath = n.path;
          sc.querySelectorAll('.selected').forEach((a) => a.classList.remove('selected'));
          b.classList.add('selected');
          treeMenu(e, n.path, n.dir);
        };
        b.ondragstart = (e) => {
          e.dataTransfer.setData('application/x-simaq-path', n.path);
          e.dataTransfer.effectAllowed = 'move';
        };
        if (n.dir) {
          b.ondragover = (e) => {
            if (e.dataTransfer.types.includes('application/x-simaq-path')) {
              e.preventDefault();
              b.classList.add('is-drop');
            }
          };
          b.ondragleave = () => b.classList.remove('is-drop');
          b.ondrop = (e) => {
            e.preventDefault();
            e.stopPropagation();
            b.classList.remove('is-drop');
            const p = e.dataTransfer.getData('application/x-simaq-path');
            if (p && !atOrUnder(n.path, p) && parentOf(p) !== n.path) {
              call(() => moveFile(p, join(n.path, nameOf(p))));
            }
          };
        }
        return b;
    };
    if (!visible.length) {
      sc.innerHTML = '<div class="side-empty">这个文件夹还是空的。</div>';
      return;
    }
    if (visible.length <= 300) {
      sc.append(...visible.map(({node,depth}) => row(node,depth)));
      sc.scrollTop = treeScroll;
      sc.onscroll = () => treeScroll = sc.scrollTop;
      return;
    }
    const spacer = document.createElement('div'), body = document.createElement('div');
    const height = 29;
    spacer.className = 'tree-spacer';
    spacer.style.height = (visible.length * height) + 'px';
    body.className = 'tree-window';
    spacer.append(body);
    sc.append(spacer);
    let lastFirst = -1, lastEnd = -1;
    function paint(offset) {
      const first = Math.max(0, Math.floor(offset / height) - 12);
      const end = Math.min(visible.length, first + Math.ceil(sc.clientHeight / height) + 30);
      if (first === lastFirst && end === lastEnd) return;
      // Keep overlapping rows mounted, including a focused row. The scroll range
      // belongs to the spacer and stays constant as the window moves.
      while (body.firstChild && +body.firstChild.dataset.index < first) body.firstChild.remove();
      while (body.lastChild && +body.lastChild.dataset.index >= end) body.lastChild.remove();
      const firstRetained = body.firstChild;
      for (let i = first; i < end; i++) {
        if (i >= lastFirst && i < lastEnd) continue;
        const button = row(visible[i].node, visible[i].depth);
        button.dataset.index = i;
        if (i < lastFirst) body.insertBefore(button, firstRetained);
        else body.append(button);
      }
      body.style.transform = 'translateY(' + first * height + 'px)';
      lastFirst = first;
      lastEnd = end;
    }
    sc.revealPath = (path) => {
      const index = visible.findIndex(item => item.node.path === path);
      if (index < 0) return;
      if (index * height < sc.scrollTop || (index + 1) * height > sc.scrollTop + sc.clientHeight) {
        sc.scrollTop = Math.max(0, index * height - sc.clientHeight / 2);
        paint(sc.scrollTop);
      }
    };
    paint(treeScroll);
    sc.scrollTop = treeScroll;
    let frame = 0;
    const queuePaint = () => {
      treeScroll = sc.scrollTop;
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (sc.isConnected) paint(sc.scrollTop); });
    };
    sc.onscroll = queuePaint;
    treeResize = new ResizeObserver(() => paint(sc.scrollTop));
    treeResize.observe(sc);
  }
  function activateSide(m, remember = true) {
    if (m !== mode) {
      if (remember) pushHistory();
      captureSideScroll();
      mode = m;
      renderSide();
    }
    if (sidebarHidden) {
      sidebarHidden = false;
      setLayout();
    }
    persistSoon();
  }
  function headings(text) {
    const h = [];
    let pos = 0, fence = null, yaml = text.startsWith('---\n');
    for (const [index, line] of text.split('\n').entries()) {
      const delimit = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (yaml) { if (index && /^(---|\.\.\.)\s*$/.test(line)) yaml = false; }
      else if (delimit) {
        if (!fence) fence = delimit[1];
        else if (delimit[1][0] === fence[0] && delimit[1].length >= fence.length) fence = null;
      } else if (!fence) {
        const m = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
        if (m) h.push({ title: m[2], level: m[1].length, start: pos + line.indexOf(m[2]) });
      }
      pos += line.length + 1;
    }
    return h;
  }
  async function refreshTree() {
    const g = generation, req = ++treeRequest;
    const results = await rpc('tree');
    if (g !== generation || req !== treeRequest) return;
    tree = Array.isArray(results) ? results : results.tree || [];
    assignDirectoryStyles(tree);
    for (const t of tabs) if (t.host) applyDirectoryColor(t.host, t.path);
    folders.clear();
    files.clear();
    function walk(nodes) {
      for (const n of nodes) {
        if (n.dir) {
          folders.add(n.path);
          walk(n.children || []);
        } else files.set(n.path, n);
      }
    }
    walk(tree);
    $('todayButton').hidden = journalFolder() == null;
    if (mode === 'journals') {
      if ($('todayButton').hidden) mode = 'tree';
      else await refreshJournals();
    }
    if (mode === 'tree') {
      captureSideScroll();
      renderSide();
    }
    renderStatus();
  }
  function revealTreePath(path) {
    let p = parentOf(path);
    while (p) {
      expanded.add(p);
      p = parentOf(p);
    }
    selectedPath = path;
    if (mode === 'tree') {
      renderSide();
      $('sideScroll').revealPath?.(path);
      const row = [...$('sideScroll').querySelectorAll('[data-path]')].find((x) => x.dataset.path === path);
      row?.scrollIntoView({ block: 'nearest' });
    }
  }
  function searchArgs() {
    const dirty = tabs.filter(t => t.dirty && t.editor);
    return {
      ...(dirty.length ? {buffers:Object.fromEntries(dirty.map(t => [t.path,t.editor.getText()]))} : {}),
      limit: search.limit || 60,
      hitLimit: 5,
      q: search.q,
      caseSensitive: search.caseSensitive,
      wholeWord: search.wholeWord,
      regex: search.regex,
      exact: search.exact,
      folder: search.folder,
      extensions: [...search.extensions],
      excludeArchive: search.excludeArchive,
      ...(search.scope === 'document' && search.document ? { document: search.document } : {}),
    };
  }
  function renderSearch() {
    const box = $('sideContent');
    box.innerHTML = '<div class="search-wrap"><div class="search-input">' + icon('search') +
      '<input id="queryInput" aria-label="搜索" placeholder="' +
      (search.scope === 'document' ? '查找当前文档…' : '搜索工作区…') +
      '" autocomplete="off" spellcheck="false">' + iconButton('清空搜索', 'close', 'id="clearSearch"') +
      '</div><div class="search-options"><button data-option="caseSensitive" title="区分大小写" aria-label="区分大小写">Aa</button><button data-option="wholeWord" title="整词" aria-label="整词"><u>ab</u></button><button data-option="regex" title="正则表达式" aria-label="正则表达式">.*</button><button data-option="exact" title="精确短语" aria-label="精确短语">“ ”</button><button class="filter-btn" data-option="filters" title="搜索范围" aria-label="搜索范围">' +
      icon('filter') + '</button></div><div id="filters"></div></div>' +
      section(search.scope === 'document' ? '当前文档' : '工作区搜索', '<span id="searchCount"></span>') +
      '<div class="side-scroll search-results" id="sideScroll"></div>';
    const q = $('queryInput');
    q.value = search.q;
    $('clearSearch').hidden = !q.value;
    let composing = false;
    q.oncompositionstart = () => composing = true;
    q.oncompositionend = () => {
      composing = false;
      input();
    };
    function input() {
      if (composing) return;
      for (const tab of tabs) tab.editor?.setHighlights?.([]);
      search.q = q.value;
      search.limit = 60;
      search.selected = search.current = null;
      search.collapsed = [];
      search.hitLimits = {};
      search.scroll = 0;
      groups = [];
      $('clearSearch').hidden = !q.value;
      scheduleSearch();
      persistSoon();
    }
    q.oninput = input;
    $('clearSearch').onclick = () => {
      q.value = '';
      input();
      q.focus();
    };
    for (const b of box.querySelectorAll('[data-option]')) {
      const k = b.dataset.option;
      b.classList.toggle('active', search[k]);
      b.setAttribute('aria-pressed', String(search[k]));
      b.onclick = () => {
        search[k] = !search[k];
        renderSearch();
        if (k !== 'filters') scheduleSearch();
        persistSoon();
        $('queryInput').focus();
      };
    }
    if (search.filters) {
      const filter = $('filters');
      filter.className = 'search-filters';
      filter.innerHTML =
        '<label>范围<select class="scope-selector" id="searchScope"><option value="all">整个工作区</option>' +
        (active ? '<option value="document">当前文档</option>' : '') +
        '</select></label><label>目录<select class="scope-selector" id="folderFilter"><option value="">全部目录</option>' +
        [...folders].map((p) => '<option value="' + esc(p) + '">' + esc(p) + '</option>').join('') +
        '</select></label><div class="filter-ext">' +
        [['Markdown', 'md,markdown,mdown,mkd'], ['HTML', 'html,htm'], ['PDF', 'pdf'], ['SVG','svg'], ['JSON','json'], ['TXT','txt']].map(([l, v]) =>
          '<label><input type="checkbox" value="' + v + '" ' +
          (search.extensions.includes(v.split(',')[0]) ? 'checked' : '') + '>' + l + '</label>'
        ).join('') + '</div><label><input type="checkbox" id="archiveFilter" ' +
        (search.excludeArchive ? 'checked' : '') + '>排除归档目录</label>';
      $('searchScope').value = search.scope;
      $('searchScope').onchange = (e) => {
        search.scope = e.target.value;
        search.document = active?.path;
        renderSearch();
        scheduleSearch();
        persistSoon();
      };
      $('folderFilter').value = search.folder;
      $('folderFilter').onchange = (e) => {
        search.folder = e.target.value;
        scheduleSearch();
        persistSoon();
      };
      $('archiveFilter').onchange = (e) => {
        search.excludeArchive = e.target.checked;
        scheduleSearch();
        persistSoon();
      };
      filter.querySelectorAll('.filter-ext input').forEach((c) =>
        c.onchange = () => {
          search.extensions = [...filter.querySelectorAll('.filter-ext input:checked')].flatMap((a) =>
            a.value.split(',')
          );
          scheduleSearch();
          persistSoon();
        }
      );
    }
    drawResults();
    q.onkeydown = searchKeys;
  }
  function hitKey(path, n) {
    return JSON.stringify([path, n]);
  }
  function drawResults(busy = false) {
    const sc = $('sideScroll');
    if (mode !== 'search' || !sc) return;
    sc.replaceChildren();
    const total = groups.reduce((n, g) => n + g.count, 0);
    const prefix = groups.length >= (search.limit || 60) ? '已显示 ' : '';
    $('searchCount').textContent = search.q
      ? (busy ? '搜索中…' : prefix + groups.length + ' 个文件 · ' + total + ' 处')
      : '';
    if (!search.q.trim() || !groups.length) {
      sc.innerHTML = '<div class="side-empty">' +
        (!search.q.trim() ? '输入文件名、标题或正文。' : busy ? '正在查找…' : '没有匹配结果。') + '</div>';
      return;
    }
    for (const g of groups) {
      const folded = search.collapsed.includes(g.path), head = document.createElement('button');
      const group = document.createElement('section');
      group.className = 'search-file-group';
      group.setAttribute('aria-label', g.path + '，' + g.count + ' 处匹配');
      sc.append(group);
      head.className = 'group-head';
      head.title = g.path;
      head.oncontextmenu = e => {
        e.preventDefault();
        menu(e,[['在新标签页中打开', () => openPath(g.path,{newTab:true,permanent:true}), 'doc']]);
      };
      head.setAttribute('aria-expanded', String(!folded));
      head.innerHTML = '<span class="expander">' + icon(folded ? 'right' : 'chevronDown') + '</span>' +
        '<span class="group-info"><span class="group-title"><span class="basename">' +
        esc(stem(g.path)) + '</span><small class="file-ext">.' + esc(extOf(g.path)) +
        '</small></span><small class="group-path">' + esc((parentOf(g.path) || nameOf(root)) + '/') +
        '</small></span><span class="group-count">' + g.count + '</span>';
      head.onclick = e => {
        if (e.metaKey) return call(() => openPath(g.path,{newTab:true,permanent:true}));
        captureSideScroll();
        search.collapsed = folded
          ? search.collapsed.filter((p) => p !== g.path)
          : [...search.collapsed, g.path];
        drawResults();
        persistSoon();
      };
      group.append(head);
      if (folded) continue;
      g.hits.forEach((h, i) => {
        const k = hitKey(g.path, i), b = document.createElement('button');
        b.dataset.hit = k;
        b.className = 'hit-row' + (search.selected === k ? ' selected' : '') +
          (search.current === k ? ' current' : '');
        const kind =
          { filename: '文件名', name: '文件名', path: '路径', title: '标题', heading: '标题' }[h.kind] ||
          (h.page ? '第 ' + h.page + ' 页' : '');
        b.title = g.path + '\n' + (h.before || '') + h.match + (h.after || '');
        b.innerHTML = (kind ? '<span class="hit-kind">' + esc(kind) + '</span>' : '') +
          esc((h.before || '').split(/\r?\n/).pop().slice(-14)) + '<mark class="md-search-hit">' + esc(h.match) +
          '</mark>' + esc((h.after || '').replace(/\s+/g, ' '));
        b.onclick = (e) => call(() => followHit(g, i, e.metaKey));
        b.oncontextmenu = e => {
          e.preventDefault();
          menu(e,[['在新标签页中打开', () => followHit(g,i,true), 'doc']]);
        };
        b.ondblclick = () => {
          const t = tabs.find((t) => t.path === g.path);
          if (t) {
            t.preview = false;
            renderTabs();
            persistSoon();
          }
        };
        b.onkeydown = searchKeys;
        group.append(b);
      });
      if (g.hits.length < g.count) {
        const more = document.createElement('button');
        more.className = 'group-more';
        more.textContent = '再显示 ' + Math.min(40, g.count - g.hits.length) + ' 处';
        more.onclick = () => call(async () => {
          const limit = g.hits.length + 40;
          more.disabled = true;
          let full;
          try {
            [full] = await rpc('search', { ...searchArgs(), document: g.path, hitLimit: limit });
          } finally {
            more.disabled = false;
          }
          if (!groups.includes(g) || !full) return;
          Object.assign(g, full);
          search.hitLimits[g.path] = limit;
          captureSideScroll();
          drawResults();
          persistSoon();
        });
        group.append(more);
      }
    }
    if (groups.length >= (search.limit || 60) && (search.limit || 60) < 1000) {
      const more = document.createElement('button');
      more.className = 'main-button';
      more.textContent = '显示更多结果';
      more.onclick = () => {
        search.limit = Math.min(1000, (search.limit || 60) + 60);
        scheduleSearch(true);
      };
      sc.append(more);
    }
    sc.scrollTop = search.scroll;
    sc.onscroll = () => search.scroll = sc.scrollTop;
  }
  function scheduleSearch(immediate = false) {
    clearTimeout(searchTimer);
    const ticket = ++searchRequest;
    if (!search.q.trim()) {
      groups = [];
      drawResults();
      return;
    }
    if (mode === 'search' && !groups.length) drawResults(true);
    const perform = async () => {
      const results = await rpc('search', { ...searchArgs(), hitLimits: search.hitLimits });
      if (ticket !== searchRequest || mode !== 'search') return;
      groups = Array.isArray(results) ? results : results.groups || [];
      drawResults();
    };
    if (immediate) call(perform);
    else searchTimer = setTimeout(() => call(perform), 20);
  }
  async function followHit(g, i, permanent = false) {
    const h = g?.hits?.[i];
    if (!h) return;
    return serialize(async () => {
      pushHistory();
      search.selected = search.current = hitKey(g.path, i);
      captureSideScroll();
      const ranges = g.hits.filter(hit => !['name','filename','path'].includes(hit.kind));
      await doOpen(g.path, { newTab:permanent, permanent, preview: !permanent, history: false, hit: h, ranges });
      drawResults();
      persistSoon();
    });
  }
  function searchKeys(e) {
    if (e.isComposing || e.keyCode === 229) return;
    if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) return;
    const list = groups.filter((g) => !search.collapsed.includes(g.path)).flatMap((g) =>
      g.hits.map((h, i) => ({ g, i, k: hitKey(g.path, i) }))
    );
    if (!list.length) return;
    e.preventDefault();
    e.stopPropagation();
    let i = list.findIndex((r) => r.k === search.selected);
    if (e.key === 'Enter') {
      const r = list[Math.max(0, i)];
      call(() => followHit(r.g, r.i, e.metaKey));
      return;
    }
    i = e.key === 'ArrowDown'
      ? Math.min(list.length - 1, i + 1)
      : Math.max(0, (i < 0 ? list.length : i) - 1);
    search.selected = list[i].k;
    drawResults();
    [...$('sideScroll').querySelectorAll('[data-hit]')].find((b) => b.dataset.hit === search.selected)
      ?.scrollIntoView({ block: 'nearest' });
    persistSoon();
  }
  function openSearch(scope) {
    if (!root) return chooseWorkspace('chooseRoot');
    if (scope === 'document' && !active) return;
    const changed = mode !== 'search' || scope !== search.scope ||
      scope === 'document' && active?.path !== search.document;
    if (changed) pushHistory();
    captureSideScroll();
    search.scope = scope;
    search.document = scope === 'document' ? active?.path : null;
    mode = 'search';
    sidebarHidden = false;
    setLayout();
    renderSide();
    $('queryInput').focus();
    $('queryInput').select();
    scheduleSearch(true);
    persistSoon();
  }
  function tabRecord(path, opts = {}) {
    return {
      path,
      state: opts.state || copy(documentViews.get(path)) || {},
      pendingJournal: opts.pendingJournal || null,
      pinned: !!opts.pinned,
      preview: !!opts.preview,
      editor: null,
      host: null,
      dirty: false,
      base: null,
      version: null,
      conflict: null,
      draftTimer: null,
      saveTimer: null,
      work: Promise.resolve(),
      silent: false,
    };
  }
  function bufferTask(t, fn) {
    t.work = t.work.catch(() => {}).then(fn);
    return t.work;
  }
  function writeDraft(t) {
    clearTimeout(t.draftTimer);
    if (!t.editor || !t.dirty) return t.work;
    return bufferTask(
      t,
      () => t.dirty ? rpc('draft', { path: t.path, text: t.editor.getText(), version: t.version }) : null,
    );
  }
  function stopTimers(t) {
    clearTimeout(t.draftTimer);
    clearTimeout(t.saveTimer);
  }
  function onEdit(t) {
    if (t.silent || !t.editor) return;
    const text = t.editor.getText();
    t.dirty = t.pendingJournal
      ? !!text.trim() && text.trim() !== t.base.trim()
      : text !== t.base;
    if (t.dirty) t.preview = false;
    stopTimers(t);
    if (t.dirty) {
      t.draftTimer = setTimeout(() => call(() => writeDraft(t)), 120);
      if (!t.conflict) t.saveTimer = setTimeout(() => call(() => saveTab(t)), 1100);
    } else if (!t.conflict) call(() => bufferTask(t, () => rpc('clearDraft', { path: t.path })));
    renderTabs();
    renderStatus();
    if (active === t && isMd(t.path) && !outlineHidden) {
      clearTimeout(outlineEditTimer);
      outlineEditTimer=setTimeout(()=>scheduleOutline(true),120);
    }
    if (mode === 'search' && search.q) scheduleSearch();
    persistSoon();
  }
  async function saveTab(t) {
    if (!t?.editor) return true;
    stopTimers(t);
    return bufferTask(t, async () => {
      if (t.conflict) return false;
      if (!t.dirty) return true;
      const text = t.editor.getText(), version = t.version;
      await rpc('draft', { path: t.path, text, version });
      const pending = t.pendingJournal;
      const out = pending
        ? await rpc('createJournal',{path:t.path,text,day:pending.date,root})
        : await rpc('save',{path:t.path,text,version});
      if (pending) {
        t.pendingJournal = null;
        mountReferences(t);
      }
      if (out.conflict) {
        t.conflict = { text: out.text ?? '', version: out.version, deleted: !!out.deleted };
        renderStatus();
        return false;
      }
      t.version = out.version;
      t.base = text;
      t.dirty = t.editor.getText() !== text;
      if (t.dirty) await rpc('draft', { path: t.path, text: t.editor.getText(), version: t.version });
      else await rpc('clearDraft', { path: t.path });
      renderTabs();
      renderStatus();
      if (pending) { await refreshTree(); persistSoon(); }
      if (mode === 'search' && search.q) scheduleSearch();
      return true;
    });
  }
  let pendingImageMenu = null;
  let imageMenuSerial = 0;
  function prepareImageMenu(tab,point,image,items,useNative) {
    const url = image.currentSrc || image.src;
    if (url.startsWith('simaq-asset://workspace/')) {
      items.unshift(['复制图片', () => rpc('copyImage',{url})], ['导出图片…', () => rpc('exportImage',{url})]);
    }
    if (!useNative) { menu(point,items); return; }
    const token = String(++imageMenuSerial);
    pendingImageMenu = {token,tab,image,items};
    call(() => rpc('prepareImageMenu',{
      ...point,token,items:items.map(([label,,icon]) =>
        ({title:window.SimaSettings.menuText(label),checked:icon==='check',copyFallback:label==='复制图片'}))
    }));
  }
  async function imageAsset(t, file) {
    const data = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    const folder = window.SimaSettings.imageFolder(t.path);
    const out = await rpc('asset', { path: t.path, filename: file.name || '截图.png', folder, data });
    return out.link;
  }
  async function createEditor(t) {
    const data = t.pendingJournal ? {text:t.pendingJournal.text,version:''} : await rpc('read', { path: t.path });
    const host = document.createElement('div');
    host.className = 'doc-host';
    applyDirectoryColor(host, t.path);
    host.hidden = true;
    $('hosts').append(host);
    t.host = host;
    t.base = data.text;
    t.version = data.version;
    try {
      t.editor = window.SimaEditor.create(host, {
        text: data.text,
        path: t.path,
        workspaceName: nameOf(root),
        literal: !isMd(t.path),
        settings: settings(),
        onChange: () => onEdit(t),
        onViewChange: persistSoon,
        onOutlineChange: () => { if (active === t) scheduleOutline(true); },
        isSearchActive: () => mode === 'search',
        onLink: (link, options) => call(() => followLink(t, link, options)),
        onImageMenu: (point,image,items,useNative) => prepareImageMenu(t,point,image,items,useNative),
        onAsset: isMd(t.path) ? (file) => imageAsset(t, file) : undefined,
      });
      if (Object.keys(t.state || {}).length) t.editor.setState(t.state);
      if (isMd(t.path) && !t.pendingJournal) mountReferences(t);
    } catch (e) {
      host.remove();
      t.host = null;
      throw e;
    }
  }
  function mountReferences(t) {
    const viewport = t.host.querySelector('.sima-editor');
    const panel = document.createElement('details');
    panel.className = 'sima-references';
    panel.open = true;
    const summary = document.createElement('summary'), list = document.createElement('div');
    const caption = document.createElement('span'), count = document.createElement('span');
    caption.dataset.menuText = '引用此页';
    caption.textContent = window.SimaSettings.menuText('引用此页');
    summary.append(caption,count);
    panel.append(summary,list);
    viewport.append(panel);
    let visible = false, stale = true, revision = 0;
    panel.setAttribute('aria-busy','true');
    async function update() {
      if (!visible || !panel.open || !stale || !panel.isConnected || !t.host || t.host.hidden) return;
      stale = false;
      const request = ++revision;
      try {
        const {pageCount,rows} = await rpc('pageReferences',{path:t.path,root});
        if (request !== revision || !panel.isConnected) return;
        const groups = new Map();
        for (const row of rows) {
          if (!groups.has(row.path)) groups.set(row.path,[]);
          groups.get(row.path).push(row);
        }
        panel.setAttribute('aria-busy','false');
        count.textContent = ' · ' + pageCount;
        list.replaceChildren();
        for (const [path,references] of groups) {
          const title = document.createElement('p');
          title.textContent = path;
          list.append(title);
          for (const ref of references) {
            const card = document.createElement('div'), excerpt = document.createElement('span');
            card.className = 'reference-card';
            excerpt.className = 'reference-excerpt';
            excerpt.append(window.SimaRender.referenceExcerpt(ref));
            const jump = document.createElement('button');
            jump.type = 'button';
            jump.textContent = '↗';
            jump.title = path + ' · L' + ref.line;
            jump.setAttribute('aria-label',jump.title);
            card.append(excerpt,jump);
            card.onclick = e => {
              e.stopPropagation();
              const link = e.target.closest('a[href]');
              if (link) {
                e.preventDefault();
                call(() => followLink({path},link.getAttribute('href'),{wiki:link.hasAttribute('data-wiki'),newTab:e.metaKey||e.ctrlKey}));
              } else if (jump.contains(e.target) || window.getSelection()?.isCollapsed) {
                call(() => openPath(path,{line:ref.line,permanent:true}));
              }
            };
            list.append(card);
          }
        }
      } catch (e) {
        if (request !== revision || !panel.isConnected) return;
        stale = true;
        panel.setAttribute('aria-busy','false');
        list.textContent = e.message;
      }
    }
    t.refreshReferences = () => { stale=true; revision++; update(); };
    panel.ontoggle = update;
    t.referenceObserver = new IntersectionObserver(entries => {
      visible = entries.at(-1).isIntersecting;
      update();
    },{root:viewport,rootMargin:'160px'});
    t.referenceObserver.observe(panel);
  }
  async function releaseReader() {
    if (!readerPath) return;
    const path = readerPath, t = tabs.find((t) => t.path === path);
    const state = await rpc('readerState');
    if (t && state) t.state = state;
    readerPath = null;
    await rpc('readerClose');
    $('readerTarget').hidden = true;
  }
  async function activate(t, forceReader = false) {
    const old = active;
    if (old !== t || forceReader) {
      rememberState(old);
      await releaseReader();
    }
    if (old?.host) old.host.hidden = old !== t;
    active = t;
    if (mode === 'journals' && t && old !== t) {
      const entry = t.pendingJournal || journalRows.find(row => row.path === t.path);
      if (entry?.date) journalMonth = monthOf(entry.date);
    }
    if (!t) {
      $('readerTarget').hidden = true;
      renderFrame();
      renderSide();
      persistSoon();
      window.SimaSettings?.refreshCommands?.();
      return;
    }
    if (t.editor) {
      t.host.hidden = false;
      $('readerTarget').hidden = true;
    } else $('readerTarget').hidden = false;
    renderFrame();
    if (!t.editor && readerPath !== t.path) {
      readerPath = t.path;
      await rpc('readerOpen', { path: t.path, state: t.state || {}, rect: readerRect() });
    }
    revealTreePath(t.path);
    $('tabBar').querySelector('[aria-selected=true]')?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
    window.SimaSettings?.refreshCommands?.();
    persistSoon();
  }
  async function disposeTab(t) {
    if (pendingImageMenu?.tab === t) pendingImageMenu = null;
    stopTimers(t);
    await t.work.catch(() => {});
    t.referenceObserver?.disconnect();
    t.editor?.destroy();
    t.host?.remove();
    const n = tabs.indexOf(t);
    if (n >= 0) tabs.splice(n, 1);
  }
  function closeTabs(include) {
    return serialize(async () => {
      // Keep the displayed document until last, so closing background tabs
      // never opens a reader or loads a restored document just to close it.
      const targets = tabs.filter(t => t !== active && include(t));
      if (active && include(active)) targets.push(active);
      for (const tab of targets) {
        if (!await closeTab(tab)) break;
      }
    });
  }
  async function closeTab(t = active, { record = true, force = false } = {}) {
    if (!t) return true;
    while (!force && t.editor && t.dirty) {
      if (!await saveTab(t)) {
        const answer = await dialog(
          '保存恢复副本后关闭？',
          '<p>磁盘版本与当前编辑冲突。下次打开资料库时可以恢复这些编辑。</p>',
          [['取消', 'cancel'], ['保留恢复副本并关闭', 'ok', 'primary']],
        );
        if (answer?.id !== 'ok') return false;
        await writeDraft(t);
        break;
      }
    }
    const index = tabs.indexOf(t);
    if (t === active) await releaseReader();
    rememberState(t);
    if (record && !t.pendingJournal) {
      documentViews.delete(t.path);
      documentViews.set(t.path, copy(t.state));
      closed.push({ path: t.path, state: copy(t.state), pinned: t.pinned });
      if (closed.length > 30) closed.shift();
    }
    if (t === active) active = null;
    await disposeTab(t);
    if (!active) {
      const nextTab = tabs[Math.min(index, tabs.length - 1)];
      if (nextTab) await doOpen(nextTab.path, { history: false });
      else await activate(null);
    } else renderFrame();
    persistSoon();
    return true;
  }
  const readerAction = (action, payload = {}) => rpc('readerAction', { action, payload });
  async function locate(t, opts) {
    if (opts.fragment) {
      const frag = opts.fragment.replace(/^#/, '');
      if (t.editor) {
        let fragment = frag;
        try {
          fragment = decodeURIComponent(frag);
        } catch {}
        const slug = (s) => s.toLowerCase().trim().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/\s+/g, '-');
        const seen = new Set();
        const entries = headings(t.editor.getText()).map(h => {
          const base = slug(h.title);
          let anchor = base, ordinal = 0;
          while (seen.has(anchor)) anchor = base + '-' + (++ordinal);
          seen.add(anchor);
          return {...h, anchor};
        });
        const h = entries.find(h => h.anchor === slug(fragment)) ||
          entries.find(h => h.title === fragment);
        if (h) t.editor.locate(h.start, h.title.length);
        else toast('未找到标题“' + fragment + '”');
      } else await readerAction('anchor', { fragment: frag });
    }
    if (opts.hit) {
      const contentHit = !['name','filename','path'].includes(opts.hit.kind);
      if (t.editor) t.editor.showSearchResult(opts.ranges,contentHit ? opts.hit : null);
      else if (contentHit) await readerAction('locate', opts.hit);
    }
    if (opts.line && t.editor) {
      const lines = t.editor.getText().split('\n'),
        pos = lines.slice(0, opts.line - 1).reduce((n, l) => n + l.length + 1, 0);
      t.editor.locate(pos, lines[opts.line - 1]?.length || 0);
    }
  }
  async function doOpen(path, opts = {}) {
    if (!path) return;
    if (!supported(path)) {
      toast('此格式可在 Finder 中打开。');
      return;
    }
    if (opts.history !== false && (active?.path !== path || opts.hit || opts.fragment || opts.line)) {
      pushHistory();
    }
    let t = tabs.find((t) => t.path === path), fresh = !t;
    const replaced = fresh && opts.newTab === false && !active?.pinned ? active : null;
    if (!t) t = tabRecord(path, opts);
    if (isEditable(path) && !t.editor) await createEditor(t);
    if (fresh) {
      const preview = opts.preview && opts.newTab === undefined ? tabs.find((o) => o.preview && !o.dirty && !o.pinned) : null;
      if (preview) {
        const idx = tabs.indexOf(preview);
        if (active === preview) {
          await releaseReader();
          active = null;
        }
        await disposeTab(preview);
        tabs.splice(idx, 0, t);
      } else if (replaced) tabs.splice(tabs.indexOf(replaced) + 1, 0, t);
      else tabs.push(t);
    } else if (opts.preview !== true && opts.permanent) t.preview = false;
    await activate(t);
    if (opts.state && t.editor) t.editor.setState(opts.state);
    await locate(t, opts);
    // Keep the source available until the destination loads and its edits are saved.
    if (replaced && !replaced.conflict && (!replaced.dirty || await saveTab(replaced)) && !replaced.dirty) {
      await closeTab(replaced);
    }
    if (t.editor && !opts.hit && opts.focus) t.editor.focus();
    return t;
  }
  function openPath(path, opts = {}) {
    return serialize(() => doOpen(path, opts));
  }
  async function travel(forward) {
    const from = forward ? next : previous, to = forward ? previous : next;
    if (!from.length) return;
    to.push(snapshot());
    const entry = from.pop();
    await restoreLocation(entry);
    updateNav();
  }
  async function restoreLocation(entry) {
    const was = restoring;
    restoring = true;
    try {
      captureSideScroll();
      mode = entry.mode === 'journals' && journalFolder() != null ? 'journals' : entry.mode === 'search' ? 'search' : 'tree';
      if (mode === 'journals') await refreshJournals();
      search = Object.assign(defaultSearch(), entry.search);
      selectedPath = entry.selectedPath || '';
      treeScroll = entry.treeScroll || 0;
      if (entry.path) {
        const journal = entry.journalDay && journalFolder() != null
          ? await rpc('openJournal',{folder:journalFolder(),root,day:entry.journalDay}) : null;
        const t = await doOpen(journal?.path || entry.path, { history:false,state:entry.state,pendingJournal:journal?.pending ? journal : null,preview:!!journal?.pending });
        if (t && !t.editor && entry.state) {
          t.state = entry.state;
          await rpc('readerOpen', { path: t.path, state: t.state, rect: readerRect() });
        }
      } else await activate(null);
      renderSide();
      if (mode === 'search') scheduleSearch(true);
    } finally {
      restoring = was;
      persistSoon();
    }
  }
  function updateText(t, data, keepState = true) {
    const state = keepState ? t.editor.getState() : null;
    t.silent = true;
    try {
      t.editor.setText(data.text);
      if (state) t.editor.setState(state);
      t.base = data.text;
      t.version = data.version;
      t.dirty = false;
      t.conflict = null;
    } finally {
      t.silent = false;
    }
    renderFrame();
  }
  async function checkExternal(t) {
    if (!tabs.includes(t)) return;
    if (!t.editor) {
      if (active === t && isReader(t.path)) await activate(t, true);
      return;
    }
    await bufferTask(t, async () => {
      if (!tabs.includes(t) || (t.pendingJournal && !files.has(t.path))) return;
      let data;
      try {
        data = await rpc('read', { path: t.path });
      } catch (e) {
        if (!files.has(t.path)) {
          stopTimers(t);
          t.conflict = { deleted: true, text: '', version: '' };
          if (t.dirty) await rpc('draft', { path: t.path, text: t.editor.getText(), version: t.version });
          renderStatus();
        }
        if (active === t) toast('无法读取原文件：' + t.path);
        return;
      }
      if (t.pendingJournal) {
        t.pendingJournal = null;
        mountReferences(t);
      }
      if (data.version === t.version) return;
      if (t.dirty && data.text !== t.editor.getText()) {
        t.conflict = data;
        stopTimers(t);
        await rpc('draft', { path: t.path, text: t.editor.getText(), version: t.version });
        renderStatus();
      } else updateText(t, data);
    });
  }
  function diffLines(left, right) {
    const a = left.split('\n'), b = right.split('\n');
    let first = 0, last = 0;
    while (first < a.length && first < b.length && a[first] === b[first]) first++;
    while (
      last < a.length - first && last < b.length - first &&
      a[a.length - 1 - last] === b[b.length - 1 - last]
    ) last++;
    const show = (arr) =>
      arr.slice(Math.max(0, first - 2), Math.min(arr.length, arr.length - last + 2)).map((line, i) => {
        const n = Math.max(0, first - 2) + i;
        return n >= first && n < arr.length - last
          ? '<span class="changed">' + esc(line || ' ') + '</span>'
          : esc(line);
      }).join('\n');
    return [show(a), show(b)];
  }
  async function conflictDialog(t) {
    if (!t.conflict || !t.editor) return;
    if (t.conflict.deleted) {
      const answer = await dialog('原文件已移出或删除', '<p>' + esc(t.path) + '</p>', [
        ['稍后处理','later'], ['在原位置新建','create'], ['另存当前编辑…','copy','primary']
      ]);
      if (answer?.id === 'copy') {
        const saved = await rpc('saveAs', {path:t.path,text:t.editor.getText()});
        if (!saved.cancelled) {
          await rpc('clearDraft', {path:t.path});
          await closeTab(t, {force:true,record:false});
          await refreshTree();
          if (saved.path) await openPath(saved.path);
        }
      } else if (answer?.id === 'create') {
        const text = t.editor.getText();
        const result = await rpc('newFile', {path:t.path,text});
        updateText(t, {text,version:result.version});
        await rpc('clearDraft', {path:t.path});
        await refreshTree();
      }
      return;
    }
    const theirs = t.conflict, mine = t.editor.getText(), [a, b] = diffLines(mine, theirs.text);
    const reply = await dialog(
      '比较文件版本',
      '<p>' + esc(t.path) + '</p><div class="diff-grid"><div>当前编辑<pre>' + a +
        '</pre></div><div>磁盘版本<pre>' + b +
        '</pre></div></div><label class="field">合并后的正文<textarea rows="9" name="merged">' + esc(mine) +
        '</textarea></label>',
      [['稍后', 'later'], ['另存当前编辑…', 'copy'], ['使用磁盘版本', 'disk'], [
        '保存合并结果',
        'merge',
        'primary',
      ]],
      null,
      true,
    );
    if (!reply) return;
    if (reply.id === 'copy') {
      await rpc('saveAs', { path: t.path, text: mine });
      return;
    }
    if (!['merge', 'disk'].includes(reply.id)) return;
    const fresh = await rpc('read', { path: t.path });
    if (fresh.version !== theirs.version) {
      t.conflict = fresh;
      toast('磁盘文件再次发生变化，请重新比较。');
      return;
    }
    if (reply.id === 'disk') {
      updateText(t, fresh);
      await rpc('clearDraft', { path: t.path });
      return;
    }
    t.version = fresh.version;
    t.base = fresh.text;
    t.conflict = null;
    t.silent = true;
    try {
      t.editor.setText(reply.fields.merged);
    } finally {
      t.silent = false;
    }
    onEdit(t);
    await saveTab(t);
  }
  async function recoveryDialog() {
    const records = await rpc('recovery');
    if (!records?.length) return;
    for (const d of records) {
      let current;
      try {
        current = await rpc('read', { path: d.path });
      } catch {}
      if (current?.text === d.text) {
        await rpc('clearDraft', { path: d.path });
        continue;
      }
      const a = await dialog(
        '检测到未完成的编辑',
        '<p>' + esc(d.path) + '</p><div class="diff-grid"><div>恢复副本<pre>' + esc(d.text.slice(0, 1600)) +
          '</pre></div><div>磁盘版本<pre>' + esc(current?.text.slice(0, 1600) || '文件已移出原位置') +
          '</pre></div></div>',
        [['稍后', 'later'], ['丢弃恢复副本', 'discard'], [
          current ? '恢复到编辑器' : '另存恢复副本…',
          'restore',
          'primary',
        ]],
        null,
        true,
      );
      if (!a || a.id === 'later') continue;
      if (a.id === 'discard') {
        await rpc('clearDraft', { path: d.path });
        continue;
      }
      if (!current) {
        const out = await rpc('saveAs', { path: d.path, text: d.text });
        if (!out.cancelled) await rpc('clearDraft', { path: d.path });
        continue;
      }
      const t = await doOpen(d.path, { history: false });
      t.silent = true;
      try {
        t.editor.setText(d.text);
      } finally {
        t.silent = false;
      }
      if (current.version !== d.version) {
        t.version = d.version;
        t.conflict = current;
      }
      onEdit(t);
    }
  }
  async function flushBuffers() {
    if (readerPath && active?.path === readerPath) active.state = await rpc('readerState');
    for (const t of [...tabs]) {
      if (!t.editor) continue;
      if (t.dirty) {
        await writeDraft(t);
        await saveTab(t);
      }
      await t.work;
    }
    await persist();
  }
  async function prepareClose() {
    try {
      await navigation;
      await flushBuffers();
      return true;
    } catch (e) {
      failure(e);
      return false;
    }
  }
  async function chooseWorkspace(method, args = {}) {
    if (!await prepareClose()) return;
    const res = await rpc(method, args);
    if (res && !res.cancelled) await loadWorkspace(res);
  }
  async function loadWorkspace(data) {
    restoring = true;
    generation++;
    ++searchRequest;
    clearTimeout(sessionTimer);
    clearTimeout(searchTimer);
    clearTimeout(externalTimer);
    clearTimeout(treeRefreshTimer);
    pendingExternal.clear();
    dismissPopup();
    await releaseReader();
    active = null;
    for (const t of [...tabs]) await disposeTab(t);
    root = data.root || null;
    configuredJournalFolder = data.journalFolder ?? null;
    tree = [];
    directoryStyleByName.clear();
    files.clear();
    folders.clear();
    expanded.clear();
    closed.length = previous.length = next.length = 0;
    groups = [];
    const s = data.session || {};
    documentViews.clear();
    for (const [path, view] of s.documentViews || []) documentViews.set(path, view);
    journalRows = [];
    journalMonth = monthOf(localDay(new Date()));
    mode = ['search','journals'].includes(s.mode) ? s.mode : 'tree';
    outlineHidden = !!s.outlineHidden;
    search = Object.assign(defaultSearch(), s.search);
    selectedPath = s.selectedPath || '';
    treeScroll = s.treeScroll || 0;
    sidebarWidth = Math.max(190, Math.min(520, s.sidebarWidth || 292));
    sidebarHidden = !!s.sidebarHidden;
    (s.expanded || []).forEach((p) => expanded.add(p));
    $('workspaceName').textContent = root ? nameOf(root) : 'SimaQ';
    $('libraryMenu').title = root || '打开工作区';
    setLayout();
    try {
      recents = await rpc('recentRoots') || [];
      if (root) {
        await refreshTree();
        for (const item of s.tabs || []) {
          if (item?.path && files.has(item.path) && supported(item.path)) {
            tabs.push(tabRecord(item.path, item));
          }
        }
        const first = tabs.find((t) => t.path === s.active) || tabs[0];
        if (first) await doOpen(first.path, { history: false });
        if (!s.expanded && !s.tabs) {
          for (const n of tree.filter((n) => n.dir).slice(0, 2)) expanded.add(n.path);
        }
      }
      renderFrame();
      renderSide();
      if (root && mode === 'search') scheduleSearch(true);
      if (root) await recoveryDialog();
    } finally {
      restoring = false;
      persistSoon();
      window.SimaSettings?.refreshCommands?.();
    }
  }
  async function followLink(t, link, opts = {}) {
    if (typeof link === 'object') {
      opts = link;
      link = opts.href || opts.link || opts.target;
    }
    if (typeof link !== 'string') return;
    const newTab = typeof opts === 'boolean' ? opts : !!(opts?.newTab || opts?.metaKey || opts?.ctrlKey);
    if (/^(https?:\/\/|mailto:)/i.test(link)) return rpc('openExternal', { url: link });
    const result = await rpc('resolveLink', { path: t.path, link, wiki: !!opts?.wiki });
    let target = result.path;
    if (!target && result.candidates?.length) {
      target = (await choiceList(
        '选择链接目标',
        result.candidates.map((p) => ({ label: nameOf(p), detail: p, path: p })),
      ))?.item.path;
    }
    if (!target) {
      if (!result.external) toast('找不到链接目标：' + link);
      return;
    }
    return openLinked(target, result.fragment, newTab);
  }
  function openLinked(path, fragment, newTab) {
    return serialize(() => doOpen(path, {
      fragment, newTab:newTab || !!active?.dirty, permanent:newTab,
    }));
  }
  function selectedEditorText(t) {
    const st = t.editor.getState();
    const s = st.selection?.ranges?.[0] || st.selection || st;
    const a = s.anchor ?? s.from, b = s.head ?? s.to ?? a;
    return Number.isInteger(a) && Number.isInteger(b)
      ? t.editor.getText().slice(Math.min(a, b), Math.max(a, b))
      : '';
  }
  async function findFiles(source = '') {
    const list = await rpc('files');
    return list.filter((x) => supported(x.path)).sort((a, b) =>
      Number(parentOf(b.path) === parentOf(source)) - Number(parentOf(a.path) === parentOf(source)) ||
      a.path.localeCompare(b.path, 'zh-CN', { numeric: true })
    ).map((f) => ({
      label: f.title && f.title !== stem(f.path) ? f.title : nameOf(f.path),
      detail: f.path,
      path: f.path,
      extra: f.name,
    }));
  }
  async function insertLink() {
    const t = active;
    if (!t?.editor) return;
    const list = await findFiles(t.path);
    const choice = await choiceList('插入文档链接', list, {
      action: '插入链接',
      placeholder: '搜索文件名、相对路径或文档标题',
      html: field('链接文字（留空使用文档标题）', 'label', selectedEditorText(t)) +
        field('标题锚点或 PDF 页码（可选）', 'fragment', '', 'placeholder="标题，或 page=12"') +
        '<label class="field">链接格式<select name="format"><option value="markdown">Markdown 相对链接</option><option value="wiki">双链 [[文档|别名]]</option></select></label>',
    });
    if (!choice) return;
    const { item, fields } = choice,
      to = item.path,
      label = fields.label || item.label,
      fragment = fields.fragment.trim().replace(/^#/, '');
    const dest = (await rpc('relativeLink', { path: t.path, to })).link;
    let text;
    if (fields.format === 'wiki') {
      let wikiPath = to.replace(/\.(md|markdown|mdown|mkd)$/i, '');
      if (parentOf(t.path) === parentOf(to)) wikiPath = stem(to);
      else wikiPath = decodeURIComponent(dest).replace(/\.(md|markdown|mdown|mkd)$/i, '');
      text = '[[' + wikiPath + (fragment ? '#' + fragment : '') + '|' + label + ']]';
    } else {
      const href = (fragment && to === t.path ? '' : dest) +
        (fragment ? '#' + encodeURIComponent(fragment).replace(/%3D/gi, '=') : '');
      text = '[' + label.replace(/([\\\[\]])/g, '\\$1') + '](' +
        href.replaceAll('(', '%28').replaceAll(')', '%29') + ')';
    }
    t.editor.focus();
    t.editor.action('insertText', text);
  }
  async function backlinks(path = active?.path) {
    if (!path) return;
    const rows = await rpc('backlinks', { path });
    if (!rows.length) {
      await dialog('反向链接', '<p>资料库中没有引用 ' + esc(nameOf(path)) + ' 的 Markdown 文档。</p>', [[
        '关闭',
        'ok',
        'primary',
      ]]);
      return;
    }
    const choice = await choiceList(
      '引用“' + nameOf(path) + '”的文档',
      rows.map((r) => ({
        label: r.text || nameOf(r.path),
        detail: r.path + ' · 第 ' + r.line + ' 行',
        path: r.path,
        line: r.line,
      })),
    );
    if (choice) await openPath(choice.item.path, { line: choice.item.line });
  }
  async function fixLinks() {
    const broken = await rpc('dangling');
    if (!broken.length) {
      toast('没有发现失效链接。');
      return;
    }
    const choice = await choiceList(
      '修复失效链接',
      broken.map((r) => ({
        label: r.link,
        detail: r.path + ' · 第 ' + r.line + ' 行',
        path: r.path,
        row: r,
      })),
      { action: '选择目标' },
    );
    if (!choice) return;
    const r = choice.item.row;
    const all = await findFiles(r.path);
    const proposed = new Set(r.candidates);
    all.sort((a, b) => Number(proposed.has(b.path)) - Number(proposed.has(a.path)));
    const target = await choiceList('为“' + r.link + '”选择新目标', all, { action: '修复链接' });
    if (!target) return;
    const t = tabs.find((t) => t.path === r.path);
    if (t?.dirty && !await saveTab(t)) return conflictDialog(t);
    const out = await rpc('repair', { path: r.path, id: r.id, to: target.item.path, version: r.version });
    if (out.conflict) {
      toast('文件已变化，请重新选择待修复链接。');
      return;
    }
    if (t) await checkExternal(t);
    toast('已更新 ' + r.path + ' 中的链接。');
  }
  function currentFolder() {
    return folders.has(selectedPath) ? selectedPath : parentOf(selectedPath || active?.path);
  }
  async function createFile(dir = currentFolder(), folder = false) {
    if (!root) {
      await chooseWorkspace('chooseRoot');
      if (!root) return;
    }
    const v = await promptText(
      folder ? '新建文件夹' : '新建笔记',
      folder ? '文件夹名称' : '笔记名称',
      folder ? '未命名文件夹' : '未命名笔记.md',
    );
    if (!v) return;
    if (/[\/\x00]/.test(v) || ['.', '..'].includes(v)) throw Error('请输入文件名，不含路径分隔符。');
    const path = join(dir, folder || /\.md$/i.test(v) ? v : v + '.md');
    await rpc(folder ? 'newFolder' : 'newFile', { path });
    await refreshTree();
    if (folder) {
      expanded.add(path);
      revealTreePath(path);
    } else await openPath(path, { focus: true, permanent: true });
  }
  async function chooseJournalFolder() {
    if (!root) return;
    const g = generation, expectedRoot = root, current = journalFolder();
    const tr = window.SimaSettings.menuText;
    const paths = [...new Set([current, '', ...folders].filter(path => path !== null))];
    const choices = paths.map(path => ({path, label:path ? nameOf(path) : tr('工作区根目录'), detail:path || root, icon:'folder'}));
    const display = configuredJournalFolder ?? current;
    const picked = await choiceList(tr('日记目录…'), choices, {
      action:tr('使用此目录'), placeholder:tr('搜索目录'),
      html:'<p>' + esc(tr('当前日记目录')) + ' · ' + esc(display === null ? tr('未设置') : display || root) + '</p>',
    });
    if (!picked || g !== generation || picked.item.path === configuredJournalFolder) return;
    await serialize(async () => {
      const folder = picked.item.path;
      ++journalOpenRequest;
      if (current !== folder) {
        for (const tab of [...tabs].filter(t => t.pendingJournal)) {
          if (tab.dirty && !await saveTab(tab)) return conflictDialog(tab);
          if (tab.pendingJournal && !await closeTab(tab, {record:false})) return;
        }
      }
      await rpc('setJournalFolder',{root:expectedRoot,folder});
      if (g !== generation) return;
      configuredJournalFolder = folder;
      journalRows = [];
      ++journalRequest;
      ++journalOpenRequest;
      for (const history of [previous,next]) {
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].journalDay && parentOf(history[i].path) !== folder) history.splice(i,1);
        }
      }
      updateNav();
      await refreshTree();
      renderSide();
    });
  }
  async function chooseMoveFolder(path) {
    const choices = ['', ...[...folders].filter((f) => !atOrUnder(f, path))].map((f) => ({
      label: f ? nameOf(f) : nameOf(root),
      path: f,
      detail: f || '资料库根目录',
      icon: 'folder',
    }));
    const a = await choiceList('选择目标目录', choices, { action: '继续', placeholder: '搜索目录' });
    if (a && a.item.path !== parentOf(path)) await moveFile(path, join(a.item.path, nameOf(path)));
  }
  function treeMenu(point, path, isDir) {
    menu(point, [
      isDir && ['新建笔记…', () => createFile(path), 'filePlus'],
      isDir && ['新建文件夹…', () => createFile(path, true), 'folder'],
      !isDir && supported(path) && ['打开文档', () => openPath(path, { newTab:false, permanent:true }), 'doc'],
      !isDir && supported(path) && ['在新标签页中打开', () => openPath(path, { newTab:true, permanent:true }), 'doc'],
      !!path && ['重命名…', async () => {
        const v = await promptText('重命名', '新名称', nameOf(path));
        if (v && v !== nameOf(path)) {
          if (v.includes('/')) throw Error('名称不能包含路径分隔符。');
          await moveFile(path, join(parentOf(path), v));
        }
      }, 'edit'],
      !!path && ['移动到…', () => chooseMoveFolder(path), 'folderOpen'],
      !!path && ['在 Finder 中显示', () => rpc('reveal', { path }), 'external'],
      !!path && ['复制相对路径', () => rpc('copyText', { text: path }), 'copy'],
      !!path && ['移入废纸篓…', () => trashPath(path), 'trash'],
      null,
      ['检查失效链接…', fixLinks, 'link'],
      ['重建搜索索引', async () => {
        await rpc('rebuildIndex');
        toast('已开始重建搜索索引。');
      }, 'restore'],
    ]);
  }
  async function saveBeforeMutation() {
    for (const t of tabs) {
      if (t.dirty && !await saveTab(t)) {
        await activate(t);
        await conflictDialog(t);
        if (t.conflict || t.dirty) throw Error('请先处理当前文件的版本冲突。');
      }
    }
  }
  async function moveFile(path, to) {
    if (path === to) return;
    await saveBeforeMutation();
    let choices = {}, plan = await rpc('move', { path, to, choices });
    for (const ambiguity of plan.ambiguous || []) {
      const m = await choiceList(
        '确认同名链接的目标',
        ambiguity.candidates.map((p) => ({ label: nameOf(p), detail: p, path: p })),
        { action: '确认', html: '<p>' + esc(ambiguity.path) + ' · ' + esc(ambiguity.link) + '</p>' },
      );
      if (!m) return;
      choices[ambiguity.id] = m.item.path;
    }
    if (Object.keys(choices).length) plan = await rpc('move', { path, to, choices });
    const changes = plan.changes || [];
    const body = '<p>' + esc(path) + ' → ' + esc(to) + '</p><p>' +
      esc(
        changes.length ? '受影响的链接共 ' + changes.length + ' 处。' : '没有需要更新的 Markdown 链接。',
      ) + '</p>' +
      (plan.metadata || []).map(c => '<details open><summary>' + esc(window.SimaSettings.menuText('目标目录元数据')) + '</summary><pre>'+esc(c.before || '∅')+' →\n'+esc(c.after || '∅')+'</pre></details>').join('') +
      changes.map((c) =>
        '<div class="link-change">' + esc(c.path) + ' · 第 ' + esc(c.line || '') + ' 行<code>' +
        esc(c.before) + ' → ' + esc(c.after) + '</code></div>'
      ).join('');
    const a = await dialog('预览移动与链接更新', body, [
      ['取消', 'cancel'],
      ...(changes.length ? [['仅移动文件', 'move']] : []),
      [changes.length ? '移动并更新链接' : '确认移动', 'update', 'primary'],
    ]);
    if (!a || a.id === 'cancel') return;
    if (a.id === 'move') {
      const plain = await rpc('move',{path,to,choices,updateLinks:false});
      if (JSON.stringify(plain.metadata) !== JSON.stringify(plan.metadata)) throw Error('元数据已变化，请重新预览。');
      plan = plain;
    }
    const out = await rpc('move', {
      path,
      to,
      choices,
      commit: true,
      updateLinks: a.id === 'update',
      token: plan.token,
    });
    if (!out.committed) throw Error('移动未完成，文件或链接已发生变化。');
    const map = (p) => atOrUnder(p, path) ? to + p.slice(path.length) : p;
    const affected = tabs.filter((t) => atOrUnder(t.path, path));
    for (const t of affected) {
      if (t === active && readerPath) await releaseReader();
      t.path = map(t.path);
      if (t.editor) {
        const st = t.editor.getState();
        t.referenceObserver?.disconnect();
        t.editor.destroy();
        t.host.remove();
        t.editor = null;
        t.host = null;
        t.state = st;
        await createEditor(t);
        if (t === active) t.host.hidden = false;
      }
    }
    for (const [oldPath, view] of [...documentViews]) {
      if (atOrUnder(oldPath,path)) {
        documentViews.delete(oldPath);
        documentViews.set(map(oldPath),view);
      }
    }
    for (const item of closed) item.path = map(item.path);
    for (const entry of [...previous, ...next]) if (entry.path) entry.path = map(entry.path);
    const dirs = [...expanded].map(map);
    expanded.clear();
    dirs.forEach((p) => expanded.add(p));
    selectedPath = to;
    await refreshTree();
    for (
      const t of tabs.filter((t) =>
        !affected.includes(t) && changes.some((c) => c.targetPath === t.path || c.path === t.path)
      )
    ) await checkExternal(t);
    await activate(active);
    revealTreePath(to);
    toast('已移动到 ' + to);
  }
  async function trashPath(path) {
    const tr = window.SimaSettings.menuText;
    const reply = await dialog(tr('移入废纸篓？'), '<p>' + esc(path) + '</p>', [[tr('取消'), 'cancel'], [
      tr('移入废纸篓'),
      'trash',
      'danger',
    ]]);
    if (reply?.id !== 'trash') return;
    const affected = tabs.filter((t) => atOrUnder(t.path, path));
    for (const t of affected) {
      if (t.dirty && !await saveTab(t)) {
        await conflictDialog(t);
        if (t.dirty) return;
      }
    }
    await rpc('trash', { path });
    for (const history of [previous, next, closed]) {
      for (let i = history.length - 1; i >= 0; --i) {
        if (history[i].path && atOrUnder(history[i].path, path)) history.splice(i, 1);
      }
    }
    updateNav();
    for (const t of affected) await closeTab(t, { record: false, force: true });
    await refreshTree();
    renderSide();
  }
  async function trustReport() {
    const t = active;
    if (!t || !/^html?$/.test(extOf(t.path))) return;
    const trusted = await rpc('readerTrusted', { path: t.path });
    const a = await dialog(
      trusted ? '撤销本报告的脚本信任？' : '允许本地报告运行脚本？',
      '<p>' + esc(t.path) + '</p><p>' +
        (trusted
          ? '重新载入后，报告内脚本将停用。'
          : '仅对当前文件版本生效。文件内容更改后需要重新授权。') +
        '</p>',
      [['取消', 'cancel'], [trusted ? '撤销信任' : '信任此版本', 'apply', 'primary']],
    );
    if (a?.id !== 'apply') return;
    await rpc('readerTrust', { path: t.path, trusted: !trusted });
    await activate(t, true);
  }
  function docMenu(point) {
    const t = active;
    if (!t) return;
    menu(point, [
      [t.pinned ? '取消固定标签' : '固定标签', () => {
        t.pinned = !t.pinned;
        t.preview = false;
        renderTabs();
        persistSoon();
      }, 'pin'],
      !t.pendingJournal && ['移动到…', () => chooseMoveFolder(t.path), 'folderOpen'],
      t.editor && isMd(t.path) && ['发布到微信公众号…', () => execute('file.wechatDraft'), 'external'],
      ['查找当前文档', () => openSearch('document'), 'search', '⌘F'],
      !t.pendingJournal && ['查看反向链接…', () => backlinks(t.path), 'link'],
      !t.pendingJournal && ['复制相对路径', () => rpc('copyText', { text: t.path }), 'copy'],
      !t.pendingJournal && ['在 Finder 中显示', () => rpc('reveal', { path: t.path }), 'external'],
      /^html?$/.test(extOf(t.path)) && ['管理本地脚本信任…', trustReport, 'shield'],
      isReader(t.path) && ['复制当前位置引用', () => readerAction('copyReference'), 'link'],
      null,
      ['关闭标签', () => serialize(() => closeTab(t)), 'close', '⌘W'],
    ]);
  }
  function execute(id, arg) {
    if (window.SimaSettings?.commands?.some((c) => c.id === id)) {
      return window.SimaSettings.execute(id, arg);
    }
    return run(id, arg);
  }
  async function run(id, arg) {
    const t = active;
    if (id === 'file.openFolder') return chooseWorkspace('chooseRoot');
    if (id === 'file.journalFolder') return chooseJournalFolder();
    if (id === 'file.sample') return chooseWorkspace('sampleRoot');
    if (id === 'file.new') return createFile();
    if (id === 'search.workspace' || id === 'edit.find') {
      return openSearch(id === 'edit.find' ? 'document' : 'all');
    }
    if (id === 'view.sidebar') {
      sidebarHidden = !sidebarHidden;
      setLayout();
      persistSoon();
      return;
    }
    if (id === 'view.outline') {
      if (!active?.editor) return;
      outlineHidden = !outlineHidden;
      scheduleOutline(true);
      persistSoon();
      return;
    }
    if (id === 'tree.collapse') {
      expanded.clear();
      treeScroll = 0;
      renderSide();
      persistSoon();
      return;
    }
    if (id === 'navigate.back' || id === 'navigate.forward') {
      return serialize(() => travel(id.endsWith('forward')));
    }
    if (id === 'file.closeTab') return serialize(() => closeTab());
    if (id === 'file.reopenTab') {
      const c = closed.pop();
      if (c) return openPath(c.path, { ...c, permanent: true });
      return;
    }
    if (id === 'file.save') {
      if (t?.conflict) return conflictDialog(t);
      if (t && !await saveTab(t)) await conflictDialog(t);
      return;
    }
    if (id === 'file.wechatDraft') {
      if (!t?.editor || !isMd(t.path)) return;
      const article = window.SimaWeChatArticle.format(t.editor.getText(), t.path);
      return rpc('wechatDraft', {
        title: article.title, html: article.html, plainText: article.plainText, missingImageCount: article.missingImages.length,
      });
    }
    if (id === 'file.saveAs' && t?.editor) {
      const a = await rpc('saveAs', { path: t.path, text: t.editor.getText() });
      if (a.path && a.path !== t.path) {
        await refreshTree();
        await openPath(a.path, { permanent: true });
      }
      return;
    }
    if (id === 'template.create' && arg) {
      await rpc('newFile', { path: arg.path, text: arg.text });
      await refreshTree();
      const tab = await openPath(arg.path, { permanent: true, focus: true });
      tab?.editor?.locate(arg.cursor, 0);
      return;
    }
    if (id === 'template.insert' && arg && t?.editor) {
      t.editor.focus();
      return t.editor.action('insertText', arg);
    }
    if (id === 'edit.link') return insertLink();
    if (id === 'navigate.backlinks') return backlinks();
    if (id === 'navigate.repair') return fixLinks();
    if (['file.print', 'file.exportHTML', 'file.exportPDF'].includes(id) && t) {
      if (!t.editor && id === 'file.print') return readerAction('print');
      if (!t.editor) {
        toast('请在 Markdown 笔记中导出文档。');
        return;
      }
      return rpc(id.split('.')[1], { path: t.path, html: await t.editor.html() });
    }
    if (id === 'app.settings') return window.SimaSettings.open();
    if (id === 'app.palette') return window.SimaSettings.palette();
    if (id.startsWith('theme.')) return window.SimaSettings.execute(id);
    if (['app.quit', 'window.minimize', 'window.zoom', 'help.guide'].includes(id)) {
      return rpc(
        {
          'app.quit': 'quit',
          'window.minimize': 'minimize',
          'window.zoom': 'zoom',
          'help.guide': 'help',
        }[id],
      );
    }
    if (t?.editor) {
      if (id === 'edit.undo' || id === 'edit.redo') {
        const field = document.activeElement;
        if (field?.matches('input,textarea,[contenteditable=true]') && !t.host.contains(field)) {
          return document.execCommand(id.slice(5));
        }
      }
      t.editor.focus();
      return t.editor.action(id, arg);
    }
  }
  function filesChanged(paths) {
    for (const path of paths || []) pendingExternal.add(path);
    clearTimeout(externalTimer);
    externalTimer = setTimeout(() =>
      call(async () => {
        const which = new Set(pendingExternal);
        pendingExternal.clear();
        await refreshTree();
        for (const t of [...tabs]) if (which.has(t.path) || !which.size) await checkExternal(t);
        if (mode === 'search') scheduleSearch();
      }), 165);
  }
  async function event(name, data = {}) {
    if (name === 'imageMenuAction') {
      const context = pendingImageMenu;
      if (context?.token !== data.token) return;
      pendingImageMenu = null;
      if (context.tab === active && context.image.isConnected) call(context.items[data.index]?.[1]);
      return;
    }
    if (name === 'workspaceOpened') return loadWorkspace(data);
    if (name === 'openPath') {
      return data.newTab === undefined
        ? openPath(data.path, { fragment: data.fragment, permanent: true })
        : openLinked(data.path, data.fragment, data.newTab);
    }
    if (name === 'filesChanged') return filesChanged(data.paths);
    if (name === 'command') return execute(data.id, data.arg);
    if (name === 'readerPosition' && active?.path === readerPath && data.path === readerPath) {
      active.state = data.state || data;
      persistSoon();
      return;
    }
    if (name === 'systemLanguageChanged') return window.SimaSettings?.refreshMenuLanguage();
    if (name === 'themesChanged') return window.SimaSettings?.reloadThemes();
    if (name === 'indexReady' || name === 'referencesChanged') {
      for (const t of tabs) t.refreshReferences?.();
      if (mode === 'search' && search.q) scheduleSearch();
    }
    if (name === 'closing') return prepareClose();
  }
  function keydown(e) {
    if (e.isComposing || e.keyCode === 229) return;
    if (popup) {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismissPopup();
        return;
      }
      const box = popup.layer.querySelector('.sq-menu,.sq-dialog');
      if (!box) return;
      if (box.matches('.sq-menu') && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        const btns = [...box.querySelectorAll('button:not(:disabled)')],
          i = btns.indexOf(document.activeElement);
        btns[
          e.key === 'Home'
            ? 0
            : e.key === 'End'
            ? btns.length - 1
            : (i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length
        ]?.focus();
        return;
      }
      if (
        box.matches('.sq-dialog') && e.key === 'Enter' && e.target.tagName === 'INPUT' &&
        e.target.type !== 'checkbox'
      ) {
        e.preventDefault();
        box.querySelector('[data-answer].primary:not(:disabled)')?.click();
        return;
      }
      if (e.key === 'Tab') {
        const tabStops = [...box.querySelectorAll('button:not(:disabled),input,textarea,select')].filter(
          (el) => el.getClientRects().length,
        );
        if (e.shiftKey && e.target === tabStops[0]) {
          e.preventDefault();
          tabStops.at(-1)?.focus();
        } else if (!e.shiftKey && e.target === tabStops.at(-1)) {
          e.preventDefault();
          tabStops[0]?.focus();
        }
      }
      return;
    }
    if (document.querySelector('.sq-backdrop')) return;
    if (e.key === 'Escape' && mode === 'search') {
      e.preventDefault();
      activateSide('tree');
      return;
    }
    if (
      e.target.closest('#sideScroll') && mode === 'tree' &&
      ['ArrowUp', 'ArrowDown', 'ArrowRight', 'ArrowLeft'].includes(e.key)
    ) {
      const rows = [...$('sideScroll').querySelectorAll('.tree-row')],
        i = rows.indexOf(e.target),
        n = rows[i];
      if (!n) return;
      e.preventDefault();
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const expand = e.key === 'ArrowRight';
        if (folders.has(n.dataset.path) && expanded.has(n.dataset.path) !== expand) {
          n.click();
          [...$('sideScroll').querySelectorAll('[data-path]')].find((b) => b.dataset.path === n.dataset.path)?.focus();
        } else if (!expand) rows.find((r) => r.dataset.path === parentOf(n.dataset.path))?.focus();
        else rows[i + 1]?.focus();
      } else rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus();
      return;
    }
    window.SimaSettings?.handleKey(e);
  }
  async function start() {
    if (started) return;
    started = true;
    markElements();
    document.addEventListener('sima:menu-language',()=>{
      if (mode === 'journals') renderSide();
      for (const node of document.querySelectorAll('[data-menu-text]')) {
        node.textContent = window.SimaSettings.menuText(node.dataset.menuText);
      }
      for (const node of document.querySelectorAll('[data-menu-title]')) {
        node.title = window.SimaSettings.menuText(node.dataset.menuTitle);
        node.setAttribute('aria-label',node.title);
      }
    });
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-run],[data-mode],[data-recent]');
      if (!btn) return;
      if (btn.dataset.run) call(() => execute(btn.dataset.run));
      else if (btn.dataset.recent) call(() => chooseWorkspace('openRecent', { path: btn.dataset.recent }));
      else if (btn.dataset.mode === 'search') call(() => openSearch('all'));
      else if (btn.dataset.mode === 'journals') call(() => openDay(localDay(new Date()),e.metaKey));
      else activateSide(btn.dataset.mode);
    });
    $('hosts').addEventListener('scroll',e=>{
      if (e.target.classList?.contains('sima-editor') && active?.host?.contains(e.target)) scheduleOutline();
    },{capture:true,passive:true});
    $('outlineList').onclick=e=>{
      const button=e.target.closest('.outline-row');
      if (!button || outlineTab!==active) return;
      const item=outlineRows[Array.prototype.indexOf.call(button.parentNode.children,button)];
      if (item) { pushHistory();active.editor.goToHeading(item.start);persistSoon(); }
    };
    document.addEventListener('keydown', keydown);
    window.addEventListener('resize', reposition);
    new ResizeObserver(reposition).observe($('stage'));
    $('libraryMenu').onclick = (e) =>
      menu(e.currentTarget, [
        ['打开文件夹…', () => chooseWorkspace('chooseRoot'), 'folderOpen', '⌘O'],
        ['打开示例资料库', () => chooseWorkspace('sampleRoot'), 'book'],
        ...(recents.length
          ? [
            null,
            ...recents.slice(0, 9).map((
              p,
            ) => [nameOf(p) + '  ·  ' + p, () => chooseWorkspace('openRecent', { path: p }), 'clock']),
          ]
          : []),
      ]);
    $('newMenu').onclick = (e) =>
      menu(e.currentTarget, [
        ['新建笔记…', () => run('file.new'), 'filePlus', '⌘N'],
        ['从模板新建…', () => execute('template.create'), 'doc'],
        [
          '打开文件夹…',
          () => chooseWorkspace('chooseRoot'),
          'folderOpen',
          '⌘O',
        ],
        closed.length > 0 && ['重新打开关闭的标签', () => run('file.reopenTab'), 'restore'],
      ]);
    $('documentMenu').onclick = (e) => docMenu(e.currentTarget);
    $('viewButton').onclick = (e) =>
      menu(e.currentTarget, [
        active?.editor && isMd(active.path) && ['文档大纲', () => run('view.outline'), 'outline'],
        active?.editor && isMd(active.path) && ['切换源码模式', () => run('view.source'), 'terminal', '⌘/'],
        active?.editor && isMd(active.path) && ['折叠或展开元数据', () => run('view.yaml')],
        active?.editor && isMd(active.path) && ['专注模式', () => run('view.focus')],
        active?.editor && isMd(active.path) && ['打字机模式', () => run('view.typewriter')],
        null,
        ['外观设置…', () => window.SimaSettings.open('appearance'), 'settings'],
      ]);
    const splitter = $('splitter');
    splitter.onpointerdown = (e) => {
      e.preventDefault();
      splitter.setPointerCapture(e.pointerId);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      splitter.onpointermove = (e) => {
        sidebarWidth = Math.max(185, Math.min(innerWidth - 260, 560, e.clientX));
        setLayout();
      };
      splitter.onpointerup = () => {
        splitter.onpointermove = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        persistSoon();
      };
    };
    splitter.onkeydown = (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        sidebarWidth = Math.max(
          185,
          Math.min(innerWidth - 260, 560, sidebarWidth + (e.key === 'ArrowLeft' ? -12 : 12)),
        );
        setLayout();
        persistSoon();
      }
    };
    await window.SimaSettings?.init({
      rpc,
      run,
      editor: () => active?.editor,
      context: () => ({
        path: active?.path || '',
        root,
        hasEditor: !!active?.editor,
        markdown: !!active && isMd(active.path),
        canBack: !!previous.length,
        canForward: !!next.length,
        canReopen: !!closed.length,
      }),
      refreshExclusions: async () => {
        await refreshTree();
        if (mode === 'search') { groups = []; scheduleSearch(true); }
      },
      refreshImages: () => tabs.forEach(t => t.editor?.refreshImages()),
      toast,
    });
    await loadWorkspace(await rpc('bootstrap'));
  }
  window.SimaShell = { start, event, run, prepareClose, overlay };
})();

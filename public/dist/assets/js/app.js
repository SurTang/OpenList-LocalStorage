/* 应用主逻辑：路由、登录、首页、文件浏览、预览、上传、分享 */
(function () {
  'use strict';

  const { api, store, fmt, icon, toast, Modal, confirmDialog, abs, setToken, remember, mapError, localSettings, qrcodeUrl } = App;

  const S = {
    initialized: true,
    guestMode: false,
    settings: {},
    user: null,
    hasToken: false,
  };

  let renderToken = 0;

  /* ------------------------------------------------------------------ *
   * 基础工具
   * ------------------------------------------------------------------ */
  function cssVar(name, value) { document.documentElement.style.setProperty(name, value); }

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec((hex || '').trim());
    if (!m) return '37, 99, 235';
    return [1, 2, 3].map((i) => parseInt(m[i], 16)).join(', ');
  }

  function applyTheme() {
    const c = S.settings.main_color || '#2563eb';
    cssVar('--brand', c);
    cssVar('--brand-rgb', hexToRgb(c));
  }

  function siteTitle() { return S.settings.site_title || '文件服务器'; }
  function isAdmin() { return !!(S.user && S.user.role === 2); }
  function isGuest() { return !S.user || S.user.role === 1; }

  function boolSetting(key, def) {
    const v = S.settings[key];
    if (v === undefined || v === null || v === '') return !!def;
    return String(v) === 'true' || String(v) === '1';
  }

  function iconOrImage(value, cls) {
    if (!value) return icon('i-home', cls);
    if (/^(https?:)?\//.test(value) || value.startsWith('data:')) {
      return '<img class="ico ' + (cls || '') + '" src="' + fmt.esc(abs(value)) + '" alt="">';
    }
    return '<span class="' + (cls || '') + '">' + fmt.esc(value) + '</span>';
  }

  function brandMark() {
    const logo = S.settings.logo || '';
    return '<img class="brand-logo" src="' + fmt.esc(abs(logo || '/assets/images/logo.svg')) + '" alt="' + fmt.esc(siteTitle()) + '">';
  }

  function errText(e) { return mapError(e && e.message ? e.message : e); }
  function toastErr(e) { toast(errText(e), 'err'); }

  function joinPath(dir, name) {
    const d = dir === '/' ? '' : (dir.endsWith('/') ? dir.slice(0, -1) : dir);
    return d + '/' + name;
  }

  function parentOf(path) {
    const i = path.lastIndexOf('/');
    return i <= 0 ? '/' : path.slice(0, i);
  }

  function baseName(path) {
    return path.split('/').filter(Boolean).pop() || '/';
  }

  function ext(name) {
    const i = String(name || '').lastIndexOf('.');
    return i > 0 ? name.slice(i + 1).toLowerCase() : '';
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); resolve(); } catch (e) { reject(e); }
      ta.remove();
    });
  }

  /* ------------------------------------------------------------------ *
   * 路由
   * ------------------------------------------------------------------ */
  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [pathPart, queryPart] = raw.split('?');
    const segs = pathPart.split('/').filter(Boolean);
    const query = {};
    (queryPart || '').split('&').filter(Boolean).forEach((kv) => {
      const [k, v] = kv.split('=');
      query[decodeURIComponent(k)] = decodeURIComponent(v || '');
    });
    return { segs, query, path: pathPart };
  }

  function go(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function shareFromPath() {
    const m = /\/@s\/([^/]+)(\/.*)?$/.exec(location.pathname);
    if (!m) return null;
    return { id: decodeURIComponent(m[1]), sub: m[2] ? decodeURIComponent(m[2]) : '' };
  }

  /* ------------------------------------------------------------------ *
   * 启动
   * ------------------------------------------------------------------ */
  async function loadSettings() {
    try {
      S.settings = (await api('api/public/settings')) || {};
    } catch (e) { S.settings = {}; }
    applyTheme();
    document.title = siteTitle();
    const fav = document.getElementById('site-favicon');
    if (fav && S.settings.favicon) fav.href = abs(S.settings.favicon);
  }

  async function checkInit() {
    try {
      const r = await api('api/public/init_status');
      S.initialized = !!(r && r.initialized);
    } catch (e) { S.initialized = true; }
  }

  async function loadMe() {
    const hadToken = !!store.token;
    S.hasToken = hadToken;
    try {
      S.user = await api('api/me');
      S.guestMode = !S.hasToken && S.user && S.user.role === 1;
      return S.user;
    } catch (e) {
      S.user = null;
      S.guestMode = false;
      // token 已失效（账号被停用 / 改过密码 / 过期）：api() 会清掉本地 token，
      // 这里按匿名身份再取一次，保证首页与登录页的「访客浏览」入口不会因为残留 token 而消失
      if (hadToken && !store.token) {
        try {
          S.user = await api('api/me');
          S.hasToken = false;
          S.guestMode = S.user && S.user.role === 1;
          return S.user;
        } catch (e2) { /* 访客也被禁用，按未登录处理 */ }
      }
      return null;
    }
  }

  async function boot() {
    await loadSettings();
    await checkInit();
    document.getElementById('boot').hidden = true;
    window.addEventListener('hashchange', () => render());
    if (S.initialized) await loadMe();
    render();
  }

  function show(appEl, html) {
    appEl.hidden = false;
    appEl.innerHTML = html;
  }

  /* ------------------------------------------------------------------ *
   * 顶栏
   * ------------------------------------------------------------------ */
  function topbar(kind) {
    const homeIcon = S.settings.home_icon || '/assets/icons/home.svg';
    let left = '';
    let right = '';

    if (kind === 'admin') {
      left = '<button class="nav-btn" data-act="home">' + iconOrImage(homeIcon) + '<span>首页</span></button>' +
        '<button class="nav-btn primary" data-act="admin-home">' + icon('i-shield') + '<span>管理</span></button>';
      right = '<button class="nav-btn" data-act="account">' + icon('i-key') + '<span>账号</span></button>' +
        '<button class="nav-btn" data-act="logout">' + icon('i-logout') + '<span>退出登录</span></button>';
    } else {
      left = '<button class="nav-btn" data-act="home">' + iconOrImage(homeIcon) + '<span>首页</span></button>';
      if (isAdmin()) {
        right = '<button class="nav-btn" data-act="admin">' + icon('i-shield') + '<span>管理</span></button>';
      } else if (S.user && !isGuest()) {
        // 普通用户：可改密码 / 2FA，也能退出登录
        right = '<button class="nav-btn" data-act="account">' + icon('i-key') + '<span>账号</span></button>' +
          '<button class="nav-btn" data-act="logout">' + icon('i-logout') + '<span>退出登录</span></button>';
      } else if (isGuest() && boolSetting('guest_login_entry', true)) {
        right = '<button class="nav-btn" data-act="login">' + icon('i-login') + '<span>登录</span></button>';
      }
    }

    return '' +
      '<header class="topbar"><div class="topbar-inner">' +
      left +
      '<div class="brand">' + brandMark() +
      '<span class="brand-title">' + fmt.esc(siteTitle()) +
      '<span class="brand-sub">' + (kind === 'admin' ? '管理控制台' : '文件浏览器') + '</span></span></div>' +
      '<div class="right" style="display:flex;gap:8px;align-items:center">' + right + '</div>' +
      '</div></header>';
  }

  function bindTopbar(root) {
    root.querySelectorAll('[data-act]').forEach((el) => {
      const act = el.getAttribute('data-act');
      if (act === 'home') el.onclick = () => go('#/home');
      if (act === 'admin') el.onclick = () => go('#/admin');
      if (act === 'admin-home') el.onclick = () => go('#/admin');
      if (act === 'login') el.onclick = () => go('#/login');
      if (act === 'logout') el.onclick = doLogout;
      if (act === 'account') el.onclick = () => showAccount();
    });
  }

  async function doLogout() {
    api('api/auth/logout').catch(() => {});
    setToken('');
    S.user = null;
    S.hasToken = false;
    await loadMe();
    go('#/login');
  }

  /* ------------------------------------------------------------------ *
   * 渲染入口
   * ------------------------------------------------------------------ */
  async function render() {
    const myToken = ++renderToken;
    const appEl = document.getElementById('app');
    if (!S.initialized) {
      show(appEl, '<div id="view"></div>');
      renderSetup();
      return;
    }

    const share = shareFromPath();
    const { segs, query } = parseHash();

    if (share) {
      show(appEl, topbar('home') + '<div id="view"></div>');
      bindTopbar(appEl);
      renderShare(share);
      return;
    }

    if (!S.user) {
      await loadMe();
      if (myToken !== renderToken) return;
    }

    if (segs[0] === 'login') {
      show(appEl, '<div id="view"></div>');
      renderLogin(appEl.querySelector('#view'));
      return;
    }

    if (!S.user) {
      show(appEl, '<div id="view"></div>');
      renderLogin(appEl.querySelector('#view'), '访客模式未开启，请登录后使用');
      return;
    }

    if (segs[0] === 'admin') {
      if (!isAdmin()) { go('#/home'); return; }
      show(appEl, topbar('admin') + '<div id="view"></div>');
      bindTopbar(appEl);
      Admin.render(appEl.querySelector('#view'), segs[1] || 'home', { user: S.user, settings: S.settings, isAdmin, go, refresh: render });
      return;
    }

    if (segs[0] === 'browse') {
      const p = query.path || '/';
      show(appEl, topbar('home') + '<div id="view"></div>');
      bindTopbar(appEl);
      renderBrowse(appEl.querySelector('#view'), p);
      return;
    }

    show(appEl, topbar('home') + '<div id="view"></div>');
    bindTopbar(appEl);
    renderHome(appEl.querySelector('#view'));
  }

  /* ------------------------------------------------------------------ *
   * 初始化向导
   * ------------------------------------------------------------------ */
  function renderSetup() {
    const view = document.getElementById('view');
    view.innerHTML = '' +
      '<div class="auth-wrap"><aside class="auth-aside">' +
      '<div class="brand">' + brandMark() + '<span class="brand-title">' + fmt.esc(siteTitle()) + '</span></div>' +
      '<div><h1>首次使用<br>先创建管理员</h1><p>文件服务器已完成安装，接下来只需要创建一个管理员账号即可开始使用。</p></div>' +
      '<div style="color:rgba(255,255,255,.6);font-size:12px">支持本地磁盘、SMB、FTP、SFTP 存储</div>' +
      '</aside><main class="auth-main"><div class="auth-card">' +
      '<h2>初始化</h2><p class="lead">设置管理员账号与站点名称</p>' +
      '<form id="setup-form">' +
      '<div class="field"><label>站点名称</label><input class="input" name="site_title" value="文件服务器" maxlength="40"></div>' +
      '<div class="field"><label>管理员账号</label><input class="input" name="username" value="admin" autocomplete="username" required></div>' +
      '<div class="field"><label>登录密码</label><input class="input" type="password" name="password" minlength="4" autocomplete="new-password" required></div>' +
      '<button class="btn primary auth-submit" type="submit">创建并进入</button>' +
      '</form></div></main></div>';
    const form = view.querySelector('#setup-form');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const btn = form.querySelector('button');
      btn.disabled = true;
      try {
        await api('api/public/init/setup', {
          method: 'POST',
          body: { site_title: fd.get('site_title'), username: fd.get('username'), password: fd.get('password') },
        });
        toast('初始化完成，请登录', 'ok');
        S.initialized = true;
        await loadSettings();
        await loadMe();
        location.hash = '#/login';
        render();
      } catch (err) {
        toastErr(err);
      } finally { btn.disabled = false; }
    };
  }

  /* ------------------------------------------------------------------ *
   * 登录 / 忘记密码
   * ------------------------------------------------------------------ */
  function renderLogin(view, hint) {
    const saved = remember.load();
    view.innerHTML = '' +
      '<div class="auth-wrap"><aside class="auth-aside">' +
      '<div class="brand">' + brandMark() + '<span class="brand-title">' + fmt.esc(siteTitle()) + '</span></div>' +
      '<div><h1>你的文件<br>都在这里</h1><p>' + fmt.esc(S.settings.announcement || '统一浏览本地磁盘与内网共享目录，支持在线预览、上传与分享。') + '</p>' +
      '<ul class="auth-features">' +
      '<li>' + icon('i-storage') + '本地磁盘 / SMB / FTP / SFTP 统一入口</li>' +
      '<li>' + icon('i-video') + '图片、音视频、文本在线预览</li>' +
      '<li>' + icon('i-link') + '一键生成带提取码的分享链接</li>' +
      '</ul></div>' +
      '<div style="font-size:12px;color:rgba(255,255,255,.55)">仅简体中文 · 全部资源本地化</div>' +
      '</aside><main class="auth-main"><div class="auth-card">' +
      '<h2>登录</h2><p class="lead">' + fmt.esc(hint || '请使用管理员为你分配的账号登录') + '</p>' +
      '<form id="login-form">' +
      '<div class="field"><label>用户名</label><input class="input" name="username" autocomplete="username" value="' + fmt.esc(saved ? saved.u : '') + '" required></div>' +
      '<div class="field"><label>密码</label><input class="input" type="password" name="password" autocomplete="current-password" value="' + (saved ? fmt.esc(saved.p) : '') + '" required></div>' +
      '<div class="field" id="otp-field" hidden><label>两步验证码</label><input class="input" name="otp_code" inputmode="numeric" maxlength="6" placeholder="6 位动态验证码"></div>' +
      '<div class="auth-row"><label class="check"><input type="checkbox" name="remember"' + (saved ? ' checked' : '') + '>记住密码</label>' +
      '<a href="javascript:void(0)" id="forgot-link">忘记密码？</a></div>' +
      '<button class="btn primary auth-submit" type="submit">登录</button>' +
      '</form>' +
      '<div class="auth-foot">' + ((S.user && S.user.role === 1) ? '<a href="javascript:void(0)" id="guest-link">以访客身份浏览</a>' : '') + '</div>' +
      '<div class="auth-note">「记住密码」仅保存在本机浏览器中，用于免输入登录；在公用电脑上请勿勾选。</div>' +
      '</div></main></div>';

    const form = view.querySelector('#login-form');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const r = await api('api/auth/login', {
          method: 'POST',
          body: {
            username: String(fd.get('username') || '').trim(),
            password: fd.get('password'),
            otp_code: fd.get('otp_code') || '',
          },
        });
        setToken(r.token);
        // 校验 token 是否真的可用：停用账号、改密后的旧凭证都会在这一步被拦下，
        // 避免「提示登录成功但实际进不去」
        try {
          S.user = await api('api/me');
        } catch (meErr) {
          setToken('');
          await loadMe();
          toast(errText(meErr), 'err');
          return;
        }
        if (fd.get('remember')) remember.save(String(fd.get('username')).trim(), fd.get('password'));
        else remember.clear();
        S.hasToken = true;
        toast('登录成功', 'ok');
        go(isAdmin() ? '#/admin' : '#/home');
      } catch (err) {
        const msg = errText(err);
        if (err.code === 402 || /两步验证|2FA/i.test(msg)) {
          view.querySelector('#otp-field').hidden = false;
          view.querySelector('[name=otp_code]').focus();
          toast('请输入两步验证码', 'err');
        } else {
          toast(msg, 'err');
        }
      } finally { btn.disabled = false; }
    };

    view.querySelector('#forgot-link').onclick = showForgot;
    const gl = view.querySelector('#guest-link');
    if (gl) gl.onclick = async () => {
      const u = await loadMe();
      if (u) {
        go('#/home');
        render();
      } else {
        toast('访客模式未开启，请登录后使用', 'err');
      }
    };
  }

  async function showForgot() {
    let enabled = boolSetting('password_reset_enabled', true);
    try {
      const info = await api('api/auth/reset_info');
      enabled = !!(info && info.enabled);
    } catch (e) { /* ignore */ }

    Modal.open('' +
      '<div class="modal-head"><h3>找回密码</h3><button class="icon-btn" data-close>' + icon('i-close') + '</button></div>' +
      '<div class="modal-body">' +
      '<div class="auth-note" style="margin-top:0">' +
      '<b>方式一：管理员重置</b><br>管理员登录后在「用户管理 → 重置密码」生成一次性重置码；也可在服务器上执行命令：<br>' +
      '<code>openlist.exe admin reset-password -u 用户名 -p 新密码</code><br>' +
      '<code>openlist.exe admin reset-code -u 用户名</code>' +
      '</div>' +
      '<form id="reset-form" style="margin-top:18px">' +
      '<div class="field"><label>用户名</label><input class="input" name="username" required></div>' +
      '<div class="field"><label>重置码</label><input class="input" name="code" placeholder="XXXX-XXXX" required></div>' +
      '<div class="field"><label>新密码</label><input class="input" type="password" name="password" minlength="6" required></div>' +
      '<p class="muted" style="font-size:12px;margin:0">重置码 15 分钟内有效，使用后立即失效。' + (enabled ? '' : '<b>（当前站点已关闭自助找回）</b>') + '</p>' +
      '</form></div>' +
      '<div class="modal-foot"><button class="btn" data-close>取消</button><button class="btn primary" id="reset-submit"' + (enabled ? '' : ' disabled') + '>重置密码</button></div>',
      {
        onMount(mask) {
          mask.querySelector('#reset-submit').onclick = async () => {
            const form = mask.querySelector('#reset-form');
            const fd = new FormData(form);
            const btn = mask.querySelector('#reset-submit');
            btn.disabled = true;
            try {
              const r = await api('api/auth/reset_password', {
                method: 'POST',
                body: { username: fd.get('username'), code: fd.get('code'), password: fd.get('password') },
              });
              toast((r && r.message) || '密码已重置，请登录', 'ok');
              Modal.close();
            } catch (err) {
              toastErr(err);
            } finally { btn.disabled = false; }
          };
        },
      });
  }

  /* ------------------------------------------------------------------ *
   * 首页
   * ------------------------------------------------------------------ */
  async function renderHome(view) {
    const canManage = isAdmin();
    view.innerHTML = '' +
      '<div class="page">' +
      '<section class="hero"><h1>' + fmt.esc(siteTitle()) + '</h1>' +
      '<p>' + fmt.esc(S.settings.announcement || '选择下方任意存储即可开始浏览文件。') + '</p>' +
      '<div class="hero-actions">' +
      (canManage ? '<button class="nav-btn" id="hero-add">' + icon('i-plus') + '<span>添加存储</span></button>' : '') +
      (canManage ? '<button class="nav-btn" id="hero-admin">' + icon('i-shield') + '<span>进入管理</span></button>' : '') +
      '</div></section>' +
      '<div class="section-head"><div><h2>存储</h2><p id="storage-count">正在读取存储列表…</p></div>' +
      '<button class="btn sm" id="reload-home">' + icon('i-refresh') + '刷新</button></div>' +
      '<div id="storage-area"></div>' +
      '</div>';

    const area = view.querySelector('#storage-area');
    const countEl = view.querySelector('#storage-count');
    if (view.querySelector('#hero-add')) view.querySelector('#hero-add').onclick = () => go('#/admin/storage');
    if (view.querySelector('#hero-admin')) view.querySelector('#hero-admin').onclick = () => go('#/admin');
    view.querySelector('#reload-home').onclick = () => loadStorages(area, countEl);
    await loadStorages(area, countEl);
  }

  async function loadStorages(area, countEl) {
    area.innerHTML = '<div class="empty-state"><p class="muted">正在加载…</p></div>';
    let content = [];
    try {
      const d = await api('api/fs/list', { method: 'POST', body: { path: '/', password: '', page: 1, per_page: 500, refresh: false } });
      content = (d && d.content) || [];
    } catch (e) {
      const isEmpty = /storage not found|no storage|请先添加/i.test(e.message || '');
      countEl.textContent = isEmpty ? '尚未添加存储' : '';
      area.innerHTML = '' +
        '<div class="empty-state">' +
        '<div class="empty-ico">' + icon(isEmpty ? 'i-storage' : 'i-info') + '</div>' +
        '<h3>' + (isEmpty ? '还没有添加任何存储' : '无法读取存储列表') + '</h3>' +
        '<p>' + (isEmpty ? '添加一个本地目录、SMB 共享或 FTP/SFTP 服务器后，即可在这里浏览文件。' : fmt.esc(errText(e))) + '</p>' +
        (isAdmin()
          ? '<div class="empty-actions"><button class="btn primary" id="empty-add">' + icon('i-plus') + '去添加存储</button></div>'
          : '<p class="muted" style="margin:0">' + (isEmpty ? '请联系管理员添加存储' : '') + '</p>') +
        '</div>';
      const b = area.querySelector('#empty-add');
      if (b) b.onclick = () => go('#/admin/storage');
      return;
    }
    const dirs = content.filter((o) => o.is_dir);
    countEl.textContent = dirs.length ? '共 ' + dirs.length + ' 个可用存储' : '尚未添加存储';
    if (!dirs.length) {
      area.innerHTML = '' +
        '<div class="empty-state">' +
        '<div class="empty-ico">' + icon('i-storage') + '</div>' +
        '<h3>还没有添加任何存储</h3>' +
        '<p>添加一个本地目录、SMB 共享或 FTP/SFTP 服务器后，即可在这里浏览文件。</p>' +
        (isAdmin() ? '<div class="empty-actions"><button class="btn primary" id="empty-add">' + icon('i-plus') + '去添加存储</button></div>' : '<p class="muted" style="margin:0">请联系管理员添加存储</p>') +
        '</div>';
      const b = area.querySelector('#empty-add');
      if (b) b.onclick = () => go('#/admin/storage');
      return;
    }
    area.innerHTML = '<div class="grid storage-grid">' + dirs.map((o) => {
      const details = o.mount_details || {};
      const driver = details.driver || '';
      return '<button class="card storage-card" data-path="' + fmt.esc(o.name) + '">' +
        '<span class="storage-badge">' + icon('i-storage') + '</span>' +
        '<span class="storage-meta"><span class="storage-name">' + fmt.esc(o.name) + '</span>' +
        '<span class="storage-path">' + fmt.esc(driver ? driver + ' · 挂载于 /' + o.name : '点击浏览该存储') + '</span></span>' +
        icon('i-chevron', 'chev') +
        '</button>';
    }).join('') + '</div>';
    area.querySelectorAll('[data-path]').forEach((el) => {
      el.onclick = () => go('#/browse?path=' + encodeURIComponent('/' + el.getAttribute('data-path')));
    });
  }

  /* ------------------------------------------------------------------ *
   * 上传中心
   * ------------------------------------------------------------------ */
  const Uploader = {
    items: [],
    seq: 0,
    panel: null,
    active: 0,
    maxActive: 2,
    onDone: null,

    enqueue(files, dir, asTask) {
      Array.from(files).forEach((file) => {
        this.items.push({
          id: ++this.seq,
          file,
          dir,
          asTask: !!asTask,
          loaded: 0,
          total: file.size,
          status: 'wait',
          speed: 0,
          err: '',
          xhr: null,
          lastTick: 0,
          lastLoaded: 0,
        });
      });
      this.renderPanel();
      this.pump();
    },

    pump() {
      while (this.active < this.maxActive) {
        const next = this.items.find((i) => i.status === 'wait');
        if (!next) break;
        this.start(next);
      }
    },

    start(item) {
      item.status = 'run';
      item.lastTick = Date.now();
      item.lastLoaded = 0;
      this.active++;
      const xhr = new XMLHttpRequest();
      item.xhr = xhr;
      xhr.open('PUT', App.BASE + 'api/fs/put');
      if (store.token) xhr.setRequestHeader('Authorization', store.token);
      xhr.setRequestHeader('File-Path', fmt.encodePath(joinPath(item.dir, item.file.name)));
      xhr.setRequestHeader('As-Task', item.asTask ? 'true' : 'false');
      xhr.setRequestHeader('Overwrite', 'true');
      xhr.setRequestHeader('Content-Type', item.file.type || 'application/octet-stream');
      xhr.upload.onprogress = (ev) => {
        if (!ev.lengthComputable) return;
        item.loaded = ev.loaded;
        const now = Date.now();
        const dt = (now - item.lastTick) / 1000;
        if (dt >= 0.4) {
          item.speed = (ev.loaded - item.lastLoaded) / dt;
          item.lastTick = now;
          item.lastLoaded = ev.loaded;
          this.renderPanel();
        }
      };
      xhr.onload = () => {
        this.active--;
        let ok = false;
        try {
          const r = JSON.parse(xhr.responseText || '{}');
          ok = xhr.status === 200 && r.code === 200;
          if (!ok) item.err = mapError(r.message || ('HTTP ' + xhr.status));
        } catch (e) { item.err = 'HTTP ' + xhr.status; }
        item.status = ok ? 'done' : 'err';
        if (ok) item.loaded = item.total;
        this.afterFinish();
      };
      xhr.onerror = () => {
        this.active--;
        item.status = 'err';
        item.err = '网络错误';
        this.afterFinish();
      };
      xhr.onabort = () => {
        this.active--;
        item.status = 'err';
        item.err = '已取消';
        this.afterFinish();
      };
      xhr.send(item.file);
      this.renderPanel();
    },

    afterFinish() {
      this.renderPanel();
      this.pump();
      if (!this.items.some((i) => i.status === 'wait' || i.status === 'run')) {
        if (this.onDone) { const cb = this.onDone; this.onDone = null; cb(); }
      }
    },

    cancel(id) {
      const item = this.items.find((i) => i.id === id);
      if (item && item.status === 'run' && item.xhr) item.xhr.abort();
      else if (item && item.status === 'wait') { item.status = 'err'; item.err = '已取消'; this.renderPanel(); }
    },

    clearDone() {
      this.items = this.items.filter((i) => i.status === 'run' || i.status === 'wait');
      this.renderPanel();
      this.pump();
    },

    humanSpeed(bps) {
      if (!bps || bps < 1) return '—';
      return fmt.size(bps) + '/s';
    },

    // 剩余时间：按当前速度估算
    humanEta(item) {
      if (item.status !== 'run' || !item.speed || item.speed < 1) return '';
      const left = item.total - item.loaded;
      if (left <= 0) return '';
      const sec = Math.round(left / item.speed);
      if (sec < 60) return sec + ' 秒';
      const m = Math.floor(sec / 60);
      if (m < 60) return m + ' 分 ' + (sec % 60) + ' 秒';
      return Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分';
    },

    // 全部运行中任务的剩余时间
    totalEta() {
      const running = this.items.filter((i) => i.status === 'run');
      if (!running.length) return '';
      const speed = running.reduce((a, i) => a + (i.speed || 0), 0);
      const left = running.reduce((a, i) => a + (i.total - i.loaded), 0);
      if (speed < 1 || left <= 0) return '';
      return this.humanEta({ status: 'run', speed, total: left, loaded: 0 });
    },

    renderPanel() {
      if (!this.items.length) {
        if (this.panel) { this.panel.remove(); this.panel = null; }
        return;
      }
      if (!this.panel) {
        this.panel = document.createElement('div');
        this.panel.className = 'upload-panel';
        document.body.appendChild(this.panel);
      }
      const running = this.items.filter((i) => i.status === 'run').length;
      const done = this.items.filter((i) => i.status === 'done').length;
      const failed = this.items.filter((i) => i.status === 'err').length;
      const totalSpeed = this.items.reduce((s, i) => s + (i.status === 'run' ? i.speed : 0), 0);
      this.panel.innerHTML = '' +
        '<div class="upload-head">' + icon('i-upload') +
        '<span>传输列表</span><span class="sub">' + done + '/' + this.items.length + (failed ? ' · 失败 ' + failed : '') +
        (running ? ' · ' + this.humanSpeed(totalSpeed) : '') +
        (this.totalEta() ? ' · 剩余 ' + this.totalEta() : '') + '</span>' +
        '<span class="spacer"></span>' +
        '<button class="btn link" id="up-clear" title="清除已完成的任务">清除</button>' +
        '<button class="icon-btn" id="up-min">' + icon('i-close') + '</button></div>' +
        '<div class="upload-list">' + this.items.map((i) => {
          const pct = i.total ? Math.min(100, Math.round((i.loaded / i.total) * 100)) : (i.status === 'done' ? 100 : 0);
          let st = '等待中';
          if (i.status === 'run') st = this.humanSpeed(i.speed) + ' · ' + pct + '%' + (this.humanEta(i) ? ' · 剩余 ' + this.humanEta(i) : '');
          else if (i.status === 'done') st = '完成 ' + fmt.size(i.total);
          else if (i.status === 'err') st = i.err || '失败';
          return '<div class="upload-item ' + (i.status === 'done' ? 'done' : (i.status === 'err' ? 'err' : '')) + '">' +
            '<div class="row1"><span class="nm" title="' + fmt.esc(i.file.name) + '">' + fmt.esc(i.file.name) + '</span>' +
            '<span class="st ' + (i.status === 'done' ? 'ok' : (i.status === 'err' ? 'err' : '')) + '">' + fmt.esc(st) + '</span>' +
            (i.status === 'run' || i.status === 'wait' ? '<button class="btn link" data-cancel="' + i.id + '">取消</button>' : '') +
            '</div><div class="bar"><i style="width:' + pct + '%"></i></div></div>';
        }).join('') + '</div>';

      this.panel.querySelector('#up-clear').onclick = () => this.clearDone();
      this.panel.querySelector('#up-min').onclick = () => {
        this.items = this.items.filter((i) => i.status === 'run' || i.status === 'wait');
        this.panel.remove();
        this.panel = null;
      };
      this.panel.querySelectorAll('[data-cancel]').forEach((b) => {
        b.onclick = () => this.cancel(parseInt(b.getAttribute('data-cancel'), 10));
      });
    },
  };

  /* ------------------------------------------------------------------ *
   * 文件浏览
   * ------------------------------------------------------------------ */
  const TYPES = { 0: 'i-file', 1: 'i-folder', 2: 'i-video', 3: 'i-audio', 4: 'i-text', 5: 'i-image' };
  const ARCHIVE_EXT = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso'];

  function fileIcon(obj) {
    if (obj.is_dir) return '<span class="file-ico dir">' + icon('i-folder') + '</span>';
    let id = TYPES[obj.type] || 'i-file';
    if (obj.type === 0 && ARCHIVE_EXT.includes(ext(obj.name))) id = 'i-archive';
    return '<span class="file-ico">' + icon(id) + '</span>';
  }

  function crumbs(path) {
    const parts = String(path).split('/').filter(Boolean);
    let acc = '';
    let html = '<span class="crumb' + (parts.length ? '' : ' current') + '" data-crumb="/">根目录</span>';
    parts.forEach((p, i) => {
      acc += '/' + p;
      html += '<span class="crumb-sep">' + icon('i-chevron') + '</span>' +
        '<span class="crumb' + (i === parts.length - 1 ? ' current' : '') + '" data-crumb="' + fmt.esc(acc) + '">' + fmt.esc(p) + '</span>';
    });
    return html;
  }

  function sharePwd(path) {
    const m = /^\/@s\/([^/]+)/.exec(path || '');
    return m ? (sessionStorage.getItem('share_pwd_' + m[1]) || '') : '';
  }

  async function fileMeta(path) {
    return api('api/fs/get', { method: 'POST', body: { path, password: sharePwd(path) } });
  }

  function rawUrl(path, sign) {
    return App.BASE + 'd' + fmt.encodePath(path) + (sign ? '?sign=' + encodeURIComponent(sign) : '');
  }

  async function renderBrowse(view, path) {
    const ls = localSettings.get();
    const st = {
      path,
      list: [],
      write: false,
      selected: new Set(),
      page: 1,
      pageSize: ls.pageSize || 30,
      layout: ls.layout || 'list',
      sortBy: ls.sortBy || 'name',
      sortOrder: ls.sortOrder || 'asc',
      selectMode: !!ls.showCheckbox,
      cardSize: ls.cardSize || 'medium',
      nameOverflow: ls.nameOverflow || 'ellipsis',
      showCount: ls.showCount !== false,
      total: 0,
    };

    view.innerHTML = '' +
      '<div class="page"><div class="panel">' +
      '<div class="browser-bar">' +
      '<div class="crumbs" id="crumbs">' + crumbs(path) + '</div>' +
      '<div class="spacer"></div>' +
      '<div class="browser-toolbar" id="toolbar"></div>' +
      '</div>' +
      '<div class="batch-bar" id="batch" hidden></div>' +
      '<div id="file-area"><div class="browser-empty">正在加载…</div></div>' +
      '<div class="pager" id="pager" hidden></div>' +
      '</div></div>';

    const area = view.querySelector('#file-area');
    const toolbar = view.querySelector('#toolbar');
    const batch = view.querySelector('#batch');
    const pager = view.querySelector('#pager');

    view.querySelectorAll('[data-crumb]').forEach((c) => {
      c.onclick = () => go('#/browse?path=' + encodeURIComponent(c.getAttribute('data-crumb')));
    });

    function renderToolbar() {
      toolbar.innerHTML = '' +
        (st.write ? '<button class="btn sm" id="btn-new">' + icon('i-plus') + '新建</button>' : '') +
        (st.write ? '<button class="btn sm" id="btn-upload">' + icon('i-upload') + '上传</button>' : '') +
        '<button class="btn sm" id="btn-select" title="批量选择">' + icon('i-check-square') + (st.selectMode ? '取消选择' : '选择') + '</button>' +
        '<button class="btn sm" id="btn-layout" title="切换布局">' + icon(st.layout === 'grid' ? 'i-list' : 'i-grid') + '</button>' +
        '<button class="btn sm" id="btn-refresh" title="刷新目录">' + icon('i-refresh') + '</button>' +
        '<button class="btn sm" id="btn-search" title="搜索">' + icon('i-search') + '</button>' +
        '<button class="btn sm" id="btn-more" title="更多">' + icon('i-more') + '</button>';

      const bNew = toolbar.querySelector('#btn-new');
      if (bNew) bNew.onclick = (e) => showNewMenu(e.currentTarget, st.path, () => load());
      const bUp = toolbar.querySelector('#btn-upload');
      if (bUp) bUp.onclick = () => pickUpload(st.path, () => load());
      toolbar.querySelector('#btn-select').onclick = () => {
        st.selectMode = !st.selectMode;
        if (!st.selectMode) st.selected.clear();
        localSettings.set({ showCheckbox: st.selectMode });
        renderToolbar();
        renderList();
      };
      toolbar.querySelector('#btn-layout').onclick = () => {
        st.layout = st.layout === 'grid' ? 'list' : 'grid';
        localSettings.set({ layout: st.layout });
        renderToolbar();
        renderList();
      };
      toolbar.querySelector('#btn-refresh').onclick = () => load(true);
      toolbar.querySelector('#btn-search').onclick = () => showSearch(st.path);
      toolbar.querySelector('#btn-more').onclick = (e) => showMoreMenu(e.currentTarget, st, () => load());
    }

    function renderBatch() {
      if (!st.selectMode || !st.selected.size) { batch.hidden = true; batch.innerHTML = ''; return; }
      batch.hidden = false;
      batch.innerHTML = '' +
        '<span class="count">已选 ' + st.selected.size + ' 项</span>' +
        '<button class="btn link" id="b-all">全选本页</button>' +
        '<button class="btn link" id="b-none">清空</button>' +
        '<span class="spacer"></span>' +
        '<button class="btn sm" id="b-zip">' + icon('i-download') + '打包下载</button>' +
      (st.write ? '<button class="btn sm" id="b-move">' + icon('i-move') + '移动</button>' +
          '<button class="btn sm" id="b-copy">' + icon('i-copy') + '复制</button>' +
          '<button class="btn sm" id="b-rename">' + icon('i-edit') + '重命名</button>' +
          '<button class="btn sm danger" id="b-del">' + icon('i-trash') + '删除</button>' : '');
      batch.querySelector('#b-all').onclick = () => {
        pageItems().forEach((o) => st.selected.add(o.name));
        renderList();
      };
      batch.querySelector('#b-none').onclick = () => { st.selected.clear(); renderList(); };
      batch.querySelector('#b-zip').onclick = () => packageDownload(
        Array.from(st.selected).map((n) => joinPath(st.path, n)),
        baseName(st.path) || '打包下载'
      );
      if (st.write) {
        batch.querySelector('#b-move').onclick = () => showMoveCopy(st, 'move', () => load());
        batch.querySelector('#b-copy').onclick = () => showMoveCopy(st, 'copy', () => load());
        batch.querySelector('#b-rename').onclick = () => showBatchRename(st, () => load());
        batch.querySelector('#b-del').onclick = () => batchRemove(st, () => load());
      }
    }

    function cardMinPx() {
      return ({ small: 104, medium: 132, large: 176 })[st.cardSize] || 132;
    }

    function nameCls() {
      return 'ov-' + (st.nameOverflow || 'ellipsis');
    }

    function sorted() {
      const arr = st.list.slice();
      const dir = st.sortOrder === 'desc' ? -1 : 1;
      arr.sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        let r = 0;
        if (st.sortBy === 'size') r = (a.size || 0) - (b.size || 0);
        else if (st.sortBy === 'modified') r = new Date(a.modified || 0) - new Date(b.modified || 0);
        else r = String(a.name).localeCompare(String(b.name), 'zh');
        return r * dir;
      });
      return arr;
    }

    function pageItems() {
      const all = sorted();
      if (st.pageSize <= 0) return all;
      const start = (st.page - 1) * st.pageSize;
      return all.slice(start, start + st.pageSize);
    }

    function renderList() {
      const all = sorted();
      const items = pageItems();
      if (!st.list.length) {
        area.innerHTML = '<div class="browser-empty">此目录为空' + (st.write ? '，可直接拖拽文件到页面任意位置上传' : '') + '</div>';
        renderBatch();
        renderPager(0);
        return;
      }

      if (st.layout === 'grid') {
        area.innerHTML = '<div class="file-grid" style="--card-min:' + cardMinPx() + 'px">' + items.map((o) => {
          const full = joinPath(st.path, o.name);
          return '<div class="file-card' + (st.selected.has(o.name) ? ' selected' : '') + '" data-open="' + fmt.esc(full) + '" data-dir="' + (o.is_dir ? 1 : 0) + '" data-name="' + fmt.esc(o.name) + '">' +
            (st.selectMode ? '<span class="card-check"><input type="checkbox" data-check="' + fmt.esc(o.name) + '"' + (st.selected.has(o.name) ? ' checked' : '') + '></span>' : '') +
            '<span class="card-actions"><button class="icon-btn" data-menu="' + fmt.esc(full) + '" data-isdir="' + (o.is_dir ? 1 : 0) + '">' + icon('i-more') + '</button></span>' +
            fileIcon(o) +
            '<span class="name ' + nameCls() + '" title="' + fmt.esc(o.name) + '">' + fmt.esc(o.name) + '</span>' +
            '<span class="size">' + (o.is_dir ? '文件夹' : fmt.size(o.size)) + '</span>' +
            '</div>';
        }).join('') + '</div>';
      } else {
        const arrow = (k) => st.sortBy === k ? ' <span class="sort-arrow">' + (st.sortOrder === 'asc' ? '↑' : '↓') + '</span>' : '';
        area.innerHTML = '<div class="table-wrap"><table class="data files"><thead><tr>' +
          (st.selectMode ? '<th class="cell-check"><input type="checkbox" id="check-all"></th>' : '') +
          '<th class="sortable" data-sort="name">名称' + arrow('name') + '</th>' +
          '<th class="sortable" data-sort="size" style="width:110px">大小' + arrow('size') + '</th>' +
          '<th class="sortable" data-sort="modified" style="width:170px">修改时间' + arrow('modified') + '</th>' +
          '<th style="width:190px"></th>' +
          '</tr></thead><tbody>' + items.map((o) => {
            const full = joinPath(st.path, o.name);
            return '<tr' + (st.selected.has(o.name) ? ' class="selected"' : '') + '>' +
              (st.selectMode ? '<td class="cell-check"><input type="checkbox" data-check="' + fmt.esc(o.name) + '"' + (st.selected.has(o.name) ? ' checked' : '') + '></td>' : '') +
              '<td><span class="file-name ' + nameCls() + '" data-open="' + fmt.esc(full) + '" data-dir="' + (o.is_dir ? 1 : 0) + '" data-name="' + fmt.esc(o.name) + '" title="' + fmt.esc(o.name) + '">' +
              fileIcon(o) + '<span>' + fmt.esc(o.name) + '</span></span></td>' +
              '<td class="muted">' + (o.is_dir ? '-' : fmt.size(o.size)) + '</td>' +
              '<td class="muted">' + fmt.time(o.modified) + '</td>' +
              '<td class="actions"><div class="row-actions">' +
              '<button class="btn link" data-preview="' + fmt.esc(full) + '">预览</button>' +
              (!o.is_dir ? '<button class="btn link" data-download="' + fmt.esc(full) + '">下载</button>' : '') +
              '<button class="btn link" data-menu="' + fmt.esc(full) + '" data-isdir="' + (o.is_dir ? 1 : 0) + '">更多</button>' +
              '</div></td></tr>';
          }).join('') + '</tbody></table></div>';
      }

      area.querySelectorAll('[data-open]').forEach((el) => {
        el.onclick = (ev) => {
          if (ev.target.closest('[data-check]') || ev.target.closest('[data-menu]')) return;
          const name = el.getAttribute('data-name') || (el.getAttribute('data-open') || '').split('/').pop();
          if (st.selectMode) { toggleSelect(name); return; }
          const p = el.getAttribute('data-open');
          if (el.getAttribute('data-dir') === '1') go('#/browse?path=' + encodeURIComponent(p));
          else showPreview(p, () => load());
        };
      });
      area.querySelectorAll('[data-check]').forEach((cb) => {
        cb.onclick = (ev) => { ev.stopPropagation(); toggleSelect(cb.getAttribute('data-check')); };
      });
      area.querySelectorAll('[data-preview]').forEach((el) => el.onclick = () => showPreview(el.getAttribute('data-preview'), () => load()));
      area.querySelectorAll('[data-download]').forEach((el) => el.onclick = () => download(el.getAttribute('data-download')));
      area.querySelectorAll('[data-menu]').forEach((el) => {
        el.onclick = (ev) => {
          ev.stopPropagation();
          showFileMenu(ev.currentTarget, el.getAttribute('data-menu'), el.getAttribute('data-isdir') === '1', st, () => load());
        };
      });
      area.querySelectorAll('th[data-sort]').forEach((th) => {
        th.onclick = () => {
          const k = th.getAttribute('data-sort');
          if (st.sortBy === k) st.sortOrder = st.sortOrder === 'asc' ? 'desc' : 'asc';
          else { st.sortBy = k; st.sortOrder = 'asc'; }
          localSettings.set({ sortBy: st.sortBy, sortOrder: st.sortOrder });
          renderList();
        };
      });
      const allCb = area.querySelector('#check-all');
      if (allCb) {
        allCb.checked = items.length > 0 && items.every((o) => st.selected.has(o.name));
        allCb.onclick = () => {
          if (allCb.checked) items.forEach((o) => st.selected.add(o.name));
          else items.forEach((o) => st.selected.delete(o.name));
          renderList();
        };
      }

      renderBatch();
      renderPager(all.length);
    }

    function countText(total) {
      if (!st.showCount) return '共 ' + total + ' 项';
      const dirs = st.list.filter((o) => o.is_dir).length;
      const files = st.list.length - dirs;
      return '共 ' + total + ' 项（' + dirs + ' 个文件夹 · ' + files + ' 个文件）';
    }

    function renderPager(total) {
      if (total <= 0) { pager.hidden = true; return; }
      pager.hidden = false;
      if (st.pageSize <= 0 || total <= st.pageSize) {
        pager.innerHTML = '<span>' + countText(total) + '</span><span class="spacer"></span><button id="pg-size">每页：' + (st.pageSize <= 0 ? '全部' : st.pageSize + ' 项') + '</button>';
      } else {
        const pages = Math.ceil(total / st.pageSize);
        pager.innerHTML = '<span>' + countText(total) + ' · 第 ' + st.page + '/' + pages + ' 页</span><span class="spacer"></span>' +
          '<button id="pg-prev"' + (st.page <= 1 ? ' disabled' : '') + '>上一页</button>' +
          '<button id="pg-next"' + (st.page >= pages ? ' disabled' : '') + '>下一页</button>' +
          '<button id="pg-size">每页 ' + st.pageSize + ' 项</button>';
        pager.querySelector('#pg-prev').onclick = () => { st.page--; renderList(); };
        pager.querySelector('#pg-next').onclick = () => { st.page++; renderList(); };
      }
      pager.querySelector('#pg-size').onclick = () => showLocalSettings(reloadWithSettings);
    }

    function reloadWithSettings() {
      const l = localSettings.get();
      st.layout = l.layout;
      st.pageSize = l.pageSize;
      st.selectMode = !!l.showCheckbox;
      st.sortBy = l.sortBy;
      st.sortOrder = l.sortOrder;
      st.cardSize = l.cardSize || 'medium';
      st.nameOverflow = l.nameOverflow || 'ellipsis';
      st.showCount = l.showCount !== false;
      st.page = 1;
      renderToolbar();
      renderList();
    }

    function toggleSelect(name) {
      if (st.selected.has(name)) st.selected.delete(name);
      else st.selected.add(name);
      renderList();
    }

    async function load(refresh) {
      try {
        const d = await api('api/fs/list', { method: 'POST', body: { path: st.path, password: sharePwd(st.path), page: 1, per_page: 1000, refresh: !!refresh } });
        st.list = (d && d.content) || [];
        st.write = !!(d && d.write);
        st.total = (d && d.total) || st.list.length;
        const names = new Set(st.list.map((o) => o.name));
        Array.from(st.selected).forEach((n) => { if (!names.has(n)) st.selected.delete(n); });
        renderToolbar();
        renderList();
      } catch (e) {
        area.innerHTML = '<div class="browser-empty">' + fmt.esc(errText(e)) + '</div>';
      }
    }

    window.__activeBrowser = {
      path: st.path,
      get write() { return st.write; },
      reload: () => load(true),
      applySettings: reloadWithSettings,
      onDrop: (files) => uploadFiles(files, st.path, false, () => load(true)),
    };

    renderToolbar();
    await load();
  }

  /* ------------------------- 工具栏菜单与弹窗 ------------------------- */

  function popupMenu(anchor, itemsHtml) {
    document.querySelectorAll('.menu').forEach((m) => m.remove());
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.innerHTML = itemsHtml;
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth || 200;
    const mh = menu.offsetHeight || 0;
    let top = r.bottom + window.scrollY + 6;
    // 下方放不下就向上弹出，避免菜单被视口或弹窗底部裁掉
    if (mh && r.bottom + 6 + mh > window.innerHeight - 8) {
      top = Math.max(8, r.top + window.scrollY - mh - 6);
    }
    menu.style.top = top + 'px';
    menu.style.left = Math.max(8, Math.min(r.left + window.scrollX, window.innerWidth - mw - 10)) + 'px';
    setTimeout(() => {
      const off = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', off); } };
      document.addEventListener('mousedown', off);
    }, 0);
    return menu;
  }

  function showNewMenu(anchor, dir, done) {
    const menu = popupMenu(anchor,
      '<button class="menu-item" data-k="folder">' + icon('i-folder-plus') + '新建文件夹</button>' +
      '<button class="menu-item" data-k="file">' + icon('i-file-plus') + '新建文本文件</button>');
    menu.querySelector('[data-k=folder]').onclick = () => { menu.remove(); showMkdir(dir, done); };
    menu.querySelector('[data-k=file]').onclick = () => { menu.remove(); showNewFile(dir, done); };
  }

  function showMoreMenu(anchor, st, done) {
    const menu = popupMenu(anchor,
      '<button class="menu-item" data-k="refresh">' + icon('i-refresh') + '刷新目录</button>' +
      (st.write ? '<button class="menu-item" data-k="empty">' + icon('i-trash') + '移除空文件夹</button>' : '') +
      (st.write ? '<div class="menu-sep"></div><button class="menu-item" data-k="agg">' + icon('i-move') + '聚合移动（合并目录内容）</button>' : '') +
      '<div class="menu-sep"></div>' +
      '<button class="menu-item" data-k="local">' + icon('i-settings2') + '本地设置</button>' +
      (isAdmin() ? '<button class="menu-item" data-k="admin">' + icon('i-shield') + '存储管理</button>' : ''));
    menu.querySelector('[data-k=refresh]').onclick = () => { menu.remove(); done && done(true); };
    const empty = menu.querySelector('[data-k=empty]');
    if (empty) empty.onclick = () => { menu.remove(); removeEmptyDirs(st, done); };
    const agg = menu.querySelector('[data-k=agg]');
    if (agg) agg.onclick = () => { menu.remove(); showMoveCopy(st, 'aggregate', done); };
    menu.querySelector('[data-k=local]').onclick = () => {
      menu.remove();
      showLocalSettings(() => {
        const b = window.__activeBrowser;
        if (b && b.applySettings) b.applySettings();
      });
    };
    const adm = menu.querySelector('[data-k=admin]');
    if (adm) adm.onclick = () => { menu.remove(); go('#/admin/storage'); };
  }

  function showFileMenu(anchor, fullPath, isDir, st, done) {
    const items = [];
    items.push(isDir
      ? '<button class="menu-item" data-k="open">' + icon('i-folder') + '打开</button>'
      : '<button class="menu-item" data-k="preview">' + icon('i-video') + '预览</button>');
    if (!isDir) items.push('<button class="menu-item" data-k="download">' + icon('i-download') + '下载</button>');
    items.push('<button class="menu-item" data-k="share">' + icon('i-link') + '创建分享</button>');
    items.push('<button class="menu-item" data-k="copylink">' + icon('i-qr') + '直链 / 二维码</button>');
    if (st.write) {
      items.push('<div class="menu-sep"></div>');
      items.push('<button class="menu-item" data-k="rename">' + icon('i-edit') + '重命名</button>');
      items.push('<button class="menu-item" data-k="move">' + icon('i-move') + '移动到…</button>');
      items.push('<button class="menu-item" data-k="copy">' + icon('i-copy') + '复制到…</button>');
      items.push('<button class="menu-item" data-k="del">' + icon('i-trash') + '删除</button>');
    }
    const menu = popupMenu(anchor, items.join(''));
    const bind = (k, fn) => { const el = menu.querySelector('[data-k=' + k + ']'); if (el) el.onclick = () => { menu.remove(); fn(); }; };
    bind('open', () => go('#/browse?path=' + encodeURIComponent(fullPath)));
    bind('preview', () => showPreview(fullPath, done));
    bind('download', () => download(fullPath));
    bind('share', () => showShareCreate(fullPath));
    bind('copylink', () => showLinkDialog(fullPath));
    bind('rename', () => showRename(fullPath, done));
    bind('move', () => showMoveCopy(st, 'move', done, [fullPath]));
    bind('copy', () => showMoveCopy(st, 'copy', done, [fullPath]));
    bind('del', () => removeFile(fullPath, done));
  }

  function promptDialog(title, label, defaultValue, iconId) {
    return new Promise((resolve) => {
      Modal.open('' +
        '<div class="modal-head"><h3>' + fmt.esc(title) + '</h3><button class="icon-btn" data-close>' + icon('i-close') + '</button></div>' +
        '<div class="modal-body"><div class="field"><label>' + fmt.esc(label) + '</label>' +
        '<input class="input" id="pd-input" value="' + fmt.esc(defaultValue || '') + '"></div></div>' +
        '<div class="modal-foot"><button class="btn" data-close>取消</button>' +
        '<button class="btn primary" id="pd-ok">' + (iconId ? icon('i-' + iconId) : '') + '确定</button></div>',
        {
          onMount(mask) {
            const input = mask.querySelector('#pd-input');
            const submit = () => {
              const v = input.value.trim();
              if (!v) return;
              Modal.close();
              resolve(v);
            };
            setTimeout(() => { input.focus(); input.select(); }, 40);
            mask.querySelector('#pd-ok').onclick = submit;
            input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
          },
        });
    });
  }

  async function showMkdir(dir, done) {
    const name = await promptDialog('新建文件夹', '文件夹名称', '', 'folder');
    if (!name) return;
    try {
      await api('api/fs/mkdir', { method: 'POST', body: { path: joinPath(dir, name) } });
      toast('已创建', 'ok');
      done && done();
    } catch (e) { toastErr(e); }
  }

  async function showNewFile(dir, done) {
    const name = await promptDialog('新建文本文件', '文件名（建议带扩展名，如 notes.md）', '新建文本.txt', 'file');
    if (!name) return;
    try {
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', App.BASE + 'api/fs/put');
        if (store.token) xhr.setRequestHeader('Authorization', store.token);
        xhr.setRequestHeader('File-Path', fmt.encodePath(joinPath(dir, name)));
        xhr.setRequestHeader('As-Task', 'false');
        xhr.setRequestHeader('Overwrite', 'false');
        xhr.setRequestHeader('Content-Type', 'text/plain; charset=utf-8');
        xhr.onload = () => {
          try {
            const r = JSON.parse(xhr.responseText || '{}');
            if (xhr.status === 200 && r.code === 200) resolve();
            else reject(new Error(r.message || ('HTTP ' + xhr.status)));
          } catch (e) { reject(new Error('HTTP ' + xhr.status)); }
        };
        xhr.onerror = () => reject(new Error('网络错误'));
        xhr.send(new Blob([''], { type: 'text/plain;charset=utf-8' }));
      });
      toast('已创建', 'ok');
      done && done();
    } catch (e) { toastErr(e); }
  }

  function showMoveCopy(st, mode, done, explicitPaths) {
    const paths = explicitPaths || Array.from(st.selected).map((n) => joinPath(st.path, n));
    if (!paths.length) { toast('请先选择文件', 'err'); return; }
    const label = mode === 'copy' ? '复制到' : (mode === 'aggregate' ? '聚合移动到' : '移动到');
    const hint = mode === 'aggregate'
      ? '将所选目录内的内容合并移动到目标目录（源目录保留为空）'
      : '目标目录路径，例如 /目标目录';
    Modal.open('' +
      '<div class="modal-head"><h3>' + label + '</h3><button class="icon-btn" data-close>' + icon('i-close') + '</button></div>' +
      '<div class="modal-body">' +
      '<div class="field"><label>' + label + '（目录路径）</label><input class="input" id="mv-dst" placeholder="/" value="/"></div>' +
      '<p class="muted" style="font-size:12px;margin:0">' + fmt.esc(hint) + '<br>共 ' + paths.length + ' 项</p>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn" data-close>取消</button><button class="btn primary" id="mv-ok">开始</button></div>',
      {
        onMount(mask) {
          const input = mask.querySelector('#mv-dst');
          setTimeout(() => input.focus(), 40);
          mask.querySelector('#mv-ok').onclick = async () => {
            let dst = input.value.trim() || '/';
            if (!dst.startsWith('/')) dst = '/' + dst;
            const btn = mask.querySelector('#mv-ok');
            btn.disabled = true;
            try {
              // 目标目录不存在时自动创建
              try { await api('api/fs/mkdir', { method: 'POST', body: { path: dst } }); } catch (e) { /* 已存在则忽略 */ }
              if (mode === 'aggregate') {
                for (const p of paths) {
                  if (!p) continue;
                  const d = await api('api/fs/list', { method: 'POST', body: { path: p, page: 1, per_page: 1000 } });
                  const names = ((d && d.content) || []).map((o) => o.name);
                  if (names.length) {
                    await api('api/fs/move', { method: 'POST', body: { src_dir: p, dst_dir: dst, names, overwrite: true } });
                  }
                }
                toast('聚合移动完成', 'ok');
              } else {
                const byDir = {};
                paths.forEach((p) => {
                  const dir = parentOf(p);
                  (byDir[dir] = byDir[dir] || []).push(baseName(p));
                });
                for (const dir of Object.keys(byDir)) {
                  await api('api/fs/' + mode, { method: 'POST', body: { src_dir: dir, dst_dir: dst, names: byDir[dir], overwrite: true } });
                }
                toast(mode === 'copy' ? '已复制' : '已移动', 'ok');
              }
              Modal.close();
              st.selected.clear();
              done && done();
            } catch (e) { toastErr(e); } finally { btn.disabled = false; }
          };
        },
      });
  }

  function showBatchRename(st, done) {
    const names = Array.from(st.selected);
    if (!names.length) { toast('请先选择文件', 'err'); return; }

    Modal.open('' +
      '<div class="modal-head"><h3>批量重命名</h3><button class="icon-btn" data-close>' + icon('i-close') + '</button></div>' +
      '<div class="modal-body">' +
      '<div class="ls-group" style="padding-top:0">' +
      '<div class="ls-title">方式一：查找替换（支持正则）</div>' +
      '<div class="form-row">' +
      '<div class="field"><label>查找</label><input class="input" id="br-src" placeholder="例如 ^IMG_"></div>' +
      '<div class="field"><label>替换为</label><input class="input" id="br-dst" placeholder="例如 PHOTO_"></div>' +
      '</div>' +
      '<button class="btn sm" id="br-regex">按正则预览</button>' +
      '</div>' +

      '<div class="ls-group">' +
      '<div class="ls-title">方式二：统一序号</div>' +
      '<div class="form-row">' +
      '<div class="field"><label>文件名前缀</label><input class="input" id="br-prefix" placeholder="例如 PHOTO_"></div>' +
      '<div class="field"><label>起始序号</label><input class="input" id="br-start" type="number" min="0" value="1"></div>' +
      '<div class="field"><label>序号位数</label><input class="input" id="br-pad" type="number" min="1" max="8" value="3"></div>' +
      '</div>' +
      '<button class="btn sm" id="br-seq">按序号预览</button>' +
      '<div class="help">保留原扩展名；按当前排序顺序编号。</div>' +
      '</div>' +

      '<div class="ls-title" style="margin:4px 0 8px">预览（可直接修改）</div>' +
      '<div style="max-height:240px;overflow:auto;border:1px solid var(--line);border-radius:10px">' +
      names.map((n, i) => '<div style="display:flex;gap:8px;align-items:center;padding:6px 10px;border-bottom:1px solid var(--line)">' +
        '<span class="mono" style="flex:1;overflow:hidden;text-overflow:ellipsis">' + fmt.esc(n) + '</span>' +
        '<input class="input" data-new="' + i + '" value="' + fmt.esc(n) + '" style="width:200px;height:30px"></div>').join('') +
      '</div></div>' +
      '<div class="modal-foot"><button class="btn" data-close>取消</button>' +
      '<button class="btn" id="br-reset">还原</button>' +
      '<button class="btn primary" id="br-ok">应用</button></div>',
      {
        size: 'wide',
        onMount(mask) {
          const inputs = () => Array.from(mask.querySelectorAll('[data-new]'));
          const reset = () => inputs().forEach((inp, i) => { inp.value = names[i]; });

          mask.querySelector('#br-reset').onclick = reset;

          mask.querySelector('#br-regex').onclick = () => {
            const src = mask.querySelector('#br-src').value;
            const dst = mask.querySelector('#br-dst').value;
            if (!src) { toast('请填写查找内容', 'err'); return; }
            let re;
            try { re = new RegExp(src); } catch (e) { toast('正则不合法', 'err'); return; }
            inputs().forEach((inp, i) => { inp.value = names[i].replace(re, dst); });
          };

          mask.querySelector('#br-seq').onclick = () => {
            const prefix = mask.querySelector('#br-prefix').value;
            const startNo = parseInt(mask.querySelector('#br-start').value, 10) || 0;
            const pad = Math.min(8, Math.max(1, parseInt(mask.querySelector('#br-pad').value, 10) || 3));
            inputs().forEach((inp, i) => {
              const nm = names[i];
              const dot = nm.lastIndexOf('.');
              const ext = dot > 0 ? nm.slice(dot) : '';
              inp.value = prefix + String(startNo + i).padStart(pad, '0') + ext;
            });
          };

          mask.querySelector('#br-ok').onclick = async () => {
            const list = inputs().map((inp, i) => ({ src_name: names[i], new_name: inp.value.trim() }));
            if (list.some((x) => !x.new_name)) { toast('新名称不能为空', 'err'); return; }
            if (list.every((x) => x.src_name === x.new_name)) { Modal.close(); return; }
            const btn = mask.querySelector('#br-ok');
            btn.disabled = true;
            try {
              await api('api/fs/batch_rename', { method: 'POST', body: { src_dir: st.path, rename_objects: list } });
              toast('重命名完成', 'ok');
              Modal.close();
              st.selected.clear();
              done && done();
            } catch (e) { toastErr(e); } finally { btn.disabled = false; }
          };
        },
      });
  }

  async function removeEmptyDirs(st, done) {
    const ok = await confirmDialog('移除空文件夹', '将递归删除「' + st.path + '」下所有空目录，确定继续？', true);
    if (!ok) return;
    try {
      await api('api/fs/remove_empty_directory', { method: 'POST', body: { src_dir: st.path } });
      toast('已清理空文件夹', 'ok');
      done && done(true);
    } catch (e) { toastErr(e); }
  }

  async function batchRemove(st, done) {
    const names = Array.from(st.selected);
    if (!names.length) return;
    const ok = await confirmDialog('删除确认', '确定删除已选的 ' + names.length + ' 项吗？此操作不可撤销。', true);
    if (!ok) return;
    try {
      await api('api/fs/remove', { method: 'POST', body: { dir: st.path, names } });
      toast('已删除', 'ok');
      st.selected.clear();
      done && done();
    } catch (e) { toastErr(e); }
  }

  async function removeFile(fullPath, done) {
    const ok = await confirmDialog('删除确认', '确定要删除「' + baseName(fullPath) + '」吗？此操作不可撤销。', true);
    if (!ok) return;
    try {
      await api('api/fs/remove', { method: 'POST', body: { dir: parentOf(fullPath), names: [baseName(fullPath)] } });
      toast('已删除', 'ok');
      done && done();
    } catch (e) { toastErr(e); }
  }

  function showRename(fullPath, done) {
    const old = baseName(fullPath);
    Modal.open('' +
      '<div class="modal-head"><h3>重命名</h3><button class="icon-btn" data-close>' + icon('i-close') + '</button></div>' +
      '<div class="modal-body"><div class="field"><label>新名称</label><input class="input" id="rn-name" value="' + fmt.esc(old) + '"></div></div>' +
      '<div class="modal-foot"><button class="btn" data-close>取消</button><button class="btn primary" id="rn-ok">保存</button></div>',
      {
        onMount(mask) {
          const input = mask.querySelector('#rn-name');
          setTimeout(() => { input.focus(); input.select(); }, 40);
          mask.querySelector('#rn-ok').onclick = async () => {
            const name = input.value.trim();
            if (!name || name === old) { Modal.close(); return; }
            try {
              await api('api/fs/rename', { method: 'POST', body: { path: fullPath, name } });
              toast('已重命名', 'ok');
              Modal.close();
              done && done();
            } catch (e) { toastErr(e); }
          };
        },
      });
  }

  function showLocalSettings(afterSave) {
    const l = localSettings.get();
    const opt = (v, cur, label) => '<option value="' + v + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + label + '</option>';

    Modal.open('' +
      '<div class="modal-head"><h3>本地设置</h3><button class="icon-btn" data-close>' + icon('i-close') + '</button></div>' +
      '<div class="modal-body ls-body">' +

      '<div class="ls-group"><div class="ls-title">浏览</div>' +
      '<div class="form-row">' +
      '<div class="field"><label>默认布局</label><select class="select" id="ls-layout">' +
      opt('list', l.layout, '列表') + opt('grid', l.layout, '网格') + '</select></div>' +
      '<div class="field"><label>每页数量</label><select class="select" id="ls-size">' +
      [30, 50, 100, 200, 0].map((n) => opt(n, l.pageSize, n === 0 ? '全部显示' : n + ' 项')).join('') + '</select></div>' +
      '</div>' +
      '<div class="form-row">' +
      '<div class="field"><label>排序字段</label><select class="select" id="ls-sort">' +
      opt('name', l.sortBy, '名称') + opt('size', l.sortBy, '大小') + opt('modified', l.sortBy, '修改时间') + '</select></div>' +
      '<div class="field"><label>排序方向</label><select class="select" id="ls-order">' +
      opt('asc', l.sortOrder, '升序') + opt('desc', l.sortOrder, '降序') + '</select></div>' +
      '</div>' +
      '<div class="form-row">' +
      '<div class="field"><label>网格视图项目大小</label><select class="select" id="ls-card">' +
      opt('small', l.cardSize, '小') + opt('medium', l.cardSize, '中') + opt('large', l.cardSize, '大') + '</select></div>' +
      '<div class="field"><label>列表文件名过长</label><select class="select" id="ls-overflow">' +
      opt('ellipsis', l.nameOverflow, '省略号') + opt('wrap', l.nameOverflow, '换行显示') + opt('scroll', l.nameOverflow, '横向滚动') + '</select></div>' +
      '</div>' +
      '<label class="check"><input type="checkbox" id="ls-count"' + (l.showCount !== false ? ' checked' : '') + '>显示文件计数信息</label>' +
      '</div>' +

      '<div class="ls-group"><div class="ls-title">操作</div>' +
      '<label class="check"><input type="checkbox" id="ls-check"' + (l.showCheckbox ? ' checked' : '') + '>总是显示复选框</label>' +
      '<div class="help">勾选后进入目录即显示选择框；不勾选时点击工具栏「选择」临时开启。</div>' +
      '</div>' +

      '<div class="ls-group"><div class="ls-title">文本预览</div>' +
      '<div class="form-row">' +
      '<div class="field"><label>编辑器字体大小</label><select class="select" id="ls-tsize">' +
      [12, 13, 14, 15, 16].map((n) => opt(n, l.textSize, n + ' px')).join('') + '</select></div>' +
      '</div>' +
      '<label class="check"><input type="checkbox" id="ls-twrap"' + (l.textWrap !== false ? ' checked' : '') + '>自动换行</label>' +
      '</div>' +

      '<p class="muted" style="font-size:12px;margin:14px 0 0">以上设置只保存在当前浏览器，不影响其他用户。</p>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn" data-close>取消</button>' +
      '<button class="btn" id="ls-reset">恢复默认</button>' +
      '<button class="btn primary" id="ls-save">保存</button></div>',
      {
        onMount(mask) {
          mask.querySelector('#ls-reset').onclick = () => {
            localSettings.set({
              layout: 'list', pageSize: 30, sortBy: 'name', sortOrder: 'asc', showCheckbox: false,
              cardSize: 'medium', nameOverflow: 'ellipsis', showCount: true, textSize: 13, textWrap: true,
            });
            Modal.close();
            toast('已恢复默认设置', 'ok');
            afterSave && afterSave();
          };
          mask.querySelector('#ls-save').onclick = () => {
            localSettings.set({
              layout: mask.querySelector('#ls-layout').value,
              pageSize: parseInt(mask.querySelector('#ls-size').value, 10),
              sortBy: mask.querySelector('#ls-sort').value,
              sortOrder: mask.querySelector('#ls-order').value,
              cardSize: mask.querySelector('#ls-card').value,
              nameOverflow: mask.querySelector('#ls-overflow').value,
              showCount: mask.querySelector('#ls-count').checked,
              showCheckbox: mask.querySelector('#ls-check').checked,
              textSize: parseInt(mask.querySelector('#ls-tsize').value, 10),
              textWrap: mask.querySelector('#ls-twrap').checked,
            });
            Modal.close();
            toast('已保存本地设置', 'ok');
            afterSave && afterSave();
          };
        },
      });
  }

  /* ------------------------- 上传 ------------------------- */

  function pickUpload(dir, done) {
    Modal.open('' +
      '<div class="modal-head"><h3>上传文件</h3><button class="icon-btn" data-close>' + icon('i-close') + '</button></div>' +
      '<div class="modal-body">' +
      '<div class="field"><label>选择文件（可多选，也可以直接把文件拖到页面任意位置）</label>' +
      '<input class="input" type="file" id="up-files" multiple style="height:auto;padding:9px"></div>' +
      '<div class="field"><label>上传方式</label>' +
      '<label class="check" style="margin-bottom:6px"><input type="radio" name="up-mode" value="direct" checked>直接上传（实时显示进度与速度）</label>' +
      '<label class="check"><input type="radio" name="up-mode" value="task">作为后台上传任务（关闭页面也会继续）</label>' +
      '</div>' +
      '</div>' +
      '<div class="modal-foot"><button class="btn" data-close>取消</button><button class="btn primary" id="up-ok">开始上传</button></div>',
      {
        onMount(mask) {
          mask.querySelector('#up-ok').onclick = () => {
            const files = Array.from(mask.querySelector('#up-files').files || []);
            if (!files.length) { toast('请选择文件', 'err'); return; }
            const asTask = mask.querySelector('input[name=up-mode]:checked').value === 'task';
            Modal.close();
            uploadFiles(files, dir, asTask, done);
          };
        },
      });
  }

  function uploadFiles(files, dir, asTask, done) {
    if (!files.length) return;
    Uploader.onDone = done || null;
    Uploader.enqueue(files, dir, asTask);
    toast('已加入传输列表（' + files.length + ' 个文件）', 'ok');
  }

  /* ------------------------- 搜索 ------------------------- */

  function showSearch(parent) {
    Modal.open('' +
      '<div class="modal-head"><h3>搜索</h3><button class="icon-btn" data-close>' + icon('i-close') + '</button></div>' +
      '<div class="modal-body">' +
      '<div class="field"><label>关键词</label><input class="input" id="sc-kw" placeholder="文件名关键词"></div>' +
      '<div id="sc-result" class="muted" style="font-size:13px"></div></div>' +
      '<div class="modal-foot"><button class="btn" data-close>关闭</button><button class="btn primary" id="sc-ok">' + icon('i-search') + '搜索</button></div>',
      {
        size: 'wide',
        onMount(mask) {
          const input = mask.querySelector('#sc-kw');
          const result = mask.querySelector('#sc-result');
          setTimeout(() => input.focus(), 40);
          const doSearch = async () => {
            const kw = input.value.trim();
            if (!kw) return;
            result.innerHTML = '搜索中…';
            try {
              const r = await api('api/fs/search', {
                method: 'POST',
                body: { parent, keywords: kw, scope: 0, page: 1, per_page: 100 },
              });
              const content = (r && r.content) || [];
              if (!content.length) { result.innerHTML = '没有找到匹配的文件'; return; }
              result.innerHTML = '<div class="table-wrap"><table class="data"><tbody>' + content.map((o) => {
                const p = (o.parent === '/' ? '' : o.parent) + '/' + o.name;
                return '<tr><td>' + fileIcon(o) + '<a href="javascript:void(0)" data-sp="' + fmt.esc(p) + '" data-dir="' + (o.is_dir ? 1 : 0) + '" style="margin-left:10px">' +
                  fmt.esc(o.name) + '</a><div class="mono">' + fmt.esc(o.parent) + '</div></td><td class="muted" style="width:100px">' + (o.is_dir ? '文件夹' : fmt.size(o.size)) + '</td></tr>';
              }).join('') + '</tbody></table></div>';
              result.querySelectorAll('[data-sp]').forEach((el) => {
                el.onclick = () => {
                  Modal.close();
                  const p = el.getAttribute('data-sp');
                  if (el.getAttribute('data-dir') === '1') go('#/browse?path=' + encodeURIComponent(p));
                  else showPreview(p);
                };
              });
            } catch (e) { result.textContent = errText(e); }
          };
          mask.querySelector('#sc-ok').onclick = doSearch;
          input.onkeydown = (e) => { if (e.key === 'Enter') doSearch(); };
        },
      });
  }

  /* ------------------------- 下载与链接 ------------------------- */

  /* ---------------- 打包下载（浏览器端生成 zip，无需服务端归档） ---------------- */

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function dosDateTime(d) {
    const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31);
    const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
    return { time, date };
  }

  // 生成 store（不压缩）zip；结构简单，兼容所有解压工具
  function buildZip(entries) {
    const enc = new TextEncoder();
    const now = dosDateTime(new Date());
    const parts = [];
    const central = [];
    let offset = 0;

    entries.forEach((e) => {
      const nameBytes = enc.encode(e.name);
      const crc = e.data.length ? crc32(e.data) : 0;
      const lh = new Uint8Array(30 + nameBytes.length);
      const dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true);
      dv.setUint16(8, 0, true);
      dv.setUint16(10, now.time, true);
      dv.setUint16(12, now.date, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, e.data.length, true);
      dv.setUint32(22, e.data.length, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);

      const ch = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, now.time, true);
      cv.setUint16(14, now.date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, e.data.length, true);
      cv.setUint32(24, e.data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      ch.set(nameBytes, 46);

      parts.push(lh, e.data);
      central.push(ch);
      offset += lh.length + e.data.length;
    });

    const cdSize = central.reduce((n, c) => n + c.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    return new Blob(parts.concat(central, [eocd]), { type: 'application/zip' });
  }

  async function collectForZip(path, rel, out) {
    const d = await api('api/fs/list', { method: 'POST', body: { path, page: 1, per_page: 1000, password: sharePwd(path) } });
    for (const o of (d && d.content) || []) {
      const p = joinPath(path, o.name);
      const r = rel ? rel + '/' + o.name : o.name;
      if (o.is_dir) {
        out.dirs.push(r + '/');
        await collectForZip(p, r, out);
      } else {
        out.files.push({ path: p, rel: r, size: o.size });
      }
    }
  }

  async function packageDownload(paths, title) {
    const mask = Modal.open('' +
      '<div class="modal-head"><h3>打包下载</h3><button class="icon-btn" data-close>' + icon('i-close') + '</button></div>' +
      '<div class="modal-body"><div id="zip-status" class="muted">正在统计文件…</div>' +
      '<div class="bar" style="height:6px;border-radius:6px;background:var(--bg-soft);margin-top:12px;overflow:hidden">' +
      '<i id="zip-bar" style="display:block;height:100%;width:0;background:var(--brand);transition:width .15s"></i></div></div>' +
      '<div class="modal-foot"><button class="btn" id="zip-cancel">取消</button></div>', { dismissable: false });

    const status = mask.querySelector('#zip-status');
    const bar = mask.querySelector('#zip-bar');
    let canceled = false;
    mask.querySelector('#zip-cancel').onclick = () => { canceled = true; Modal.close(); };

    try {
      const out = { files: [], dirs: [] };
      for (const p of paths) {
        const meta = await fileMeta(p);
        if (meta.is_dir) {
          out.dirs.push((meta.name || baseName(p)) + '/');
          await collectForZip(p, meta.name || baseName(p), out);
        } else {
          out.files.push({ path: p, rel: meta.name || baseName(p), size: meta.size });
        }
      }
      if (!out.files.length) { toast('所选内容没有文件', 'err'); Modal.close(); return; }

      const entries = [];
      out.dirs.forEach((d) => entries.push({ name: d, data: new Uint8Array(0) }));
      let done = 0;
      const totalBytes = out.files.reduce((n, f) => n + (f.size || 0), 0);
      let loadedBytes = 0;

      for (const f of out.files) {
        if (canceled) return;
        status.textContent = '正在读取 ' + (done + 1) + '/' + out.files.length + '：' + f.rel + (totalBytes ? '（' + fmt.size(loadedBytes) + ' / ' + fmt.size(totalBytes) + '）' : '');
        const url = await directLink(f.path);
        const res = await fetch(url, { headers: store.token ? { Authorization: store.token } : {} });
        if (!res.ok) throw new Error('读取失败：' + f.rel + '（HTTP ' + res.status + '）');
        const data = new Uint8Array(await res.arrayBuffer());
        entries.push({ name: f.rel, data });
        loadedBytes += data.length;
        done++;
        bar.style.width = Math.round((done / out.files.length) * 100) + '%';
      }

      status.textContent = '正在生成压缩包…';
      const blob = buildZip(entries);
      const name = (title || '打包下载').replace(/[\\/:*?"<>|]/g, '_') + '_' + fmt.date(Date.now()).replace(/-/g, '') + '.zip';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 8000);
      Modal.close();
      toast('已生成 ' + name + '（' + fmt.size(blob.size) + '）', 'ok');
    } catch (e) {
      Modal.close();
      toastErr(e);
    }
  }

  async function download(path) {
    try {
      const meta = await fileMeta(path);
      const url = meta.raw_url && /^https?:/.test(meta.raw_url) ? meta.raw_url : rawUrl(path, meta.sign);
      const a = document.createElement('a');
      a.href = url;
      a.download = meta.name || '';
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) { toastErr(e); }
  }

  async function directLink(path) {
    const meta = await fileMeta(path);
    return meta.raw_url && /^https?:/.test(meta.raw_url) ? meta.raw_url : rawUrl(path, meta.sign);
  }

  async function showLinkDialog(path) {
    try {
      const link = await directLink(path);
      Modal.open('' +
        '<div class="modal-head"><h3>文件链接</h3><button class="icon-btn" data-close>' + icon('i-close') + '</button></div>' +
        '<div class="modal-body">' +
        '<div class="qr-box"><img src="' + qrcodeUrl(link, 240) + '" alt="二维码">' +
        '<div style="flex:1;min-width:220px">' +
        '<div class="field"><label>直链地址</label><input class="input" id="ld-url" value="' + fmt.esc(link) + '" readonly></div>' +
        '<p class="muted" style="font-size:12px;margin:0">该链接带签名，可直接交给下载工具或其他播放器使用。签名有效期由「设置 → 全局 → 直链有效期」控制。</p>' +
        '</div></div></div>' +
        '<div class="modal-foot"><button class="btn" data-close>关闭</button>' +
        '<button class="btn" id="ld-open">' + icon('i-external') + '打开</button>' +
        '<button class="btn primary" id="ld-copy">复制链接</button></div>',
        {
          size: 'wide',
          onMount(mask) {
            mask.querySelector('#ld-copy').onclick = () => {
              copyText(link).then(() => toast('已复制', 'ok')).catch(() => toast('复制失败', 'err'));
            };
            mask.querySelector('#ld-open').onclick = () => window.open(link, '_blank', 'noopener');
          },
        });
    } catch (e) { toastErr(e); }
  }

  function showShareCreate(fullPath) {
    Modal.open('' +
      '<div class="modal-head"><h3>创建分享</h3><button class="icon-btn" data-close>' + icon('i-close') + '</button></div>' +
      '<div class="modal-body">' +
      '<div class="field"><label>分享路径</label><input class="input" value="' + fmt.esc(fullPath) + '" readonly></div>' +
      '<div class="form-row">' +
      '<div class="field"><label>提取码（留空则无）</label><input class="input" id="sh-pwd" maxlength="8" placeholder="可选"></div>' +
      '<div class="field"><label>有效期（天，留空永久）</label><input class="input" id="sh-days" type="number" min="0" placeholder="可选"></div>' +
      '</div></div>' +
      '<div class="modal-foot"><button class="btn" data-close>取消</button><button class="btn primary" id="sh-ok">创建分享</button></div>',
      {
        onMount(mask) {
          mask.querySelector('#sh-ok').onclick = async () => {
            const pwd = mask.querySelector('#sh-pwd').value.trim();
            const days = parseInt(mask.querySelector('#sh-days').value, 10);
            const body = { files: [fullPath], pwd, disabled: false };
            if (days > 0) body.expires = new Date(Date.now() + days * 86400000).toISOString();
            try {
              const r = await api('api/share/create', { method: 'POST', body });
              const id = (r && r.id) || '';
              const link = location.origin + App.BASE + '@s/' + id + (pwd ? '?pwd=' + encodeURIComponent(pwd) : '');
              Modal.close();
              Modal.open('' +
                '<div class="modal-head"><h3>分享已创建</h3><button class="icon-btn" data-close>' + icon('i-close') + '</button></div>' +
                '<div class="modal-body"><div class="qr-box"><img src="' + qrcodeUrl(link, 220) + '" alt="二维码">' +
                '<div style="flex:1;min-width:220px"><div class="field"><label>分享链接</label>' +
                '<input class="input" id="sh-link" value="' + fmt.esc(link) + '" readonly></div>' +
                (pwd ? '<p class="muted" style="font-size:12px;margin:0">提取码：<b>' + fmt.esc(pwd) + '</b></p>' : '') +
                '</div></div></div>' +
                '<div class="modal-foot"><button class="btn" id="sh-copy">复制链接</button><button class="btn primary" data-close>完成</button></div>',
                {
                  onMount(m2) {
                    m2.querySelector('#sh-copy').onclick = () => {
                      copyText(link).then(() => toast('已复制', 'ok')).catch(() => toast('复制失败', 'err'));
                    };
                  },
                });
            } catch (e) { toastErr(e); }
          };
        },
      });
  }

  /* ------------------------------------------------------------------ *
   * 预览
   * ------------------------------------------------------------------ */
  async function showPreview(path) {
    let meta;
    try {
      meta = await fileMeta(path);
    } catch (e) { toastErr(e); return; }
    if (meta.is_dir) { go('#/browse?path=' + encodeURIComponent(path)); return; }

    const url = rawUrl(path, meta.sign);
    const e = ext(meta.name);
    const type = meta.type;
    let stage = '';
    let size = '';

    if (type === 5 || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico'].includes(e)) {
      size = 'xwide';
      stage = '<div class="image-stage" id="img-stage"><img id="pv-img" src="' + url + '" alt="' + fmt.esc(meta.name) + '"></div>';
    } else if (type === 2 || ['mp4', 'webm', 'mkv', 'mov', 'm3u8', 'avi'].includes(e)) {
      size = 'xwide';
      stage = videoStage(url, boolSetting('video_autoplay', true));
    } else if (type === 3 || ['mp3', 'flac', 'wav', 'm4a', 'ogg', 'opus'].includes(e)) {
      size = 'wide';
      stage = '<div class="audio-box">' +
        '<img class="audio-cover" src="' + fmt.esc(abs(S.settings.audio_cover || '/assets/images/audio-cover.svg')) + '" alt="封面">' +
        '<div class="audio-title">' + fmt.esc(meta.name) + '</div>' +
        audioStage(url, boolSetting('audio_autoplay', true)) +
        '</div>';
    } else if (e === 'pdf') {
      size = 'xwide';
      stage = '<div class="preview-stage"><iframe src="' + url + '" title="PDF 预览"></iframe></div>';
    } else if (type === 4 || ['txt', 'md', 'json', 'js', 'css', 'html', 'xml', 'yml', 'yaml', 'go', 'py', 'sh', 'log', 'ini', 'conf'].includes(e)) {
      size = 'xwide';
      const tv = localSettings.get();
      stage = '<pre class="preview-text" id="preview-text" style="font-size:' + (tv.textSize || 13) + 'px;white-space:' + (tv.textWrap !== false ? 'pre-wrap' : 'pre') + '">正在加载…</pre>';
      fetch(url).then((r) => r.text()).then((t) => {
        const el = document.getElementById('preview-text');
        if (el) el.textContent = t.length > 512 * 1024 ? t.slice(0, 512 * 1024) + '\n\n…（内容过长，已截断）' : t;
      }).catch(() => {
        const el = document.getElementById('preview-text');
        if (el) el.textContent = '无法读取文本内容';
      });
    } else {
      stage = '<div class="preview-stage" style="background:#fff"><div class="browser-empty">该文件类型不支持在线预览<br><br>' +
        '<button class="btn primary" id="pv-download">下载文件</button></div></div>';
    }

    const isMedia = type === 2 || type === 3;
    const canOcr = (type === 5 || ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'tif', 'tiff'].includes(e));

    Modal.open('' +
      '<div class="modal-head"><h3 style="max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + fmt.esc(meta.name) + '</h3>' +
      '<button class="icon-btn" data-close>' + icon('i-close') + '</button></div>' +
      '<div class="modal-body flush">' + stage + '</div>' +
      '<div class="modal-foot" style="flex-wrap:wrap;gap:8px">' +
      '<span class="muted" style="margin-right:auto;font-size:12px">' + fmt.size(meta.size) + ' · ' + fmt.time(meta.modified) + '</span>' +
      (canOcr ? '<button class="btn" id="pv-ocr">' + icon('i-text') + '识别文字</button>' : '') +
      (isMedia ? '<button class="btn" id="pv-external">' + icon('i-external') + '外部播放器</button>' : '') +
      '<button class="btn" id="pv-link">' + icon('i-qr') + '链接 / 二维码</button>' +
      '<button class="btn" data-close>关闭</button>' +
      '<button class="btn primary" id="pv-download2">' + icon('i-download') + '下载</button>' +
      '</div>', {
      size,
      onMount(mask) {
        const dl = mask.querySelector('#pv-download2');
        if (dl) dl.onclick = () => download(path);
        const dl1 = mask.querySelector('#pv-download');
        if (dl1) dl1.onclick = () => download(path);
        const ocr = mask.querySelector('#pv-ocr');
        if (ocr) ocr.onclick = () => doOcr(path);
        const linkBtn = mask.querySelector('#pv-link');
        if (linkBtn) linkBtn.onclick = () => showLinkDialog(path);
        const extBtn = mask.querySelector('#pv-external');
        if (extBtn) extBtn.onclick = () => showOpenWith(extBtn, url, path, meta.name);
        initPlayers(mask, meta, url);
      },
    });
  }

  // 调用本机播放器打开：使用各播放器注册的 URL 协议（与原版「打开方式」一致）
  function showOpenWith(anchor, url, path, name) {
    const encoded = encodeURIComponent(url);
    const menu = popupMenu(anchor,
      '<button class="menu-item" data-k="sys">' + icon('i-external') + '系统默认程序（新标签打开）</button>' +
      '<div class="menu-sep"></div>' +
      '<button class="menu-item" data-k="pot">PotPlayer</button>' +
      '<button class="menu-item" data-k="vlc">VLC</button>' +
      '<button class="menu-item" data-k="mpv">mpv</button>' +
      '<button class="menu-item" data-k="iina">IINA（macOS）</button>' +
      '<div class="menu-sep"></div>' +
      '<button class="menu-item" data-k="copy">' + icon('i-link') + '复制直链</button>' +
      '<button class="menu-item" data-k="dl">' + icon('i-download') + '下载文件</button>');

    const bind = (k, fn) => {
      const el = menu.querySelector('[data-k=' + k + ']');
      if (el) el.onclick = () => { menu.remove(); fn(); };
    };
    bind('sys', () => window.open(url, '_blank', 'noopener'));
    // 协议调用失败时浏览器不会报错，只能提示用户确认已安装
    bind('pot', () => { location.href = 'potplayer://' + url; });
    bind('vlc', () => { location.href = 'vlc://' + url; });
    bind('mpv', () => { location.href = 'mpv://' + url; });
    bind('iina', () => { location.href = 'iina://weblink?url=' + encoded; });
    bind('copy', () => {
      copyText(url).then(() => toast('直链已复制', 'ok')).catch(() => toast('复制失败', 'err'));
    });
    bind('dl', () => download(path));
  }

  function videoStage(url, autoplay) {
    return '<div class="player" id="pv-player">' +
      '<video id="pv-video" src="' + url + '" playsinline preload="metadata"' + (autoplay ? ' autoplay' : '') + '></video>' +
      '<div class="player-bar">' +
      '<button class="pbtn" id="pv-play">' + icon('i-play') + '</button>' +
      '<span class="time" id="pv-time">00:00 / 00:00</span>' +
      '<input type="range" class="seek" id="pv-seek" min="0" max="1000" value="0">' +
      '<select id="pv-rate">' + [0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => '<option value="' + r + '"' + (r === 1 ? ' selected' : '') + '>' + r + 'x</option>').join('') + '</select>' +
      '<button class="pbtn" id="pv-mute" title="静音">' + icon('i-volume') + '</button>' +
      '<input type="range" class="vol" id="pv-vol" min="0" max="100" value="100" title="音量">' +
      '<button class="pbtn" id="pv-snap" title="截取当前画面">' + icon('i-camera') + '</button>' +
      '<button class="pbtn" id="pv-loop" title="循环播放">' + icon('i-repeat') + '</button>' +
      '<button class="pbtn" id="pv-pip" title="画中画">' + icon('i-pip') + '</button>' +
      '<button class="pbtn" id="pv-full" title="全屏">' + icon('i-fullscreen') + '</button>' +
      '</div></div>';
  }

  function audioStage(url, autoplay) {
    return '<div class="audio-player" id="pv-audio-wrap">' +
      '<audio id="pv-audio" src="' + url + '" preload="metadata"' + (autoplay ? ' autoplay' : '') + '></audio>' +
      '<div class="a-bar">' +
      '<button class="pbtn" id="pv-aplay">' + icon('i-play') + '</button>' +
      '<input type="range" class="seek" id="pv-aseek" min="0" max="1000" value="0">' +
      '<button class="pbtn" id="pv-amute" title="静音">' + icon('i-volume') + '</button>' +
      '<input type="range" class="vol" id="pv-avol" min="0" max="100" value="100" title="音量">' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center"><span class="time" id="pv-atime">00:00 / 00:00</span>' +
      '<span style="display:flex;gap:8px;align-items:center">' +
      '<button class="pbtn" id="pv-aloop" title="循环播放">' + icon('i-repeat') + '</button>' +
      '<select id="pv-arate" class="input" style="width:76px;height:26px;font-size:12px;padding:0 6px">' +
      [0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => '<option value="' + r + '"' + (r === 1 ? ' selected' : '') + '>' + r + 'x</option>').join('') +
      '</select></span></div></div>';
  }

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function initPlayers(mask, meta, url) {
    const video = mask.querySelector('#pv-video');
    if (video) {
      const wrap = mask.querySelector('#pv-player');
      const btn = mask.querySelector('#pv-play');
      const seek = mask.querySelector('#pv-seek');
      const time = mask.querySelector('#pv-time');
      const vol = mask.querySelector('#pv-vol');
      const mute = mask.querySelector('#pv-mute');
      const rate = mask.querySelector('#pv-rate');
      const sync = () => {
        btn.innerHTML = video.paused ? icon('i-play') : icon('i-pause');
        time.textContent = fmtTime(video.currentTime) + ' / ' + fmtTime(video.duration);
        if (!seek.dragging && video.duration) seek.value = Math.round((video.currentTime / video.duration) * 1000);
      };
      btn.onclick = () => { if (video.paused) video.play(); else video.pause(); };
      video.onplay = sync; video.onpause = sync; video.ontimeupdate = sync; video.onloadedmetadata = sync;
      seek.oninput = () => { if (video.duration) video.currentTime = (parseInt(seek.value, 10) / 1000) * video.duration; };
      seek.onmousedown = () => { seek.dragging = true; };
      seek.onmouseup = () => { seek.dragging = false; };
      vol.oninput = () => { video.volume = parseInt(vol.value, 10) / 100; video.muted = video.volume === 0; };
      mute.onclick = () => { video.muted = !video.muted; mute.innerHTML = video.muted ? icon('i-mute') : icon('i-volume'); };
      rate.onchange = () => { video.playbackRate = parseFloat(rate.value); };
      const loopBtn = mask.querySelector('#pv-loop');
      if (loopBtn) loopBtn.onclick = () => {
        video.loop = !video.loop;
        loopBtn.classList.toggle('on', video.loop);
        toast(video.loop ? '已开启循环播放' : '已关闭循环播放', 'ok');
      };
      const snapBtn = mask.querySelector('#pv-snap');
      if (snapBtn) snapBtn.onclick = () => {
        if (!video.videoWidth) { toast('画面尚未就绪', 'err'); return; }
        const c = document.createElement('canvas');
        c.width = video.videoWidth;
        c.height = video.videoHeight;
        c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
        c.toBlob((blob) => {
          if (!blob) { toast('截图失败', 'err'); return; }
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = (meta.name || 'frame').replace(/\.[^.]+$/, '') + '_' + fmtTime(video.currentTime).replace(/:/g, '-') + '.png';
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          toast('已保存当前画面', 'ok');
        }, 'image/png');
      };
      const pip = mask.querySelector('#pv-pip');
      pip.onclick = () => {
        if (video.requestPictureInPicture) video.requestPictureInPicture().catch(() => {});
        else toast('当前浏览器不支持画中画', 'err');
      };
      const full = mask.querySelector('#pv-full');
      full.onclick = () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else if (wrap.requestFullscreen) wrap.requestFullscreen();
      };
      mask.tabIndex = 0;
      mask.addEventListener('keydown', (ev) => {
        if (ev.key === ' ') { ev.preventDefault(); btn.click(); }
        if (ev.key === 'ArrowRight') video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
        if (ev.key === 'ArrowLeft') video.currentTime = Math.max(0, video.currentTime - 5);
      });
      let idleTimer;
      const wake = () => {
        wrap.classList.remove('idle');
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => { if (!video.paused) wrap.classList.add('idle'); }, 2600);
      };
      wrap.addEventListener('mousemove', wake);
      wrap.addEventListener('mouseleave', () => { if (!video.paused) wrap.classList.add('idle'); });
      wake();
    }

    const audio = mask.querySelector('#pv-audio');
    if (audio) {
      const btn = mask.querySelector('#pv-aplay');
      const seek = mask.querySelector('#pv-aseek');
      const time = mask.querySelector('#pv-atime');
      const rate = mask.querySelector('#pv-arate');
      const sync = () => {
        btn.innerHTML = audio.paused ? icon('i-play') : icon('i-pause');
        time.textContent = fmtTime(audio.currentTime) + ' / ' + fmtTime(audio.duration);
        if (audio.duration) seek.value = Math.round((audio.currentTime / audio.duration) * 1000);
      };
      btn.onclick = () => { if (audio.paused) audio.play(); else audio.pause(); };
      audio.onplay = sync; audio.onpause = sync; audio.ontimeupdate = sync; audio.onloadedmetadata = sync;
      seek.oninput = () => { if (audio.duration) audio.currentTime = (parseInt(seek.value, 10) / 1000) * audio.duration; };
      rate.onchange = () => { audio.playbackRate = parseFloat(rate.value); };
      const avol = mask.querySelector('#pv-avol');
      const amute = mask.querySelector('#pv-amute');
      if (avol) avol.oninput = () => { audio.volume = parseInt(avol.value, 10) / 100; audio.muted = audio.volume === 0; };
      if (amute) amute.onclick = () => {
        audio.muted = !audio.muted;
        amute.innerHTML = audio.muted ? icon('i-mute') : icon('i-volume');
        if (!audio.muted && avol) avol.value = Math.round(audio.volume * 100);
      };
      const aloop = mask.querySelector('#pv-aloop');
      if (aloop) aloop.onclick = () => {
        audio.loop = !audio.loop;
        aloop.classList.toggle('on', audio.loop);
        toast(audio.loop ? '已开启循环播放' : '已关闭循环播放', 'ok');
      };
    }

    const img = mask.querySelector('#pv-img');
    if (img) {
      let scale = 1;
      const stage = mask.querySelector('#img-stage');
      const tools = document.createElement('div');
      tools.className = 'image-tools';
      tools.innerHTML = '<button class="btn sm" id="zi" title="放大">放大</button>' +
        '<button class="btn sm" id="zo" title="缩小">缩小</button>' +
        '<button class="btn sm" id="zr" title="适应窗口">适应</button>' +
        '<button class="btn sm" id="zrot" title="旋转 90°">' + icon('i-rotate') + '</button>' +
        '<button class="btn sm" id="zfull" title="全屏查看">' + icon('i-fullscreen') + '</button>';
      stage.parentElement.style.position = 'relative';
      stage.parentElement.appendChild(tools);
      let rotate = 0;
      const apply = () => { img.style.transform = 'scale(' + scale + ') rotate(' + rotate + 'deg)'; };
      tools.querySelector('#zi').onclick = () => { scale = Math.min(4, scale + 0.25); apply(); };
      tools.querySelector('#zo').onclick = () => { scale = Math.max(0.25, scale - 0.25); apply(); };
      tools.querySelector('#zr').onclick = () => { scale = 1; rotate = 0; apply(); };
      tools.querySelector('#zrot').onclick = () => { rotate = (rotate + 90) % 360; apply(); };
      tools.querySelector('#zfull').onclick = () => {
        const el = mask.querySelector('.modal');
        if (document.fullscreenElement) document.exitFullscreen();
        else if (el && el.requestFullscreen) el.requestFullscreen();
      };
      img.onwheel = (ev) => { ev.preventDefault(); scale = Math.min(4, Math.max(0.25, scale + (ev.deltaY < 0 ? 0.15 : -0.15))); apply(); };
    }
  }

  async function doOcr(path) {
    try {
      const endpoint = (S.settings.ocr_api || 'api/public/ocr').replace(/^\//, '');
      const r = await api(endpoint, { method: 'POST', body: { path } });
      const text = (r && r.text) || '';
      Modal.open('' +
        '<div class="modal-head"><h3>识别结果</h3><button class="icon-btn" data-close>' + icon('i-close') + '</button></div>' +
        '<div class="modal-body"><pre class="preview-text" style="max-height:52vh;background:var(--bg-soft);border-radius:10px">' + fmt.esc(text || '未识别到文字') + '</pre></div>' +
        '<div class="modal-foot"><button class="btn" id="ocr-copy">复制</button><button class="btn primary" data-close>关闭</button></div>',
        {
          size: 'wide',
          onMount(m) {
            m.querySelector('#ocr-copy').onclick = () => {
              copyText(text).then(() => toast('已复制', 'ok')).catch(() => toast('复制失败', 'err'));
            };
          },
        });
    } catch (e) { toastErr(e); }
  }

  /* ------------------------------------------------------------------ *
   * 分享页
   * ------------------------------------------------------------------ */
  async function renderShare(share) {
    const view = document.getElementById('view');
    const pwd = new URLSearchParams(location.search).get('pwd') || '';
    if (pwd) sessionStorage.setItem('share_pwd_' + share.id, pwd);
    const base = '/@s/' + share.id + (share.sub || '');
    view.innerHTML = '<div class="page page-narrow"><div class="panel"><div class="panel-body muted">正在打开分享…</div></div></div>';
    try {
      const meta = await api('api/fs/get', { method: 'POST', body: { path: base, password: sharePwd(base) } });
      if (meta.is_dir) { go('#/browse?path=' + encodeURIComponent(base)); return; }
      const url = meta.raw_url && /^https?:/.test(meta.raw_url) ? meta.raw_url : rawUrl(base, meta.sign);
      view.innerHTML = '<div class="page page-narrow"><div class="panel">' +
        '<div class="panel-head"><div><h3>' + fmt.esc(meta.name) + '</h3><div class="sub">' + fmt.size(meta.size) + ' · ' + fmt.time(meta.modified) + '</div></div></div>' +
        '<div class="panel-body" style="text-align:center;padding:40px 20px">' +
        '<div class="empty-ico" style="margin:0 auto 14px">' + icon('i-file') + '</div>' +
        '<p class="muted">这是一个分享文件，点击下方按钮下载。</p>' +
        '<div class="empty-actions"><a class="btn primary" href="' + url + '" target="_blank" rel="noopener" download="' + fmt.esc(meta.name) + '">' + icon('i-download') + '下载文件</a>' +
        '<button class="btn" id="sh-qr">' + icon('i-qr') + '二维码</button></div>' +
        '</div></div></div>';
      view.querySelector('#sh-qr').onclick = () => {
        Modal.open('<div class="modal-head"><h3>扫码下载</h3><button class="icon-btn" data-close>' + icon('i-close') + '</button></div>' +
          '<div class="modal-body" style="text-align:center"><img src="' + qrcodeUrl(location.href, 260) + '" alt="二维码" style="width:260px;height:260px"></div>' +
          '<div class="modal-foot"><button class="btn primary" data-close>关闭</button></div>');
      };
    } catch (e) {
      view.innerHTML = '<div class="page page-narrow"><div class="panel"><div class="panel-body" style="text-align:center;padding:40px 20px">' +
        '<div class="empty-ico" style="margin:0 auto 14px">' + icon('i-info') + '</div>' +
        '<h3 style="margin:0 0 6px">无法打开分享</h3><p class="muted">' + fmt.esc(errText(e)) + '</p>' +
        (e.code === 403 || /提取码|share code/i.test(e.message || '')
          ? '<div class="field" style="max-width:280px;margin:18px auto 0"><input class="input" id="share-pwd" placeholder="请输入提取码"><button class="btn primary" id="share-go" style="margin-top:10px;width:100%">打开</button></div>'
          : '') +
        '</div></div></div>';
      const btn = view.querySelector('#share-go');
      if (btn) btn.onclick = () => {
        const v = view.querySelector('#share-pwd').value.trim();
        location.search = '?pwd=' + encodeURIComponent(v);
      };
    }
  }

  /* ------------------------------------------------------------------ *
   * 账号安全（修改密码 / 两步验证）
   * ------------------------------------------------------------------ */
  function showAccount() {
    const u = S.user || {};
    const has2fa = !!u.otp;
    Modal.open('' +
      '<div class="modal-head"><h3>账号安全</h3><button class="icon-btn" data-close>' + icon('i-close') + '</button></div>' +
      '<div class="modal-body">' +
      '<div class="field"><label>用户名</label><input class="input" value="' + fmt.esc(u.username || '') + '" readonly></div>' +
      '<div class="field"><label>修改密码（留空则不修改）</label><input class="input" type="password" id="ac-pwd" autocomplete="new-password" placeholder="新密码，至少 6 位"></div>' +
      '<div style="display:flex;justify-content:flex-end"><button class="btn" id="ac-save">保存密码</button></div>' +
      '<div style="border-top:1px solid var(--line);margin:18px 0"></div>' +
      '<div style="display:flex;align-items:center;gap:10px"><b style="font-size:14px">两步验证（2FA）</b>' +
      '<span class="tag ' + (has2fa ? 'ok' : '') + '">' + (has2fa ? '已开启' : '未开启') + '</span></div>' +
      '<p class="muted" style="font-size:12.5px;margin:6px 0 12px">开启后登录需要输入验证器（如 Microsoft Authenticator、Google Authenticator）中的 6 位动态码。</p>' +
      '<div id="ac-2fa-area">' +
      (has2fa
        ? '<button class="btn danger" id="ac-2fa-off">关闭两步验证</button>'
        : '<button class="btn primary" id="ac-2fa-on">开启两步验证</button>') +
      '</div></div>' +
      '<div class="modal-foot"><button class="btn" data-close>关闭</button></div>',
      {
        onMount(mask) {
          mask.querySelector('#ac-save').onclick = async () => {
            const pwd = mask.querySelector('#ac-pwd').value;
            if (!pwd) { toast('请输入新密码', 'err'); return; }
            if (pwd.length < 6) { toast('密码至少 6 位', 'err'); return; }
            try {
              await api('api/me/update', { method: 'POST', body: { username: u.username, password: pwd } });
              toast('密码已修改，请重新登录', 'ok');
              setToken('');
              remember.clear();
              Modal.close();
              go('#/login');
            } catch (e) { toastErr(e); }
          };
          const onBtn = mask.querySelector('#ac-2fa-on');
          if (onBtn) onBtn.onclick = () => start2FA(mask);
          const offBtn = mask.querySelector('#ac-2fa-off');
          if (offBtn) {
            offBtn.onclick = async () => {
              const ok = await confirmDialog('关闭两步验证', '关闭后登录只需要密码，确定继续？', true);
              if (!ok) return;
              try {
                await api('api/auth/2fa/disable', { method: 'POST' });
                toast('已关闭两步验证', 'ok');
                await loadMe();
                Modal.close();
              } catch (e) { toastErr(e); }
            };
          }
        },
      });
  }

  async function start2FA(mask) {
    try {
      const r = await api('api/auth/2fa/generate', { method: 'POST' });
      const area = mask.querySelector('#ac-2fa-area');
      area.innerHTML = '' +
        '<div class="qr-box"><img src="' + r.qr + '" alt="2FA 二维码">' +
        '<div style="flex:1;min-width:220px">' +
        '<p class="muted" style="font-size:12.5px;margin:0 0 8px">用验证器 App 扫描二维码，或手动输入密钥：</p>' +
        '<div class="secret-line">' + fmt.esc(r.secret) + '</div>' +
        '<div class="field" style="margin-top:12px"><label>输入 App 中的 6 位验证码</label>' +
        '<input class="input" id="ac-code" inputmode="numeric" maxlength="6" placeholder="000000"></div>' +
        '<button class="btn primary" id="ac-2fa-verify">完成开启</button>' +
        '</div></div>';
      area.querySelector('#ac-2fa-verify').onclick = async () => {
        const code = area.querySelector('#ac-code').value.trim();
        if (code.length < 6) { toast('请输入 6 位验证码', 'err'); return; }
        try {
          await api('api/auth/2fa/verify', { method: 'POST', body: { code, secret: r.secret } });
          toast('两步验证已开启', 'ok');
          await loadMe();
          Modal.close();
        } catch (e) { toastErr(e); }
      };
    } catch (e) { toastErr(e); }
  }

  /* ------------------------------------------------------------------ *
   * 全局拖拽上传
   * ------------------------------------------------------------------ */
  (function initDragDrop() {
    let maskEl = null;
    let depth = 0;

    function ensureMask() {
      if (!maskEl) {
        maskEl = document.createElement('div');
        maskEl.className = 'drop-mask';
        maskEl.innerHTML = '<div class="drop-box">' + icon('i-upload') + '<b>松开鼠标即可上传</b><span>文件将上传到当前目录</span></div>';
        document.body.appendChild(maskEl);
      }
      maskEl.hidden = false;
    }

    function hideMask() { if (maskEl) maskEl.hidden = true; }

    function hasFiles(ev) {
      const dt = ev.dataTransfer;
      if (!dt || !dt.types) return false;
      return Array.prototype.indexOf.call(dt.types, 'Files') >= 0;
    }

    document.addEventListener('dragenter', (ev) => {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      depth++;
      const b = window.__activeBrowser;
      if (b && b.write) ensureMask();
    });
    document.addEventListener('dragover', (ev) => {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
    });
    document.addEventListener('dragleave', (ev) => {
      if (!hasFiles(ev)) return;
      depth--;
      if (depth <= 0) { depth = 0; hideMask(); }
    });
    document.addEventListener('drop', async (ev) => {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      depth = 0;
      hideMask();
      const browser = window.__activeBrowser;
      if (!browser || !browser.write) { toast('当前页面或目录不支持上传', 'err'); return; }
      const items = Array.from(ev.dataTransfer.items || []);
      const entries = items.map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
      let files = [];
      if (entries.length) files = await collectEntries(entries);
      else files = Array.from(ev.dataTransfer.files || []);
      if (!files.length) { toast('没有可上传的文件', 'err'); return; }
      uploadFiles(files, browser.path, false, () => browser.reload && browser.reload());
    });
  })();

  async function collectEntries(entries) {
    const out = [];
    async function walk(entry, path) {
      if (entry.isFile) {
        const file = await new Promise((res, rej) => entry.file(res, rej));
        if (path) out.push(new File([file], path + '/' + file.name, { type: file.type }));
        else out.push(file);
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        let batch;
        do {
          batch = await new Promise((res, rej) => reader.readEntries(res, rej));
          for (const child of batch) {
            await walk(child, path ? path + '/' + entry.name : entry.name);
          }
        } while (batch.length);
      }
    }
    for (const e of entries) await walk(e, '');
    return out;
  }

  window.Site = { S, go, render, isAdmin, isGuest, boolSetting, joinPath, download, showPreview, showShareCreate, uploadFiles, fileMeta, rawUrl, showMkdir, showRename, removeFile, pickUpload, showSearch, showAccount, Uploader, errText };

  boot();
})();

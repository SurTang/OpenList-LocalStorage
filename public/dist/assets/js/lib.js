/* 通用工具层：接口请求、状态、提示、弹窗、格式化 */
(function () {
  'use strict';

  // 站点根路径：由服务端注入的 <base href> 决定，兼容子目录与分享链接等深层路径
  const BASE = (function () {
    try {
      const p = new URL(document.baseURI).pathname;
      return p.endsWith('/') ? p : p + '/';
    } catch (e) {
      return location.pathname.replace(/[^/]*$/, '');
    }
  })();

  const store = {
    token: localStorage.getItem('fs_token') || '',
    user: null,
    settings: {},
  };

  function abs(p) {
    if (!p) return '';
    if (/^(https?:)?\/\//.test(p) || p.startsWith('data:') || p.startsWith('blob:')) return p;
    if (p.startsWith('/')) return BASE.replace(/\/$/, '') + p;
    return p;
  }

  function setToken(t) {
    store.token = t || '';
    if (t) localStorage.setItem('fs_token', t);
    else localStorage.removeItem('fs_token');
  }

  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {});
    if (store.token) headers['Authorization'] = store.token;
    if (opts.body !== undefined && !(opts.body instanceof FormData) && !opts.raw) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    let res;
    try {
      res = await fetch(BASE + path.replace(/^\//, ''), {
        method: opts.method || 'GET',
        headers,
        body: opts.body,
        cache: 'no-store',
      });
    } catch (e) {
      throw new Error('网络请求失败，请检查服务是否运行');
    }
    if (opts.blob) {
      if (!res.ok) throw new Error('请求失败：' + res.status);
      return res.blob();
    }
    let data = null;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { code: res.status, message: text.slice(0, 200) || '响应解析失败' }; }
    // 后端鉴权失败有两种形态：HTTP 401，或 HTTP 200 + body.code=401（token 失效）。
    // 两种都要清掉本地 token，否则会一直带着无效凭证，连访客身份都取不到。
    const authFailed = res.status === 401 || (data && data.code === 401);
    if (authFailed && !/auth\/(login|login_hash)/.test(path)) {
      setToken('');
      store.user = null;
      if (!/login/.test(location.hash)) location.hash = '#/login';
    }
    if (!res.ok || (data && data.code !== undefined && data.code !== 200)) {
      const msg = (data && (data.message || data.error)) || ('请求失败（' + res.status + '）');
      const err = new Error(msg);
      // 后端多数错误用 HTTP 200 + body.code 包装（如 401 未登录、402 需要 2FA、403 停用），
      // 这里优先取业务码，方便调用方按 code 分支处理
      err.code = (data && data.code && data.code !== 200) ? data.code : res.status;
      err.data = data && data.data;
      throw err;
    }
    return data ? data.data : null;
  }

  const fmt = {
    size(n) {
      if (n === undefined || n === null || n < 0) return '-';
      if (n < 1024) return n + ' B';
      const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
      let v = n / 1024, i = 0;
      while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
      return (v >= 100 ? v.toFixed(0) : v.toFixed(v >= 10 ? 1 : 2)) + ' ' + units[i];
    },
    time(t) {
      if (!t) return '-';
      const d = new Date(t);
      if (isNaN(d.getTime()) || d.getFullYear() < 1971) return '-';
      const p = (x) => String(x).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    },
    date(t) {
      if (!t) return '';
      const d = new Date(t);
      if (isNaN(d.getTime())) return '';
      const p = (x) => String(x).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    },
    esc(s) {
      return String(s === undefined || s === null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
    // 逐段编码路径，保留前导 /
    encodePath(p) {
      return String(p || '/').split('/').map((s) => encodeURIComponent(s)).join('/');
    },
  };

  function icon(id, cls) {
    return '<svg class="ico ' + (cls || '') + '" aria-hidden="true"><use href="#' + id + '"></use></svg>';
  }

  let toastTimer = [];
  function toast(msg, type) {
    const root = document.getElementById('toast-root');
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    root.appendChild(el);
    const t = setTimeout(() => { el.remove(); }, 2800);
    toastTimer.push(t);
  }

  const Modal = {
    stack: [],
    open(html, opts) {
      opts = opts || {};
      const mask = document.createElement('div');
      mask.className = 'modal-mask';
      mask.innerHTML = '<div class="modal ' + (opts.size || '') + '" role="dialog" aria-modal="true">' + html + '</div>';
      const root = document.getElementById('modal-root');
      root.appendChild(mask);
      Modal.stack.push(mask);
      mask.addEventListener('mousedown', (e) => {
        if (e.target === mask && opts.dismissable !== false) Modal.close();
      });
      mask.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => Modal.close()));
      if (opts.onMount) opts.onMount(mask);
      return mask;
    },
    close() {
      const m = Modal.stack.pop();
      if (m) m.remove();
    },
    closeAll() {
      while (Modal.stack.length) Modal.close();
    },
  };

  function confirmDialog(title, desc, danger) {
    return new Promise((resolve) => {
      Modal.open(
        '<div class="modal-head"><h3>' + fmt.esc(title) + '</h3><button class="icon-btn" data-close>' + icon('i-close') + '</button></div>' +
        '<div class="modal-body"><p class="muted" style="margin:0">' + fmt.esc(desc || '') + '</p></div>' +
        '<div class="modal-foot"><button class="btn" data-no>取消</button>' +
        '<button class="btn ' + (danger ? 'danger' : 'primary') + '" data-yes>确定</button></div>',
        {
          dismissable: true,
          onMount(mask) {
            mask.querySelector('[data-no]').onclick = () => { Modal.close(); resolve(false); };
            mask.querySelector('[data-yes]').onclick = () => { Modal.close(); resolve(true); };
            const onClose = () => resolve(false);
            const obs = new MutationObserver(() => {
              if (!document.body.contains(mask)) { obs.disconnect(); onClose(); }
            });
            obs.observe(document.getElementById('modal-root'), { childList: true });
          },
        }
      );
    });
  }

  // 记住密码：本地弱加密（XOR），仅用于提升本机体验，不作为安全存储
  const RK = 'fs-local-remember-2024';
  function xor(str, key) {
    let out = '';
    for (let i = 0; i < str.length; i++) out += String.fromCharCode(str.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    return out;
  }
  const remember = {
    save(username, password) {
      try {
        const raw = JSON.stringify({ u: username, p: password, t: Date.now() });
        localStorage.setItem('fs_remember', btoa(unescape(encodeURIComponent(xor(raw, RK)))));
      } catch (e) { /* ignore */ }
    },
    load() {
      try {
        const v = localStorage.getItem('fs_remember');
        if (!v) return null;
        const obj = JSON.parse(xor(decodeURIComponent(escape(atob(v))), RK));
        if (!obj || !obj.u) return null;
        return obj;
      } catch (e) { return null; }
    },
    clear() { localStorage.removeItem('fs_remember'); },
  };


  // 后端少量英文错误兜底翻译
  const ERR_MAP = [
    [/Invalid username or password/i, '用户名或密码错误'],
    [/Current user is disabled/i, '账号已被停用，请联系管理员'],
    [/user is disabled/i, '账号已被停用，请联系管理员'],
    [/Guest user is disabled/i, '访客模式未开启，请登录'],
    [/Too many unsuccessful/i, '登录失败次数过多，请稍后再试'],
    [/Password has been changed/i, '密码已修改，请重新登录'],
    [/no such a user/i, '用户不存在'],
    [/record not found/i, '记录不存在或已被删除'],
    [/UNIQUE constraint failed: x_users\.username|Username already exists/i, '用户名已存在'],
    [/Error 1452|foreign key constraint/i, '存在关联数据，无法完成操作'],
    [/permission denied/i, '没有权限执行该操作'],
    [/storage not found/i, '存储不存在，请先添加存储'],
    [/failed get storage/i, '无法读取存储，请检查存储配置'],
    [/file exists/i, '同名文件已存在'],
    [/object not found/i, '文件或目录不存在'],
    [/not a folder/i, '该对象不是目录'],
    [/wrong share code/i, '提取码错误'],
    [/network|dial tcp|connection refused|i\/o timeout/i, '网络连接失败，请检查目标服务是否可达'],
  ];

  function mapError(msg) {
    const text = String(msg || '').trim();
    for (const [re, zh] of ERR_MAP) {
      if (re.test(text)) return zh;
    }
    return text || '操作失败';
  }

  // 本地偏好设置（仅保存在浏览器，不影响其他用户）
  const LOCAL_KEY = 'fs_local_settings';
  const LOCAL_DEFAULT = {
    layout: 'list',            // list | grid
    pageSize: 30,              // 0 = 全部
    showCheckbox: false,       // 总是显示复选框
    sortBy: 'name',            // name | size | modified
    sortOrder: 'asc',          // asc | desc
    cardSize: 'medium',        // small | medium | large
    nameOverflow: 'ellipsis',  // ellipsis | wrap | scroll
    showCount: true,           // 页脚显示文件计数
    textSize: 13,              // 文本预览字号
    textWrap: true,            // 文本预览自动换行
  };
  const localSettings = {
    get() {
      try {
        return Object.assign({}, LOCAL_DEFAULT, JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'));
      } catch (e) { return Object.assign({}, LOCAL_DEFAULT); }
    },
    set(patch) {
      const next = Object.assign(this.get(), patch);
      localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
      return next;
    },
  };

  function qrcodeUrl(text, size) {
    return BASE + 'api/public/qrcode?size=' + (size || 260) + '&text=' + encodeURIComponent(text);
  }

  window.App = { BASE, store, api, setToken, abs, fmt, icon, toast, Modal, confirmDialog, remember, mapError, localSettings, qrcodeUrl };

})();

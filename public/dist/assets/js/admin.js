/* 管理控制台：概览 / 存储 / 用户 / 任务 / 分享 / 设置 / 关于 */
(function () {
  'use strict';

  const { api, fmt, icon, toast, Modal, confirmDialog } = App;

  const DRIVER_LABELS = { Local: '本地存储', SMB: 'SMB 共享', FTP: 'FTP 服务器', SFTP: 'SFTP 服务器' };
  const GROUP = { SITE: 1, STYLE: 2, PREVIEW: 3, GLOBAL: 4, INDEX: 5, TRAFFIC: 6, FTP: 7 };

  // 驱动配置字段中文名
  const ADDITION_LABELS = {
    root_folder_path: ['根目录路径', '支持绝对路径，例如 D:////share'],
    directory_size: ['统计目录大小', '会遍历目录，可能影响存储性能'],
    thumbnail: ['生成缩略图', '图片/视频列表显示缩略图'],
    pdf_thumbnail: ['PDF 首页缩略图', '仅 macOS 支持'],
    thumb_cache_folder: ['缩略图缓存目录', '留空则在临时目录缓存'],
    thumb_concurrency: ['缩略图并发数', '同时生成缩略图的数量'],
    video_thumb_pos: ['视频缩略图位置', '取第几秒的画面作为封面'],
    show_hidden: ['显示隐藏文件', '显示以点开头的文件'],
    mkdir_perm: ['新建目录权限', '八进制，例如 777'],
    recycle_bin_path: ['回收站路径', '删除的文件移动到该目录'],
    address: ['服务器地址', '例如 192.168.1.10:445 / 192.168.1.10:21'],
    username: ['用户名', '登录账号'],
    password: ['密码', '登录密码'],
    share_name: ['共享名', 'SMB 共享名称，例如 share'],
    encoding: ['编码', 'FTP 服务器文件名编码，通常为 GBK 或 UTF-8'],
    cwd_list: ['列目录前先切换目录', '部分 FTP 服务器需要开启'],
    private_key: ['私钥', 'OpenSSH 格式私钥内容，可留空改用密码'],
    passphrase: ['私钥密码', '私钥有密码时填写'],
    ignore_symlink_error: ['忽略软链接错误', '跳过无法读取的软链接'],
  };
  // 设置项中文标签（仅前端展示用）
  const LABELS = {
    site_title: ['站点名称', '显示在浏览器标题与首页'],
    announcement: ['站点公告', '显示在首页顶部，可换行'],
    logo: ['站点图标', '顶部导航使用的图标，默认本地 SVG'],
    favicon: ['网站图标', '浏览器标签页图标'],
    main_color: ['主题色', '影响按钮、链接、首页背景等'],
    home_icon: ['主页图标', '首页按钮图标，建议填本地图标路径（留空使用内置图标）'],
    share_icon: ['分享图标', '分享按钮图标'],
    hide_storage_details: ['隐藏存储详情', '访客看不到存储驱动与容量信息'],
    hide_storage_details_in_manage_page: ['管理页隐藏存储详情', '管理页列表不显示底层信息'],
    pagination_type: ['分页方式', 'all / pagination / load_more / auto_load_more'],
    default_page_size: ['每页数量', '列表默认每页条数'],
    allow_indexed: ['允许搜索引擎索引', '关闭后 robots.txt 禁止抓取'],
    allow_mounted: ['允许挂载', '是否展示已挂载存储'],
    robots_txt: ['robots.txt', '直接返回给爬虫的内容'],
    guest_login_entry: ['访客可登录', '访客模式下首页右上角是否显示登录入口'],
    password_reset_enabled: ['允许自助找回密码', '开启后可用管理员生成的重置码重置密码'],
    hide_files: ['隐藏文件规则', '正则，命中则不显示'],
    package_download: ['打包下载', '允许多选打包为 zip'],
    customize_head: ['自定义 head', '插入到页面 head 的 HTML'],
    customize_body: ['自定义 body', '插入到页面 body 的 HTML'],
    link_expiration: ['直链有效期', '小时，0 表示不过期'],
    sign_all: ['全部链接签名', '所有直链都需要签名'],
    ocr_api: ['OCR 接口', '默认使用内置本地 OCR，不访问外网'],
    filename_char_mapping: ['文件名字符映射', 'JSON，例如 {"/": "|"}'],
    forward_direct_link_params: ['转发直链参数', '下载时透传查询参数'],
    ignore_direct_link_params: ['忽略的直链参数', '逗号分隔'],
    share_preview: ['分享页预览', '允许在分享页预览文件'],
    share_archive_preview: ['分享页压缩包预览', '允许查看压缩包内容'],
    share_force_proxy: ['分享强制代理', '分享下载走服务端中转'],
    share_summary_content: ['分享文案模板', '分享链接的默认描述'],
    handle_hook_after_writing: ['写入后执行 Hook', '上传完成后触发外部命令'],
    handle_hook_rate_limit: ['Hook 频率限制', '每分钟最多执行次数，0 不限'],
    ignore_system_files: ['忽略系统文件', '上传时跳过 .DS_Store、Thumbs.db 等'],
    multipart_enabled: ['分片上传', '大文件分片上传'],
    multipart_chunk_size: ['分片大小(MB)', '需小于反向代理请求体上限'],
    upload_task_threads_num: ['上传并发', '同时上传任务数'],
    copy_task_threads_num: ['复制并发', '同时复制任务数'],
    move_task_threads_num: ['移动并发', '同时移动任务数'],
    decompress_download_task_threads_num: ['解压下载并发', '解压时下载线程数'],
    decompress_upload_task_threads_num: ['解压上传并发', '解压后上传线程数'],
    max_client_download_speed: ['客户端下载限速', 'KB/s，-1 不限'],
    max_client_upload_speed: ['客户端上传限速', 'KB/s，-1 不限'],
    max_server_download_speed: ['服务端下载限速', 'KB/s，-1 不限'],
    max_server_upload_speed: ['服务端上传限速', 'KB/s，-1 不限'],
    search_index: ['搜索索引', 'database（内置数据库索引）或 none'],
    auto_update_index: ['自动更新索引', '文件变化时更新索引'],
    ignore_paths: ['索引忽略路径', '每行一个'],
    max_index_depth: ['索引最大深度', '默认 20'],
    ftp_public_host: ['FTP 公网地址', 'FTP 服务端返回给客户端的地址'],
    ftp_pasv_port_map: ['FTP 被动端口映射', '格式见文档'],
    ftp_mandatory_tls: ['FTP 强制 TLS', '要求 FTPS'],
    ftp_implicit_tls: ['FTP 隐式 TLS', '隐式 FTPS'],
    ftp_tls_private_key_path: ['FTP TLS 私钥', '证书私钥路径'],
    ftp_tls_public_cert_path: ['FTP TLS 证书', '证书路径'],
    sftp_disable_password_login: ['SFTP 禁用密码登录', '只允许公钥登录'],
    text_types: ['文本类型', '可预览的文本后缀'],
    audio_types: ['音频类型', '可预览的音频后缀'],
    video_types: ['视频类型', '可预览的视频后缀'],
    image_types: ['图片类型', '可预览的图片后缀'],
    proxy_types: ['代理类型', '需要服务端代理的后缀'],
    proxy_ignore_headers: ['代理忽略请求头', '逗号分隔'],
    external_previews: ['外部预览', 'JSON 配置，按后缀映射预览地址'],
    audio_cover: ['音频封面', '默认使用本地内置封面'],
    audio_autoplay: ['音频自动播放', '打开预览即播放'],
    video_autoplay: ['视频自动播放', '打开预览即播放'],
    preview_download_by_default: ['预览页默认下载', '打开预览时直接下载'],
    preview_archives_by_default: ['默认预览压缩包', '进入压缩包内部浏览'],
    share_preview_download_by_default: ['分享页默认下载', '分享预览时直接下载'],
    share_preview_archives_by_default: ['分享页默认预览压缩包', '分享中直接进入压缩包'],
    readme_autorender: ['自动渲染 README', '目录下 README 自动显示'],
    filter_readme_scripts: ['过滤 README 脚本', '移除 README 中的脚本'],
    non_efs_zip_encoding: ['非 EFS ZIP 编码', '解压非 UTF-8 文件名时使用'],
  };

  const PERMISSIONS = [
    [0, '查看隐藏文件'], [1, '免密码访问'], [3, '上传 / 新建'],
    [4, '重命名'], [5, '移动'], [6, '复制'], [7, '删除'],
    [8, 'WebDAV 读取'], [9, 'WebDAV 写入'],
    [10, 'FTP/SFTP 读取'], [11, 'FTP/SFTP 写入'],
    [12, '读取压缩包'], [13, '解压'], [14, '创建分享'], [15, '自定义分享 ID'],
  ];

  const NAV = [
    ['home', 'i-info', '概览'],
    ['storage', 'i-storage', '存储管理'],
    ['users', 'i-users', '用户管理'],
    ['tasks', 'i-tasks', '任务'],
    ['shares', 'i-link', '分享'],
    ['settings', 'i-settings', '设置'],
    ['about', 'i-info', '关于'],
  ];

  function render(container, section, ctx) {
    container.innerHTML = '' +
      '<div class="admin-shell">' +
      '<nav class="admin-nav"><div class="admin-nav-title">管理控制台</div>' +
      NAV.map(([k, ico, label]) =>
        '<button class="admin-link' + (k === section ? ' active' : '') + '" data-nav="' + k + '">' + icon(ico) + '<span>' + label + '</span></button>'
      ).join('') +
      '</nav><div class="admin-main" id="admin-main"><div class="panel"><div class="panel-body muted">加载中…</div></div></div></div>';

    container.querySelectorAll('[data-nav]').forEach((b) => {
      b.onclick = () => { location.hash = '#/admin/' + b.getAttribute('data-nav'); };
    });

    const main = container.querySelector('#admin-main');
    const map = {
      home: viewHome, storage: viewStorage, users: viewUsers,
      tasks: viewTasks, shares: viewShares, settings: viewSettings, about: viewAbout,
    };
    (map[section] || viewHome)(main, ctx);
  }

  function panel(title, sub, bodyHtml, headExtra) {
    return '<section class="panel"><div class="panel-head"><div><h3>' + title + '</h3>' +
      (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>' + (headExtra || '') + '</div>' + bodyHtml + '</section>';
  }

  /* ------------------------------------------------------------------ */
  async function viewHome(main) {
    main.innerHTML = '<div class="stat-grid" id="stats">' +
      '<div class="stat"><div class="k">存储</div><div class="v">-</div></div>' +
      '<div class="stat"><div class="k">用户</div><div class="v">-</div></div>' +
      '<div class="stat"><div class="k">分享</div><div class="v">-</div></div>' +
      '<div class="stat"><div class="k">进行中的任务</div><div class="v">-</div></div>' +
      '</div>' +
      panel('快捷操作', '常用管理入口',
        '<div class="panel-body"><div class="gap-8" style="display:flex;flex-wrap:wrap;gap:8px">' +
        '<button class="btn" data-go="storage">' + icon('i-plus') + '添加存储</button>' +
        '<button class="btn" data-go="users">' + icon('i-users') + '新建用户</button>' +
        '<button class="btn" data-go="settings">' + icon('i-settings') + '站点设置</button>' +
        '<button class="btn" data-go="about">' + icon('i-info') + '关于本项目</button>' +
        '</div></div>') +
      panel('运行信息', '', '<div class="panel-body" id="sysinfo" style="font-size:13px"></div>');

    main.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => { location.hash = '#/admin/' + b.getAttribute('data-go'); });

    const stats = main.querySelectorAll('.stat .v');
    try {
      const [storages, users, shares] = await Promise.all([
        api('api/admin/storage/list').then((r) => (Array.isArray(r) ? r : ((r && r.content) || []))),
        api('api/admin/user/list?page=1&per_page=1').catch(() => null),
        api('api/share/list?page=1&per_page=1').catch(() => null),
      ]);
      stats[0].innerHTML = (storages || []).length + '<small>个</small>';
      stats[1].innerHTML = (users ? users.total : 0) + '<small>人</small>';
      stats[2].innerHTML = (shares ? shares.total : 0) + '<small>条</small>';
    } catch (e) {
      main.querySelector('#sysinfo').innerHTML = '<span style="color:var(--danger)">' + fmt.esc(App.mapError(e.message)) + '</span>';
    }
    let running = 0;
    for (const t of ['upload', 'copy', 'move', 'decompress', 'decompress_upload']) {
      try {
        const d = await api('api/task/' + t + '/undone');
        running += (d || []).length;
      } catch (e) { /* ignore */ }
    }
    stats[3].innerHTML = running + '<small>项</small>';

    const settings = await api('api/admin/setting/list?groups=3').catch(() => []);
    const find = (k) => (settings || []).find((s) => s.key === k);
    const ver = find('version');
    main.querySelector('#sysinfo').innerHTML =
      '<div class="muted">站点名称：<b style="color:var(--text)">' + fmt.esc((find('site_title') || {}).value || '') + '</b></div>' +
      '<div class="muted" style="margin-top:6px">服务版本：<span class="mono">' + fmt.esc(ver ? ver.value : '-') + '</span></div>' +
      '<div class="muted" style="margin-top:6px">支持存储驱动：本地磁盘、SMB、FTP、SFTP（仅本地实现，无外网依赖）</div>' +
      '<div class="muted" style="margin-top:6px">已移除模块：媒体库、离线下载、种子、单点登录、LDAP、对象存储、转码</div>';
  }

  /* ------------------------------------------------------------------ */
  async function viewStorage(main) {
    main.innerHTML = panel('存储管理', '仅开放本地可实现的存储驱动',
      '<div class="panel-body tight"><div class="table-wrap"><table class="data"><thead><tr>' +
      '<th>挂载路径</th><th>驱动</th><th>状态</th><th>备注</th><th class="actions">操作</th>' +
      '</tr></thead><tbody id="st-body"><tr><td colspan="5" class="muted">加载中…</td></tr></tbody></table></div></div>',
      '<button class="btn primary sm" id="st-new">' + icon('i-plus') + '新建存储</button>');

    const body = main.querySelector('#st-body');
    let drivers = {};
    const load = async () => {
      try {
        body.innerHTML = '<tr><td colspan="5" class="muted">加载中…</td></tr>';
        const resp = await api('api/admin/storage/list') || {};
        const list = Array.isArray(resp) ? resp : (resp.content || []);
        if (!list.length) {
          body.innerHTML = '<tr><td colspan="5" class="muted" style="padding:26px 16px">还没有存储，点击右上角「新建存储」开始添加</td></tr>';
          return;
        }
        body.innerHTML = list.sort((a, b) => a.order - b.order).map((s) => {
          const st = s.disabled ? '<span class="tag off">已禁用</span>' : '<span class="tag ok">正常</span>';
          return '<tr><td><b>' + fmt.esc(s.mount_path) + '</b><div class="mono">' + fmt.esc(s.status || '') + '</div></td>' +
            '<td>' + fmt.esc(DRIVER_LABELS[s.driver] || s.driver) + '</td>' +
            '<td>' + st + '</td><td class="muted">' + fmt.esc(s.remark || '-') + '</td>' +
            '<td class="actions"><div class="row-actions">' +
            '<button class="btn link" data-edit="' + s.id + '">编辑</button>' +
            '<button class="btn link" data-toggle="' + s.id + '" data-dis="' + (s.disabled ? 1 : 0) + '">' + (s.disabled ? '启用' : '禁用') + '</button>' +
            '<button class="btn link" data-del="' + s.id + '" data-name="' + fmt.esc(s.mount_path) + '">删除</button>' +
            '</div></td></tr>';
        }).join('');
        body.querySelectorAll('[data-edit]').forEach((b) => {
          b.onclick = () => {
            const s = list.find((x) => String(x.id) === b.getAttribute('data-edit'));
            editStorage(s, drivers, load);
          };
        });
        body.querySelectorAll('[data-toggle]').forEach((b) => {
          b.onclick = async () => {
            const dis = b.getAttribute('data-dis') === '1';
            try {
              await api('api/admin/storage/' + (dis ? 'enable' : 'disable') + '?id=' + b.getAttribute('data-toggle'), { method: 'POST' });
              toast(dis ? '已启用' : '已禁用', 'ok');
              load();
            } catch (e) { toast(App.mapError(e.message), 'err'); }
          };
        });
        body.querySelectorAll('[data-del]').forEach((b) => {
          b.onclick = async () => {
            const ok = await confirmDialog('删除存储', '确定删除挂载「' + b.getAttribute('data-name') + '」吗？该操作不会删除底层文件。', true);
            if (!ok) return;
            try {
              await api('api/admin/storage/delete?id=' + b.getAttribute('data-del'), { method: 'POST' });
              toast('已删除', 'ok');
              load();
            } catch (e) { toast(App.mapError(e.message), 'err'); }
          };
        });
      } catch (e) {
        body.innerHTML = '<tr><td colspan="5" style="color:var(--danger)">' + fmt.esc(App.mapError(e.message)) + '</td></tr>';
      }
    };
    try { drivers = await api('api/admin/driver/list') || {}; } catch (e) { drivers = {}; }
    main.querySelector('#st-new').onclick = () => editStorage(null, drivers, load);
    await load();
  }

  function additionDefaults(info) {
    const obj = {};
    ((info && info.additional) || []).forEach((it) => { obj[it.name] = it.default !== undefined ? it.default : ''; });
    return obj;
  }

  function additionFields(info, data) {
    const items = (info && info.additional) || [];
    if (!items.length) return '<p class="muted" style="font-size:12.5px">该驱动无需额外配置</p>';
    return items.map((it) => {
      const v = data[it.name] !== undefined ? data[it.name] : (it.default || '');
      const req = it.required ? ' <span style="color:var(--danger)">*</span>' : '';
      const meta = ADDITION_LABELS[it.name] || [];
      const labelText = meta[0] || it.name;
      const helpText = meta[1] || it.help || '';
      const help = helpText ? '<div class="help">' + fmt.esc(helpText) + '</div>' : '';
      const name = 'add_' + it.name;
      let control = '';
      if (it.type === 'bool') {
        control = '<label class="switch"><input type="checkbox" name="' + name + '"' + (v === true || String(v) === 'true' ? ' checked' : '') + '><span class="track"></span><span class="muted" style="font-size:12.5px">' + fmt.esc(labelText) + '</span></label>';
        return '<div class="field">' + control + '</div>';
      }
      if (it.type === 'select') {
        const opts = String(it.options || '').split(',').filter(Boolean);
        control = '<select class="select" name="' + name + '">' + opts.map((o) =>
          '<option value="' + fmt.esc(o) + '"' + (String(v) === o ? ' selected' : '') + '>' + fmt.esc(o) + '</option>').join('') + '</select>';
      } else if (it.type === 'number') {
        control = '<input class="input" type="number" name="' + name + '" value="' + fmt.esc(v) + '">';
      } else if (it.type === 'text') {
        control = '<textarea class="textarea" name="' + name + '">' + fmt.esc(v) + '</textarea>';
      } else {
        const secret = /password|secret|key|token/i.test(it.name);
        control = '<input class="input" type="' + (secret ? 'password' : 'text') + '" name="' + name + '" value="' + fmt.esc(v) + '" autocomplete="off">';
      }
      return '<div class="field"><label>' + fmt.esc(labelText) + req + ' <span class="mono" style="opacity:.5">' + fmt.esc(it.name) + '</span></label>' + control + help + '</div>';
    }).join('');
  }

  function editStorage(storage, drivers, done) {
    const isEdit = !!storage;
    const driverNames = Object.keys(drivers).filter((k) => DRIVER_LABELS[k] || drivers[k]);
    const currentDriver = isEdit ? storage.driver : (driverNames.includes('Local') ? 'Local' : driverNames[0]);
    let addition = {};
    if (isEdit) {
      try { addition = JSON.parse(storage.addition || '{}'); } catch (e) { addition = {}; }
    } else {
      addition = additionDefaults(drivers[currentDriver]);
    }

    Modal.open('' +
      '<div class="modal-head"><h3>' + (isEdit ? '编辑存储' : '新建存储') + '</h3><button class="icon-btn" data-close>' + icon('i-close') + '</button></div>' +
      '<div class="modal-body"><form id="st-form">' +
      '<div class="form-row">' +
      '<div class="field"><label>挂载路径 <span style="color:var(--danger)">*</span></label><input class="input" name="mount_path" value="' + fmt.esc(isEdit ? storage.mount_path : '') + '" placeholder="/docs" required></div>' +
      '<div class="field"><label>驱动</label><select class="select" name="driver">' + driverNames.map((d) =>
        '<option value="' + fmt.esc(d) + '"' + (d === currentDriver ? ' selected' : '') + '>' + fmt.esc(DRIVER_LABELS[d] || d) + '</option>').join('') + '</select></div>' +
      '</div>' +
      '<div class="form-row">' +
      '<div class="field"><label>排序（越小越前）</label><input class="input" type="number" name="order" value="' + (isEdit ? storage.order : 0) + '"></div>' +
      '<div class="field"><label>缓存过期（分钟）</label><input class="input" type="number" name="cache_expiration" value="' + (isEdit ? storage.cache_expiration : 30) + '"></div>' +
      '<div class="field"><label>备注</label><input class="input" name="remark" value="' + fmt.esc(isEdit ? storage.remark || '' : '') + '"></div>' +
      '</div>' +
      '<div class="form-row">' +
      '<div class="field"><label class="check"><input type="checkbox" name="disabled"' + (isEdit && storage.disabled ? ' checked' : '') + '>禁用该存储</label></div>' +
      '<div class="field"><label class="check"><input type="checkbox" name="web_proxy"' + (isEdit && storage.web_proxy ? ' checked' : '') + '>使用本机中转下载</label></div>' +
      '<div class="field"><label class="check"><input type="checkbox" name="enable_sign"' + (isEdit && storage.enable_sign ? ' checked' : '') + '>启用签名</label></div>' +
      '</div>' +
      '<div style="border-top:1px solid var(--line);margin:6px 0 16px"></div>' +
      '<div id="addition-fields">' + additionFields(drivers[currentDriver], addition) + '</div>' +
      '</form></div>' +
      '<div class="modal-foot"><button class="btn" data-close>取消</button><button class="btn primary" id="st-save">保存</button></div>',
      {
        size: 'wide',
        onMount(mask) {
          const form = mask.querySelector('#st-form');
          const holder = mask.querySelector('#addition-fields');
          form.querySelector('[name=driver]').onchange = (e) => {
            const d = e.target.value;
            holder.innerHTML = additionFields(drivers[d], additionDefaults(drivers[d]));
          };
          mask.querySelector('#st-save').onclick = async () => {
            const fd = new FormData(form);
            const add = {};
            ((drivers[fd.get('driver')] || {}).additional || []).forEach((it) => {
              const el = form.querySelector('[name="add_' + it.name + '"]');
              if (!el) return;
              if (it.type === 'bool') add[it.name] = !!el.checked;
              else if (it.type === 'number') add[it.name] = el.value === '' ? 0 : Number(el.value);
              else add[it.name] = el.value;
            });
            const body = {
              id: isEdit ? storage.id : 0,
              mount_path: String(fd.get('mount_path') || '').trim(),
              driver: fd.get('driver'),
              order: parseInt(fd.get('order'), 10) || 0,
              cache_expiration: parseInt(fd.get('cache_expiration'), 10) || 0,
              remark: fd.get('remark') || '',
              disabled: !!fd.get('disabled'),
              web_proxy: !!fd.get('web_proxy'),
              enable_sign: !!fd.get('enable_sign'),
              addition: JSON.stringify(add),
            };
            if (!body.mount_path.startsWith('/')) body.mount_path = '/' + body.mount_path;
            const btn = mask.querySelector('#st-save');
            btn.disabled = true;
            try {
              await api('api/admin/storage/' + (isEdit ? 'update' : 'create'), { method: 'POST', body });
              toast('已保存', 'ok');
              Modal.close();
              done && done();
            } catch (e) { toast(App.mapError(e.message), 'err'); } finally { btn.disabled = false; }
          };
        },
      });
  }

  /* ------------------------------------------------------------------ */
  async function viewUsers(main) {
    main.innerHTML = panel('用户管理', '权限按位控制，访客用户用于对外浏览',
      '<div class="panel-body tight"><div class="table-wrap"><table class="data"><thead><tr>' +
      '<th>用户名</th><th>角色</th><th>基础路径</th><th>状态</th><th class="actions">操作</th>' +
      '</tr></thead><tbody id="us-body"><tr><td colspan="5" class="muted">加载中…</td></tr></tbody></table></div></div>',
      '<button class="btn primary sm" id="us-new">' + icon('i-plus') + '新建用户</button>');

    const body = main.querySelector('#us-body');
    const load = async () => {
      try {
        const d = await api('api/admin/user/list?page=1&per_page=200');
        const list = (d && d.content) || [];
        body.innerHTML = list.map((u) => {
          const role = u.role === 2 ? '管理员' : (u.role === 1 ? '访客' : '普通用户');
          const st = u.disabled ? '<span class="tag off">已禁用</span>' : '<span class="tag ok">正常</span>';
          return '<tr><td><b>' + fmt.esc(u.username) + '</b></td><td>' + role + '</td>' +
            '<td class="mono">' + fmt.esc(u.base_path || '/') + '</td><td>' + st + '</td>' +
            '<td class="actions"><div class="row-actions">' +
            '<button class="btn link" data-edit="' + u.id + '">编辑</button>' +
            (u.role === 1 ? '' : '<button class="btn link" data-reset="' + fmt.esc(u.username) + '">重置密码</button>') +
            (u.role !== 2 ? '<button class="btn link" data-toggle="' + u.id + '" data-dis="' + (u.disabled ? 1 : 0) + '">' + (u.disabled ? '启用' : '停用') + '</button>' : '') +
            (u.role === 0 ? '<button class="btn link" data-del="' + u.id + '" data-name="' + fmt.esc(u.username) + '">删除</button>' : '') +
            '</div></td></tr>';
        }).join('') || '<tr><td colspan="5" class="muted">暂无用户</td></tr>';
        body.querySelectorAll('[data-edit]').forEach((b) => {
          b.onclick = () => {
            const u = list.find((x) => String(x.id) === b.getAttribute('data-edit'));
            editUser(u, load);
          };
        });
        body.querySelectorAll('[data-toggle]').forEach((b) => {
          b.onclick = async () => {
            const u = list.find((x) => String(x.id) === b.getAttribute('data-toggle'));
            if (!u) return;
            const body2 = Object.assign({}, u, { disabled: !u.disabled, password: '' });
            try {
              await api('api/admin/user/update', { method: 'POST', body: body2 });
              toast(u.disabled ? '已启用' : '已停用', 'ok');
              load();
            } catch (e) { toast(App.mapError(e.message), 'err'); }
          };
        });
        body.querySelectorAll('[data-reset]').forEach((b) => {
          b.onclick = () => resetCode(b.getAttribute('data-reset'));
        });
        body.querySelectorAll('[data-del]').forEach((b) => {
          b.onclick = async () => {
            const ok = await confirmDialog('删除用户', '确定删除用户「' + b.getAttribute('data-name') + '」吗？', true);
            if (!ok) return;
            try {
              await api('api/admin/user/delete?id=' + b.getAttribute('data-del'), { method: 'POST' });
              toast('已删除', 'ok');
              load();
            } catch (e) { toast(App.mapError(e.message), 'err'); }
          };
        });
      } catch (e) {
        body.innerHTML = '<tr><td colspan="5" style="color:var(--danger)">' + fmt.esc(App.mapError(e.message)) + '</td></tr>';
      }
    };
    main.querySelector('#us-new').onclick = () => editUser(null, load);
    await load();
  }

  function permCheckboxes(value) {
    const v = value || 0;
    return '<div class="form-row">' + PERMISSIONS.map(([bit, label]) =>
      '<label class="check" style="margin:2px 0"><input type="checkbox" name="perm_' + bit + '"' + ((v >> bit) & 1 ? ' checked' : '') + '>' + label + '</label>'
    ).join('') + '</div>';
  }

  function editUser(user, done) {
    const isEdit = !!user;
    Modal.open('' +
      '<div class="modal-head"><h3>' + (isEdit ? '编辑用户' : '新建用户') + '</h3><button class="icon-btn" data-close>' + icon('i-close') + '</button></div>' +
      '<div class="modal-body"><form id="us-form">' +
      '<div class="form-row">' +
      '<div class="field"><label>用户名 <span style="color:var(--danger)">*</span></label><input class="input" name="username" value="' + fmt.esc(isEdit ? user.username : '') + '"' + (isEdit ? ' readonly' : '') + ' required></div>' +
      (isEdit && user.role === 1 ? '<div class="field"><label>说明</label><div class="help">访客账号用于「访客模式」：启用后未登录用户可直接浏览存储。权限位决定访客能看到与操作的范围。</div></div>' : '') +
      '<div class="field"><label>' + (isEdit ? '新密码（留空不修改）' : '密码') + '</label><input class="input" type="password" name="password" autocomplete="new-password"></div>' +
      '</div>' +
      '<div class="form-row">' +
      '<div class="field"><label>基础路径</label><input class="input" name="base_path" value="' + fmt.esc(isEdit ? user.base_path || '/' : '/') + '"></div>' +
      '<div class="field"><label class="check"><input type="checkbox" name="disabled"' + (isEdit && user.disabled ? ' checked' : '') + '>禁用该用户</label></div>' +
      '</div>' +
      '<div class="field"><label>权限</label>' + permCheckboxes(isEdit ? user.permission : 0x71FF) + '</div>' +
      '</form></div>' +
      '<div class="modal-foot"><button class="btn" data-close>取消</button><button class="btn primary" id="us-save">保存</button></div>',
      {
        onMount(mask) {
          mask.querySelector('#us-save').onclick = async () => {
            const form = mask.querySelector('#us-form');
            const fd = new FormData(form);
            let perm = 0;
            PERMISSIONS.forEach(([bit]) => { if (fd.get('perm_' + bit)) perm |= (1 << bit); });
            const body = {
              id: isEdit ? user.id : 0,
              username: String(fd.get('username') || '').trim(),
              password: fd.get('password') || '',
              base_path: fd.get('base_path') || '/',
              role: isEdit ? user.role : 0,
              disabled: !!fd.get('disabled'),
              permission: perm,
            };
            const btn = mask.querySelector('#us-save');
            btn.disabled = true;
            try {
              await api('api/admin/user/' + (isEdit ? 'update' : 'create'), { method: 'POST', body });
              toast('已保存', 'ok');
              Modal.close();
              done && done();
            } catch (e) { toast(App.mapError(e.message), 'err'); } finally { btn.disabled = false; }
          };
        },
      });
  }

  function resetCode(username) {
    Modal.open('' +
      '<div class="modal-head"><h3>重置密码</h3><button class="icon-btn" data-close>' + icon('i-close') + '</button></div>' +
      '<div class="modal-body"><p class="muted" style="margin-top:0">为 <b>' + fmt.esc(username) + '</b> 生成一次性重置码，' +
      '用户在登录页点击「忘记密码」输入用户名、重置码与新密码即可完成重置。</p>' +
      '<div id="rc-body" class="muted">生成中…</div></div>' +
      '<div class="modal-foot"><button class="btn" data-close>关闭</button></div>',
      {
        onMount(mask) {
          const holder = mask.querySelector('#rc-body');
          api('api/admin/user/reset_code', { method: 'POST', body: { username } }).then((r) => {
            holder.innerHTML = '<div class="field"><label>重置码</label><input class="input mono" value="' + fmt.esc(r.code) + '" readonly id="rc-code"></div>' +
              '<p class="muted" style="font-size:12px;margin:0">有效期至 ' + fmt.time(r.expires_at) + '（' + r.ttl_minute + ' 分钟）</p>' +
              '<div style="margin-top:14px"><button class="btn" id="rc-copy">复制重置码</button></div>';
            holder.querySelector('#rc-copy').onclick = () => {
              navigator.clipboard.writeText(r.code).then(() => toast('已复制', 'ok')).catch(() => toast('复制失败', 'err'));
            };
          }).catch((e) => { holder.innerHTML = '<span style="color:var(--danger)">' + fmt.esc(App.mapError(e.message)) + '</span>'; });
        },
      });
  }

  /* ------------------------------------------------------------------ */
  const TASK_TYPES = [
    ['upload', '上传'], ['copy', '复制'], ['move', '移动'],
    ['decompress', '解压'], ['decompress_upload', '解压上传'],
  ];

  async function viewTasks(main) {
    main.innerHTML = panel('任务', '离线下载已移除，仅保留本地上传 / 复制 / 移动 / 解压任务',
      '<div class="panel-body"><div class="tabs" id="task-tabs">' +
      TASK_TYPES.map(([k, label], i) => '<button class="tab' + (i === 0 ? ' active' : '') + '" data-type="' + k + '">' + label + '</button>').join('') +
      '</div></div><div id="task-area"><div class="panel-body muted">加载中…</div></div>');

    let current = 'upload';
    const area = main.querySelector('#task-area');
    const load = async () => {
      area.innerHTML = '<div class="panel-body muted">加载中…</div>';
      try {
        const [undone, done] = await Promise.all([
          api('api/task/' + current + '/undone').catch(() => []),
          api('api/task/' + current + '/done').catch(() => []),
        ]);
        const rows = [].concat((undone || []).map((t) => [t, false]), (done || []).map((t) => [t, true]));
        if (!rows.length) { area.innerHTML = '<div class="browser-empty">暂无任务</div>'; return; }
        area.innerHTML = '<div class="table-wrap"><table class="data"><thead><tr>' +
          '<th>任务</th><th>状态</th><th>进度</th><th>创建者</th><th class="actions">操作</th></tr></thead><tbody>' +
          rows.map(([t, finished]) =>
            '<tr><td><b>' + fmt.esc(t.name) + '</b><div class="mono">' + fmt.esc(t.id) + '</div>' +
            (t.error ? '<div style="color:var(--danger);font-size:12px">' + fmt.esc(t.error) + '</div>' : '') + '</td>' +
            '<td><span class="tag' + (finished ? '' : ' ok') + '">' + fmt.esc(t.status || (finished ? '完成' : '进行中')) + '</span></td>' +
            '<td style="width:130px"><div class="progress"><i style="width:' + Math.round(t.progress || 0) + '%"></i></div>' +
            '<span class="muted" style="font-size:11.5px">' + Math.round(t.progress || 0) + '%</span></td>' +
            '<td class="muted">' + fmt.esc(t.creator || '-') + '</td>' +
            '<td class="actions"><div class="row-actions">' +
            (!finished ? '<button class="btn link" data-cancel="' + fmt.esc(t.id) + '">取消</button>' : '') +
            '<button class="btn link" data-del="' + fmt.esc(t.id) + '">删除</button>' +
            '</div></td></tr>').join('') + '</tbody></table></div>';

        area.querySelectorAll('[data-cancel]').forEach((b) => {
          b.onclick = async () => {
            try {
              await api('api/task/' + current + '/cancel?tid=' + encodeURIComponent(b.getAttribute('data-cancel')), { method: 'POST' });
              toast('已取消', 'ok'); load();
            } catch (e) { toast(App.mapError(e.message), 'err'); }
          };
        });
        area.querySelectorAll('[data-del]').forEach((b) => {
          b.onclick = async () => {
            try {
              await api('api/task/' + current + '/delete?tid=' + encodeURIComponent(b.getAttribute('data-del')), { method: 'POST' });
              toast('已删除', 'ok'); load();
            } catch (e) { toast(App.mapError(e.message), 'err'); }
          };
        });
      } catch (e) {
        area.innerHTML = '<div class="browser-empty" style="color:var(--danger)">' + fmt.esc(App.mapError(e.message)) + '</div>';
      }
    };
    main.querySelectorAll('[data-type]').forEach((b) => {
      b.onclick = () => {
        main.querySelectorAll('[data-type]').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        current = b.getAttribute('data-type');
        load();
      };
    });
    await load();
  }

  /* ------------------------------------------------------------------ */
  async function viewShares(main) {
    main.innerHTML = panel('分享链接', '所有用户创建的分享',
      '<div class="panel-body tight"><div class="table-wrap"><table class="data"><thead><tr>' +
      '<th>ID</th><th>创建者</th><th>文件</th><th>提取码</th><th>过期时间</th><th>访问</th><th class="actions">操作</th>' +
      '</tr></thead><tbody id="sh-body"><tr><td colspan="7" class="muted">加载中…</td></tr></tbody></table></div></div>');

    const body = main.querySelector('#sh-body');
    try {
      const d = await api('api/share/list?page=1&per_page=200');
      const list = (d && d.content) || [];
      if (!list.length) { body.innerHTML = '<tr><td colspan="7" class="muted" style="padding:26px 16px">暂无分享</td></tr>'; return; }
      body.innerHTML = list.map((s) => {
        const files = s.files || [];
        return '<tr><td class="mono">' + fmt.esc(s.id) + '</td>' +
          '<td>' + fmt.esc(s.creator || s.creator_name || '-') + '</td>' +
          '<td class="mono">' + fmt.esc(files.length > 1 ? files[0] + ' 等 ' + files.length + ' 项' : (files[0] || '')) + '</td>' +
          '<td>' + (s.pwd ? '<span class="tag">' + fmt.esc(s.pwd) + '</span>' : '-') + '</td>' +
          '<td class="muted">' + (s.expires ? fmt.time(s.expires) : '永久') + '</td>' +
          '<td class="muted">' + (s.accessed || 0) + '</td>' +
          '<td class="actions"><div class="row-actions">' +
          '<button class="btn link" data-copy="' + fmt.esc(s.id) + '" data-pwd="' + fmt.esc(s.pwd || '') + '">复制链接</button>' +
          '<button class="btn link" data-del="' + fmt.esc(s.id) + '">删除</button></div></td></tr>';
      }).join('');
      body.querySelectorAll('[data-copy]').forEach((b) => {
        b.onclick = () => {
          const id = b.getAttribute('data-copy');
          const pwd = b.getAttribute('data-pwd');
          const link = location.origin + App.BASE + '@s/' + id + (pwd ? '?pwd=' + encodeURIComponent(pwd) : '');
          navigator.clipboard.writeText(link).then(() => toast('已复制', 'ok')).catch(() => toast('复制失败', 'err'));
        };
      });
      body.querySelectorAll('[data-del]').forEach((b) => {
        b.onclick = async () => {
          const ok = await confirmDialog('删除分享', '删除后该链接立即失效，确定继续？', true);
          if (!ok) return;
          try {
            await api('api/share/delete?id=' + encodeURIComponent(b.getAttribute('data-del')), { method: 'POST' });
            toast('已删除', 'ok');
            viewShares(main);
          } catch (e) { toast(App.mapError(e.message), 'err'); }
        };
      });
    } catch (e) {
      body.innerHTML = '<tr><td colspan="7" style="color:var(--danger)">' + fmt.esc(App.mapError(e.message)) + '</td></tr>';
    }
  }

  /* ------------------------------------------------------------------ */
  const SETTING_TABS = [[GROUP.SITE, '站点'], [GROUP.STYLE, '样式'], [GROUP.PREVIEW, '预览'], [GROUP.GLOBAL, '全局'], [GROUP.INDEX, '索引'], [GROUP.TRAFFIC, '流量'], [GROUP.FTP, 'FTP / SFTP']];

  async function viewSettings(main) {
    main.innerHTML = panel('设置', '站点 / 样式 / 预览 / 全局 / 索引 / 流量 / FTP·SFTP',
      '<div class="panel-body"><div class="tabs" id="set-tabs">' +
      SETTING_TABS.map(([g, label], i) => '<button class="tab' + (i === 0 ? ' active' : '') + '" data-group="' + g + '">' + label + '</button>').join('') +
      '</div></div><div id="set-area"><div class="panel-body muted">加载中…</div></div>' +
      '<div class="modal-foot" style="border-top:1px solid var(--line)"><span class="muted" id="set-hint" style="margin-right:auto;font-size:12px"></span>' +
      '<button class="btn primary" id="set-save">保存设置</button></div>');

    const area = main.querySelector('#set-area');
    let all = [];
    try {
      all = await api('api/admin/setting/list?groups=1,2,3,4,5,6,7') || [];
    } catch (e) {
      area.innerHTML = '<div class="panel-body" style="color:var(--danger)">' + fmt.esc(e.message) + '</div>';
      return;
    }
    const dirty = new Set();

    function fieldHtml(it) {
      const id = 'set_' + it.key;
      const helpText = it.help || (LABELS[it.key] || ['', ''])[1];
      const help = helpText ? '<div class="help">' + fmt.esc(helpText) + '</div>' : '';
      const meta = LABELS[it.key] || [it.key, ''];
      const label = '<label for="' + id + '">' + fmt.esc(meta[0]) + ' <span class="mono" style="opacity:.55">' + fmt.esc(it.key) + '</span></label>';
      if (it.type === 'bool') {
        return '<div class="field"><label class="switch"><input type="checkbox" id="' + id + '" data-key="' + it.key + '"' +
          (String(it.value) === 'true' ? ' checked' : '') + '><span class="track"></span>' +
          '<span style="font-size:13px">' + fmt.esc((LABELS[it.key] || [it.key])[0]) + '</span></label>' + help + '</div>';
      }
      if (it.type === 'select') {
        const opts = String(it.options || '').split(',').filter(Boolean);
        return '<div class="field">' + label + '<select class="select" id="' + id + '" data-key="' + it.key + '">' +
          opts.map((o) => '<option value="' + fmt.esc(o) + '"' + (String(it.value) === o ? ' selected' : '') + '>' + fmt.esc(o) + '</option>').join('') +
          '</select>' + help + '</div>';
      }
      if (it.type === 'text') {
        return '<div class="field">' + label + '<textarea class="textarea" id="' + id + '" data-key="' + it.key + '">' + fmt.esc(it.value) + '</textarea>' + help + '</div>';
      }
      if (it.type === 'number') {
        return '<div class="field">' + label + '<input class="input" type="number" id="' + id + '" data-key="' + it.key + '" value="' + fmt.esc(it.value) + '">' + help + '</div>';
      }
      const isColor = it.key === 'main_color';
      return '<div class="field">' + label +
        (isColor
          ? '<div style="display:flex;gap:8px;align-items:center"><input type="color" id="' + id + '" data-key="' + it.key + '" value="' + fmt.esc(it.value || '#2563eb') + '" style="width:44px;height:36px;border:1px solid var(--line-strong);border-radius:9px;background:#fff">' +
          '<input class="input" data-key="' + it.key + '-text" value="' + fmt.esc(it.value) + '"></div>'
          : '<input class="input" id="' + id + '" data-key="' + it.key + '" value="' + fmt.esc(it.value) + '">') +
        help + '</div>';
    }

    function renderGroup(group) {
      const items = all.filter((it) => it.group === group && it.flag !== 3);
      area.innerHTML = '<div class="panel-body"><div class="form-row" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">' +
        items.map(fieldHtml).join('') + '</div></div>';
      area.querySelectorAll('[data-key]').forEach((el) => {
        el.addEventListener('change', () => { dirty.add(el.getAttribute('data-key')); main.querySelector('#set-hint').textContent = '有未保存的修改'; });
        el.addEventListener('input', () => { dirty.add(el.getAttribute('data-key')); });
      });
      // 颜色与文本框联动
      const color = area.querySelector('[data-key=main_color]');
      const text = area.querySelector('[data-key=main_color-text]');
      if (color && text) {
        color.oninput = () => { text.value = color.value; dirty.add('main_color'); };
        text.oninput = () => { if (/^#[0-9a-fA-F]{6}$/.test(text.value)) color.value = text.value; dirty.add('main_color'); };
      }
    }

    main.querySelectorAll('[data-group]').forEach((b) => {
      b.onclick = () => {
        main.querySelectorAll('[data-group]').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        renderGroup(parseInt(b.getAttribute('data-group'), 10));
      };
    });
    renderGroup(GROUP.SITE);

    main.querySelector('#set-save').onclick = async () => {
      const payload = [];
      dirty.forEach((key) => {
        const item = all.find((x) => x.key === key);
        if (!item) return;
        let el = area.querySelector('[data-key="' + key + '"]');
        if (key === 'main_color') el = area.querySelector('[data-key=main_color-text]') || el;
        if (!el) return;
        let value;
        if (item.type === 'bool') value = el.checked ? 'true' : 'false';
        else value = el.value;
        payload.push({ key: item.key, value: String(value), type: item.type, group: item.group, flag: item.flag });
      });
      if (!payload.length) { toast('没有需要保存的修改'); return; }
      const btn = main.querySelector('#set-save');
      btn.disabled = true;
      try {
        await api('api/admin/setting/save', { method: 'POST', body: payload });
        toast('设置已保存', 'ok');
        dirty.clear();
        main.querySelector('#set-hint').textContent = '';
        try {
          const s = await api('api/public/settings');
          Object.assign(window.Site.S.settings, s || {});
          document.title = s.site_title || '文件服务器';
          const c = s.main_color || '#2563eb';
          document.documentElement.style.setProperty('--brand', c);
          const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(c);
          if (m) document.documentElement.style.setProperty('--brand-rgb', [1, 2, 3].map((i) => parseInt(m[i], 16)).join(', '));
        } catch (e) { /* ignore */ }
      } catch (e) {
        toast(App.mapError(e.message), 'err');
      } finally { btn.disabled = false; }
    };
  }

  /* ------------------------------------------------------------------ */
  function viewAbout(main) {
    main.innerHTML =
      panel('关于本项目', '基于 OpenList 源码的 Windows 本地文件服务器改造版',
        '<div class="panel-body" style="padding:0">' +
        '<div class="about-block"><h4>这是什么</h4>' +
        '<p class="muted" style="margin:0;font-size:13px">本项目由 <b>OpenList</b> 源码改造而来，目标是把原本面向多云盘的聚合程序，' +
        '收敛成一个运行在 Windows 上、只服务于本地/内网存储的轻量 Web 文件浏览器与服务端。' +
        '全部前端资源、图标、预览依赖均由本地提供，不加载任何互联网 CDN 资源。</p></div>' +
        '<div style="border-top:1px solid var(--line)"></div>' +
        '<div class="about-block"><h4>本版本改动</h4><ul class="about-list">' +
        '<li><b>界面重写</b>：全新布局与视觉，不再沿用原项目前端风格，仅保留简体中文。</li>' +
        '<li><b>交互参考</b>：工具栏、本地设置、批量操作、预览播放器的功能清单与交互逻辑参考官方前端（OpenList-Frontend）的对应模块，再用纯静态方式重写；未引入其构建链与 monaco / artplayer 等大体积依赖。</li>' +
        '<li><b>登录增强</b>：新增「记住密码」，新增「忘记密码」与一次性重置码；命令行可用 <code>admin reset-password</code> / <code>admin reset-code</code> 重置任意用户密码。</li>' +
        '<li><b>访客模式</b>：开启后直接进入首页浏览存储；是否在首页右上角显示登录入口可在「设置 → 全局」中控制。</li>' +
        '<li><b>页面结构</b>：首页左上角返回首页、右上角进入管理或登录；管理页左上角返回管理页、右上角退出登录；首页中部展示存储列表，未添加存储时给出引导按钮。</li>' +
        '<li><b>设置分类</b>：站点 / 样式 / 预览 / 全局 / 索引 / 流量 / FTP·SFTP 七组；图标、站点图标、主题色、主页图标、分享图标、音频封面默认全部使用本地资源，OCR 使用本机 Windows OCR 引擎。</li>' +
        '<li><b>功能移除</b>：移除媒体库、离线下载、种子/传输种子、单点登录、LDAP、对象存储（S3）、WebAuthn、FFmpeg 转码等模块及其依赖。</li>' +
        '<li><b>驱动收敛</b>：仅保留 <b>本地存储、SMB、FTP、SFTP</b> 四种可在本地实现的驱动，移除全部依赖外网的云盘驱动。</li>' +
        '<li><b>部署方式</b>：可单文件 exe 直接运行，也可作为 IIS 站点（HttpPlatformHandler 反代）或通过 Node.js 守护启动。</li>' +
        '</ul></div>' +
        '<div style="border-top:1px solid var(--line)"></div>' +
        '<div class="about-block"><h4>引用与许可</h4>' +
        '<p class="muted" style="margin:0 0 10px;font-size:13px">本项目基于 OpenList 项目源码修改，遵循其原始许可证（AGPL-3.0）。' +
        '原项目地址：<a href="https://github.com/OpenListTeam/OpenList" target="_blank" rel="noopener">https://github.com/OpenListTeam/OpenList</a></p>' +
        '<div class="license-box">OpenList · GNU Affero General Public License v3.0<br>' +
        'Copyright (c) OpenListTeam and contributors<br><br>' +
        '本修改版同样以 AGPL-3.0 发布：你若通过网络向他人提供本程序的服务，需按许可证要求提供对应源码。<br>' +
        '完整许可证文本见项目根目录 LICENSE 文件。' +
        '</div></div>' +
        '</div>');
  }

  window.Admin = { render };
})();

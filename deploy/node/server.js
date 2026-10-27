#!/usr/bin/env node
/*
 * Node.js 启动器：用 Node 守护 openlist.exe，适合已有 Node 运行环境（PM2 / nssm / Windows 计划任务）的场景。
 *
 * 用法：
 *   node server.js                 # 默认监听 0.0.0.0:5245，数据目录 ./data
 *   PORT=8080 node server.js       # 指定端口
 *   HOST=127.0.0.1 node server.js  # 只监听本机（前置 Nginx/IIS 反代时使用）
 *   DATA=./mydata node server.js   # 指定数据目录
 *
 * 也可以直接 `npm start`。
 */
'use strict';

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = parseInt(process.env.PORT || '5245', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DATA = process.env.DATA || path.join(__dirname, 'data');
const EXE = process.env.EXE || path.join(__dirname, 'openlist.exe');
const RESTART_DELAY = parseInt(process.env.RESTART_DELAY || '3000', 10);

if (!fs.existsSync(EXE)) {
  console.error('[launcher] 找不到可执行文件: ' + EXE);
  console.error('[launcher] 请把 openlist.exe 放在本脚本同级目录，或用 EXE 环境变量指定路径。');
  process.exit(1);
}
fs.mkdirSync(DATA, { recursive: true });

let child = null;
let stopping = false;
let restarts = 0;

function start() {
  const args = ['server', '--data', DATA];
  console.log(`[launcher] 启动 ${EXE} ${args.join(' ')}（监听 ${HOST}:${PORT}）`);
  child = spawn(EXE, args, {
    cwd: path.dirname(EXE),
    env: Object.assign({}, process.env, {
      OPENLIST_HTTP_PORT: String(PORT),
      OPENLIST_ADDR: HOST,
    }),
    stdio: 'inherit',
    windowsHide: false,
  });

  child.on('exit', (code, signal) => {
    if (stopping) return;
    restarts += 1;
    console.error(`[launcher] 进程退出（code=${code}, signal=${signal}），${RESTART_DELAY}ms 后重启（第 ${restarts} 次）`);
    setTimeout(start, RESTART_DELAY);
  });

  child.on('error', (err) => {
    console.error('[launcher] 启动失败：' + err.message);
  });

  waitReady();
}

function waitReady(attempt) {
  attempt = attempt || 0;
  const req = http.request({ host: '127.0.0.1', port: PORT, path: '/ping', timeout: 1200 }, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => {
      if (body.trim() === 'pong') {
        console.log(`[launcher] 服务就绪：http://127.0.0.1:${PORT}`);
      } else if (attempt < 40) {
        setTimeout(() => waitReady(attempt + 1), 300);
      }
    });
  });
  req.on('error', () => {
    if (attempt < 40) setTimeout(() => waitReady(attempt + 1), 300);
  });
  req.on('timeout', () => req.destroy());
  req.end();
}

function shutdown(sig) {
  if (stopping) return;
  stopping = true;
  console.log('[launcher] 收到 ' + sig + '，正在停止服务…');
  if (child) {
    child.kill();
    setTimeout(() => process.exit(0), 1500);
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGHUP', () => shutdown('SIGHUP'));

start();

// ==UserScript==
// @name         CleanShare - 分享链接净化 (Bilibili & YouTube)
// @namespace    https://github.com/JayeGT002/CleanShare
// @version      2.3.1
// @description  替换Bilibili/YouTube的分享行为：复制"标题 净化后链接"，去除跟踪参数。支持油猴菜单打开设置面板。
// @author       JayeGT002
// @license      MIT
// @match        https://www.bilibili.com/video/*
// @match        https://www.bilibili.com/list/*
// @match        https://www.bilibili.com/watchlater/*
// @match        https://www.bilibili.com/bangumi/play/*
// @match        https://m.bilibili.com/video/*
// @match        https://www.youtube.com/watch*
// @match        https://m.youtube.com/watch*
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const host = location.hostname;
  const isBili = host.includes('bilibili.com');
  const isYT = host.includes('youtube.com');

  // 保存原始剪贴板方法（作为复制失败时的兜底）
  const _originalWriteText =
    typeof navigator !== 'undefined' && navigator.clipboard
      ? navigator.clipboard.writeText.bind(navigator.clipboard)
      : null;

  // ========== 配置 ==========
  const CONFIG_KEY = 'share_cleaner_config_v2';
  const DEFAULT_CONFIG = {
    ytMode: 'B', // A: 直接复制  B: 劫持面板复制按钮
    biliBvBtn: true
  };

  function getConfig() {
    if (typeof GM_getValue === 'function') {
      const v = GM_getValue(CONFIG_KEY, DEFAULT_CONFIG);
      if (v && typeof v === 'object') return Object.assign({}, DEFAULT_CONFIG, v);
    }
    return Object.assign({}, DEFAULT_CONFIG);
  }

  function saveConfig(cfg) {
    if (typeof GM_setValue === 'function') GM_setValue(CONFIG_KEY, cfg);
  }

  // ========== 工具函数 ==========

  function getCleanUrl() {
    const u = new URL(location.href);
    if (isBili) {
      const m = u.pathname.match(/\/video\/(BV[\w]+|av\d+)/i);
      if (m) return `https://www.bilibili.com/video/${m[1]}/`;
      const ep = u.pathname.match(/\/bangumi\/play\/(ep\d+|ss\d+)/i);
      if (ep) return `https://www.bilibili.com/bangumi/play/${ep[1]}/`;
      return `https://www.bilibili.com${u.pathname}`;
    }
    if (isYT) {
      const v = u.searchParams.get('v');
      if (v) return `https://www.youtube.com/watch?v=${v}`;
      const m = u.pathname.match(/^\/([\w-]{11})$/);
      if (m) return `https://www.youtube.com/watch?v=${m[1]}`;
      return location.href;
    }
    return location.href;
  }

  function getTitle() {
    if (isBili) {
      const el = document.querySelector(
        '#viewbox_report h1, .video-info-container h1, h1.video-title, .bangumi-info-container h1'
      );
      if (el && el.textContent.trim()) return el.textContent.trim();
      let t = document.title || '';
      t = t.replace(/\s*[-_]\s*哔哩哔哩_bilibili.*$/i, '')
           .replace(/\s*_哔哩哔哩.*$/i, '')
           .replace(/\s*-\s*哔哩哔哩.*$/i, '')
           .trim();
      return t;
    }
    if (isYT) {
      const el = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string');
      if (el && el.textContent.trim()) return el.textContent.trim();
      return (document.title || '').replace(/\s*-\s*YouTube\s*$/i, '').trim();
    }
    return document.title || '';
  }

  function buildShareText() {
    return `${getTitle()} ${getCleanUrl()}`;
  }

  // 复制到剪贴板（Safari 兼容优先，用原始 writeText 避免 hook 递归）
  function copyToClipboard(text) {
    let execOk = false;
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      Object.assign(ta.style, {
        position: 'fixed', top: '0', left: '0', width: '2em', height: '2em',
        padding: '0', border: 'none', background: 'transparent', color: 'transparent',
        opacity: '0', fontSize: '16px', pointerEvents: 'none', zIndex: '-1'
      });
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      execOk = document.execCommand('copy');
      ta.remove();
    } catch (_) { execOk = false; }
    if (typeof GM_setClipboard === 'function') {
      try { GM_setClipboard(text); } catch (_) {}
    }
    if (execOk) return Promise.resolve(true);
    if (_originalWriteText) {
      return _originalWriteText(text).catch(() => Promise.reject(new Error('复制失败')));
    }
    return Promise.reject(new Error('无可用的剪贴板 API'));
  }

  // 气泡提示：白底 + 阴影 + 黑字
  function showToast(text) {
    const toast = document.createElement('div');
    toast.textContent = text;
    Object.assign(toast.style, {
      position: 'fixed', top: '24px', left: '50%', transform: 'translateX(-50%)',
      padding: '10px 20px', background: '#fff', color: '#333',
      fontSize: '14px', lineHeight: '1.5', borderRadius: '8px',
      zIndex: '2147483647', fontFamily: 'system-ui, -apple-system, sans-serif',
      boxShadow: '0 4px 16px rgba(0,0,0,0.15)', border: '1px solid rgba(0,0,0,0.06)',
      transition: 'opacity 0.25s ease, transform 0.25s ease', pointerEvents: 'none',
      whiteSpace: 'nowrap'
    });
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.transform = 'translateX(-50%) translateY(-4px)';
    });
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 1500);
  }

  // ========== 设置面板 ==========
  // 注意：YouTube 启用了 Trusted Types，禁止 innerHTML 赋值。
  // 因此整个面板用 createElement DOM API 构建，避免 CSP 报错。

  let settingsPanel = null;

  // 辅助：创建带样式的元素
  function el(tag, styles, text) {
    const e = document.createElement(tag);
    if (styles) Object.assign(e.style, styles);
    if (text != null) e.textContent = text;
    return e;
  }

  function openSettings() {
    if (settingsPanel) {
      settingsPanel.remove();
      settingsPanel = null;
    }
    const cfg = getConfig();

    const overlay = el('div', {
      position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
      background: 'rgba(0,0,0,0.35)', zIndex: '2147483646',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    });

    // 面板容器
    const panel = el('div', {
      background: '#fff', borderRadius: '12px',
      boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
      width: '580px', maxWidth: '92vw', overflow: 'hidden'
    });

    // 标题栏
    const header = el('div', {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '16px 20px', borderBottom: '1px solid #f0f0f0'
    });
    header.appendChild(el('span', { fontSize: '16px', fontWeight: '600', color: '#1a1a1a' }, '分享链接净化 · 设置'));
    const closeBtn = el('span', { cursor: 'pointer', fontSize: '18px', color: '#999', padding: '4px 8px', lineHeight: '1' }, '✕');
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // 主体：左侧导航 + 右侧内容
    const body = el('div', { display: 'flex', height: '340px' });

    const nav = el('div', {
      width: '150px', borderRight: '1px solid #f0f0f0', padding: '8px 0', flexShrink: '0'
    });
    const navData = [
      { key: 'youtube', label: 'YouTube' },
      { key: 'bilibili', label: 'Bilibili' }
    ];
    const navItems = navData.map((n) => {
      const item = el('div', {
        padding: '11px 20px', cursor: 'pointer', fontSize: '14px',
        color: '#555', borderLeft: '3px solid transparent'
      }, n.label);
      item.dataset.tab = n.key;
      nav.appendChild(item);
      return item;
    });
    body.appendChild(nav);

    const content = el('div', { flex: '1', padding: '24px', overflowY: 'auto' });

    // YouTube 子项
    const ytTab = el('div');
    ytTab.dataset.tab = 'youtube';
    ytTab.appendChild(el('div', { fontSize: '15px', fontWeight: '600', marginBottom: '16px', color: '#1a1a1a' }, '分享行为'));

    const ytRadios = [];
    [
      { value: 'A', label: '方案A · 直接复制（面板不弹出）' },
      { value: 'B', label: '方案B · 劫持面板复制按钮（推荐）' }
    ].forEach((opt) => {
      const label = el('label', { display: 'flex', alignItems: 'center', padding: '10px 0', cursor: 'pointer', fontSize: '14px', color: '#444' });
      const radio = el('input', { marginRight: '10px', accentColor: '#2563eb' });
      radio.type = 'radio';
      radio.name = 'ytMode';
      radio.value = opt.value;
      if (opt.value === cfg.ytMode) radio.checked = true;
      label.appendChild(radio);
      label.appendChild(document.createTextNode(' ' + opt.label));
      ytTab.appendChild(label);
      ytRadios.push(radio);
    });
    const ytHint = el('div', {
      marginTop: '16px', padding: '12px', background: '#f8f9fa', borderRadius: '8px',
      fontSize: '12px', color: '#888', lineHeight: '1.6'
    }, '方案A：点击分享按钮直接复制，原生面板不弹出。\n方案B：保留原生分享面板，点击面板内"复制"时替换为净化链接。');
    ytHint.style.whiteSpace = 'pre-line';
    ytTab.appendChild(ytHint);
    content.appendChild(ytTab);

    // Bilibili 子项
    const biliTab = el('div');
    biliTab.dataset.tab = 'bilibili';
    biliTab.style.display = 'none';
    biliTab.appendChild(el('div', { fontSize: '15px', fontWeight: '600', marginBottom: '16px', color: '#1a1a1a' }, 'Bilibili'));
    const biliLabel = el('label', { display: 'flex', alignItems: 'center', padding: '10px 0', cursor: 'pointer', fontSize: '14px', color: '#444' });
    const biliCheckbox = el('input', { marginRight: '10px', accentColor: '#2563eb' });
    biliCheckbox.type = 'checkbox';
    biliCheckbox.id = 'sc-bili-bv';
    biliCheckbox.checked = cfg.biliBvBtn;
    biliLabel.appendChild(biliCheckbox);
    biliLabel.appendChild(document.createTextNode(' 启用 BV 号复制按钮'));
    biliTab.appendChild(biliLabel);
    const biliHint = el('div', {
      marginTop: '16px', padding: '12px', background: '#f8f9fa', borderRadius: '8px',
      fontSize: '12px', color: '#888', lineHeight: '1.6'
    }, '在视频工具栏添加「BV号」按钮，点击一键复制纯 BV 号。');
    biliTab.appendChild(biliHint);
    content.appendChild(biliTab);

    body.appendChild(content);
    panel.appendChild(body);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    settingsPanel = overlay;

    // 导航切换
    const tabs = [ytTab, biliTab];
    function switchTab(name) {
      navItems.forEach((n) => {
        const active = n.dataset.tab === name;
        n.style.background = active ? '#f5f7fa' : 'transparent';
        n.style.color = active ? '#1a1a1a' : '#555';
        n.style.fontWeight = active ? '600' : '400';
        n.style.borderLeftColor = active ? '#2563eb' : 'transparent';
      });
      tabs.forEach((t) => {
        t.style.display = t.dataset.tab === name ? 'block' : 'none';
      });
    }
    navItems.forEach((n) => n.addEventListener('click', () => switchTab(n.dataset.tab)));
    switchTab('youtube');

    // 保存配置
    ytRadios.forEach((r) => {
      r.addEventListener('change', () => {
        const c = getConfig();
        c.ytMode = r.value;
        saveConfig(c);
        showToast('已保存');
      });
    });
    biliCheckbox.addEventListener('change', () => {
      const c = getConfig();
      c.biliBvBtn = biliCheckbox.checked;
      saveConfig(c);
      showToast('已保存');
      // 立即生效：注入或移除按钮
      injectBvButton();
    });

    // 关闭交互
    const close = () => {
      overlay.remove();
      settingsPanel = null;
    };
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', function escClose(e) {
      if (e.key === 'Escape' && settingsPanel) {
        close();
        document.removeEventListener('keydown', escClose);
      }
    });
  }

  function registerMenu() {
    if (typeof GM_registerMenuCommand !== 'function') return;
    GM_registerMenuCommand('⚙ 打开设置面板', () => openSettings());
  }

  // ========== 分享按钮识别 ==========

  function isBilibiliShareButton(target) {
    const direct = target.closest('.video-share, [class*="video-share"], .share-container, [class*="share-container"]');
    if (direct) return true;
    const btn = target.closest('.toolbar-left-item-wrap, .video-toolbar-left, .video-toolbar-left-main, [class*="toolbar-left-item"], button, a');
    if (btn) {
      const txt = (btn.textContent || '').trim();
      if (txt && /分享/.test(txt) && txt.length <= 6) {
        const inToolbar = btn.closest('#arc_toolbar_report, .video-toolbar-container, .video-toolbar, [class*="toolbar"]');
        if (inToolbar) return true;
        if (host.startsWith('m.')) return true;
      }
    }
    return false;
  }

  function isYouTubeShareButton(target) {
    const btn1 = target.closest('button.ytSpecButtonShapeNextHost, button.yt-spec-button-shape-next');
    if (btn1) {
      const label = (btn1.getAttribute('aria-label') || '').trim();
      const txt = (btn1.textContent || '').trim();
      if (/^(share|分享)$/i.test(label) || /^(share|分享)$/i.test(txt)) {
        if (btn1.closest('yt-player-quick-action-buttons, .ytp-player-content, .html5-video-player')) return false;
        return true;
      }
    }
    const btn2 = target.closest('ytd-button-renderer');
    if (btn2) {
      const inner = btn2.querySelector('button');
      const label = (inner?.getAttribute('aria-label') || '').trim();
      const txt = (btn2.textContent || '').trim();
      if (/^(share|分享)$/i.test(label) || /^(share|分享)$/i.test(txt)) return true;
    }
    return false;
  }

  function isYouTubeCopyButton(target) {
    const btn = target.closest('button');
    if (!btn) return false;
    const label = (btn.getAttribute('aria-label') || '').trim();
    const txt = (btn.textContent || '').trim();
    if (!/^(copy|复制)$/i.test(label) && !/^(copy|复制)$/i.test(txt)) return false;
    return !!btn.closest('yt-copy-link-renderer, yt-sharing-renderer, yt-third-party-network-section-renderer, tp-yt-paper-dialog, [role="dialog"]');
  }

  // ========== Bilibili: BV 号复制按钮注入 ==========

  // 提取当前页面的 BV 号 / av 号
  function getBvId() {
    const m = location.pathname.match(/\/video\/(BV[\w]+|av\d+)/i);
    return m ? m[1] : '';
  }

  // 创建 BV 号复制按钮（复用 B 站原生工具栏 class，样式与点赞/分享一致）
  function createBvButton() {
    const wrap = document.createElement('div');
    wrap.className = 'toolbar-left-item-wrap sc-bv-btn';
    wrap.setAttribute('title', '复制 BV 号');

    const inner = document.createElement('div');
    // 复用原生 class，继承 color/fontSize/fontWeight/flex 等样式
    inner.className = 'video-toolbar-left-item';
    wrap.appendChild(inner);

    // 图标：28×28 viewBox 0 0 28 28，与分享按钮图标尺寸一致，fill=currentColor
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '28');
    svg.setAttribute('height', '28');
    svg.setAttribute('viewBox', '0 0 28 28');
    svg.setAttribute('class', 'video-toolbar-item-icon');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    // B 站官方"复制链接"图标（分享面板内），实心风格与点赞/投币/收藏一致
    path.setAttribute('d', 'M12.6058 10.3326V5.44359C12.6058 4.64632 13.2718 4 14.0934 4C14.4423 4 14.78 4.11895 15.0476 4.33606L25.3847 12.7221C26.112 13.3121 26.2087 14.3626 25.6007 15.0684C25.5352 15.1443 25.463 15.2144 25.3847 15.2779L15.0476 23.6639C14.4173 24.1753 13.4791 24.094 12.9521 23.4823C12.7283 23.2226 12.6058 22.8949 12.6058 22.5564V18.053C7.59502 18.053 5.37116 19.9116 2.57197 23.5251C2.47607 23.6489 2.00031 23.7769 2.00031 23.2122C2.00031 16.2165 3.90102 10.3326 12.6058 10.3326Z');
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    inner.appendChild(svg);

    // 文字：复用原生文字 class
    const txt = document.createElement('div');
    txt.className = 'video-toolbar-item-text';
    const span = document.createElement('span');
    span.textContent = 'BV号';
    txt.appendChild(span);
    inner.appendChild(txt);

    // 点击复制 BV 号
    wrap.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (!shouldHandle()) return;
      const bv = getBvId();
      if (!bv) {
        showToast('未识别到 BV 号');
        return;
      }
      try {
        await copyToClipboard(bv);
        showToast('已复制 BV 号');
      } catch (err) {
        console.error('[CleanShare] BV 复制失败:', err);
        showToast('复制失败');
      }
    });

    return wrap;
  }

  // 注入按钮到 B 站工具栏（SPA 友好，防重复注入；根据配置开关）
  function injectBvButton() {
    if (!isBili) return;
    const cfg = getConfig();
    const existing = document.querySelector('.sc-bv-btn');
    if (!cfg.biliBvBtn) {
      // 配置关闭：移除已注入的按钮
      if (existing) existing.remove();
      return;
    }
    if (existing) return; // 已注入
    const toolbar = document.querySelector(
      '#arc_toolbar_report .toolbar-left, .video-toolbar-container .toolbar-left, #arc_toolbar_report .video-toolbar-left-main, .video-toolbar-left-main'
    );
    if (!toolbar) return;
    const btn = createBvButton();
    toolbar.appendChild(btn);
  }

  // 用 MutationObserver 监听工具栏出现（B 站 SPA 动态加载）
  function setupBiliBvButton() {
    if (!isBili) return;
    injectBvButton(); // 立即尝试一次
    const observer = new MutationObserver(() => injectBvButton());
    observer.observe(document.body, { childList: true, subtree: true });
    // URL 变化时重新注入（SPA 切换视频）
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(injectBvButton, 500);
      }
    }, 1000);
  }

  // ========== 事件处理 ==========

  let lastShareTs = 0;
  function shouldHandle() {
    const now = Date.now();
    if (now - lastShareTs < 800) return false;
    lastShareTs = now;
    return true;
  }

  async function handleShareClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (!shouldHandle()) return;
    const text = buildShareText();
    try {
      await copyToClipboard(text);
      showToast('复制成功');
    } catch (err) {
      console.error('[分享净化] 复制失败:', err);
      showToast('复制失败');
    }
  }

  // ========== 注册监听 ==========

  function setup() {
    if (!isBili && !isYT) return;
    const cfg = getConfig();

    const events = ['pointerdown', 'mousedown', 'click'];
    events.forEach((evt) => {
      document.addEventListener(
        evt,
        (e) => {
          const target = e.target;
          if (!target || target.nodeType !== 1) return;
          if (isBili) {
            if (isBilibiliShareButton(target)) handleShareClick(e);
          } else if (isYT) {
            if (cfg.ytMode === 'A') {
              if (isYouTubeShareButton(target)) handleShareClick(e);
            } else {
              if (isYouTubeCopyButton(target)) handleShareClick(e);
            }
          }
        },
        true
      );
    });
  }

  // 启动
  registerMenu();
  setup();
  setupBiliBvButton();
})();

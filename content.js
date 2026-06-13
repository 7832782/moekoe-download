// == MoeKoe Download - Content Script ==
(function () {
  'use strict';

  if (document.documentElement.dataset.moekoeDownloadReady) return;
  console.log('[MoeKoe Download] 插件已加载');

  // =============================================
  //  常量
  // =============================================
  var API_BASE = (function () {
    try {
      var saved = JSON.parse(localStorage.getItem('settings') || '{}');
      return saved.apiBaseUrl || 'http://127.0.0.1:6521';
    } catch (e) {
      return 'http://127.0.0.1:6521';
    }
  })();

  // =============================================
  //  1. 注入 hook.js（绕过 CSP）
  // =============================================
  function injectHook() {
    try {
      var hookUrl = chrome.runtime.getURL('hook.js');
      var script = document.createElement('script');
      script.src = hookUrl;
      script.onload = function () {
        console.log('[MoeKoe Download] hook.js 已加载');
        document.documentElement.dataset.moekoeDownloadReady = '1';
      };
      script.onerror = function () {
        console.error('[MoeKoe Download] hook.js 加载失败:', hookUrl);
      };
      document.documentElement.appendChild(script);
    } catch (e) {
      console.error('[MoeKoe Download] Hook 注入失败:', e);
    }
  }

  // =============================================
  //  2. 工具函数
  // =============================================
  function getExtension(url) {
    if (!url) return 'mp3';
    var m = url.match(/\.(mp3|flac|aac|ogg|wav|mp4|webm|ape)(\?|$)/i);
    if (m) return m[1].toLowerCase();
    var player = document.querySelector('.player-container');
    var badge = player ? player.querySelector('.quality-badge') : null;
    if (badge) {
      var t = badge.textContent.trim();
      if (t.indexOf('FLAC') !== -1 || t.indexOf('Hi-Res') !== -1 || t.indexOf('母带') !== -1) return 'flac';
      if (t.indexOf('全景声') !== -1 || t.indexOf('超清') !== -1) return 'flac';
    }
    return 'mp3';
  }

  function getSongMeta() {
    var player = document.querySelector('.player-container');
    var title = player ? player.querySelector('.song-title') : null;
    var artist = player ? player.querySelector('.artist') : null;
    return {
      name: title ? title.textContent.trim() : '未知歌曲',
      artist: artist ? artist.textContent.trim() : '未知艺术家'
    };
  }

  function sanitize(s) {
    return s.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, ' ').trim() || 'download';
  }

  function buildAuthHeader() {
    try {
      var raw = localStorage.getItem('MoeData');
      if (!raw) return '';
      var data = JSON.parse(raw);
      var user = data.UserInfo || {};
      var dev = data.Device || {};
      var parts = [];
      if (user.token) parts.push('token=' + user.token);
      if (user.userid) parts.push('userid=' + user.userid);
      if (dev.dfid) parts.push('dfid=' + dev.dfid);
      if (user.t1) parts.push('t1=' + user.t1);
      if (dev.mid) parts.push('KUGOU_API_MID=' + dev.mid);
      if (dev.guid) parts.push('KUGOU_API_GUID=' + dev.guid);
      if (dev.serverDev) parts.push('KUGOU_API_DEV=' + dev.serverDev);
      if (dev.mac) parts.push('KUGOU_API_MAC=' + dev.mac);
      return parts.join(';');
    } catch (e) {
      return '';
    }
  }

  function getPreferredQuality() {
    try {
      var s = JSON.parse(localStorage.getItem('settings') || '{}');
      return s.quality || '320';
    } catch (e) {
      return '320';
    }
  }

  var QUALITY_CHAIN = ['128', '320', 'flac', 'high', 'viper_atmos', 'viper_clear', 'viper_tape'];
  var QUALITY_LABELS = {
    '128': '标准',
    '320': '高品',
    flac: 'FLAC',
    high: 'Hi-Res',
    viper_atmos: '全景声',
    viper_clear: '超清',
    viper_tape: '母带'
  };

  function fetchSongUrl(hash, quality) {
    var auth = buildAuthHeader();
    var url = API_BASE + '/song/url?hash=' + encodeURIComponent(hash) + '&quality=' + encodeURIComponent(quality);
    var opts = { headers: {} };
    if (auth) opts.headers['Authorization'] = auth;
    return fetch(url, opts).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      var u = null;
      if (d && d.url && Array.isArray(d.url) && d.url[0]) u = d.url[0];
      else if (d && d.data && d.data.url) u = d.data.url;
      if (u) return { url: u, quality: quality };
      throw new Error('响应中未找到音频 URL');
    }).catch(function (err) {
      var idx = QUALITY_CHAIN.indexOf(quality);
      if (idx > 0) return fetchSongUrl(hash, QUALITY_CHAIN[idx - 1]);
      throw err;
    });
  }

  function buildFilename(name, author, ext) {
    var parts = [];
    if (name) parts.push(name);
    if (author) parts.push(author);
    return sanitize(parts.join(' - ')) + '.' + ext;
  }

  // =============================================
  //  3. 单曲下载 (blob → <a download>)
  // =============================================
  function onDownload() {
    var url = document.documentElement.dataset.moekoeAudioUrl || '';
    if (!url) {
      var allAudio = document.querySelectorAll('audio');
      for (var i = 0; i < allAudio.length; i++) {
        if (allAudio[i].src && allAudio[i].src !== '') { url = allAudio[i].src; break; }
      }
    }
    if (!url || url === '') {
      alert('暂无歌曲可下载。请先播放一首歌后重试。');
      return;
    }
    var meta = getSongMeta();
    var ext = getExtension(url);
    var filename = buildFilename(meta.name, meta.artist, ext);

    var btn = document.querySelector('.moekoe-download-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i>'; }

    fetch(url).then(function (resp) {
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return resp.blob();
    }).then(function (blob) {
      triggerBlobDownload(blob, filename);
    }).catch(function (err) {
      console.error('[MoeKoe Download] 下载失败:', err);
      alert('下载失败: ' + err.message);
    }).finally(function () {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-download"></i>'; }
    });
  }

  // =============================================
  //  4. 触发 blob 下载（单曲用）
  // =============================================
  function triggerBlobDownload(blob, filename) {
    var blobUrl = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    }, 5000);
  }

  // =============================================
  //  5. 批量下载（支持暂停/继续）
  // =============================================
  var BATCH = {
    songs: null,       // 歌曲列表
    index: 0,          // 当前进度
    state: 'idle',     // idle | picking | running | paused | done
    btn: null,         // 按钮 DOM
    quality: '320',
    success: 0,
    fail: 0,
    failures: []       // [{name, reason}]
  };
  var FSA_TIMEOUT = 86400000; // 24h，相当于不限时

  function onBatchDownload() {
    var s = BATCH.state;

    // 下载中 → 暂停
    if (s === 'running') {
      BATCH.state = 'paused';
      updateBatchBtn(BATCH.btn, '暂停中 ' + BATCH.songs[BATCH.index].name);
      return;
    }

    // 暂停中 → 继续
    if (s === 'paused') {
      BATCH.state = 'running';
      updateBatchBtn(BATCH.btn, (BATCH.index + 1) + '/' + BATCH.songs.length + ' ' + BATCH.songs[BATCH.index].name);
      processFSA();
      return;
    }

    // 已完成 → 重置
    if (s === 'done') {
      resetBatch();
      return;
    }

    // idle: 开始新批次
    var raw = document.documentElement.dataset.moekoeSongs || '';
    if (!raw) { alert('未获取到歌单数据。请先打开一个歌单页面，等待歌曲列表加载完成后重试。'); return; }
    try { BATCH.songs = JSON.parse(raw); } catch(e) { BATCH.songs = null; }
    if (!BATCH.songs || !BATCH.songs.length) { alert('歌单数据为空'); return; }
    if (BATCH.songs.length > 50 && !confirm('该歌单有 ' + BATCH.songs.length + ' 首歌，确认开始下载？')) return;

    BATCH.index = 0;
    BATCH.state = 'picking';
    BATCH.btn = document.querySelector('.moekoe-batch-btn');
    BATCH.quality = getPreferredQuality();
    BATCH.success = 0;
    BATCH.fail = 0;
    BATCH.failures = [];

    delete document.documentElement.dataset.moekoeFSAReady;
    delete document.documentElement.dataset.moekoeFSAError;
    delete document.documentElement.dataset.moekoeFSACancelled;

    updateBatchBtn(BATCH.btn, '选择下载目录...');
    window.postMessage({ type: 'MOEKOE_FSA_PICK' }, '*');

    var waited = 0;
    var pickTimer = setInterval(function () {
      waited += 300;

      if (document.documentElement.dataset.moekoeFSAReady === '1') {
        clearInterval(pickTimer);
        BATCH.state = 'running';
        processFSA();
        return;
      }

      if (document.documentElement.dataset.moekoeFSACancelled === '1') {
        clearInterval(pickTimer);
        resetBatch();
        return;
      }

      if (document.documentElement.dataset.moekoeFSAError) {
        clearInterval(pickTimer);
        console.warn('[MoeKoe Download] FSA 失败:', document.documentElement.dataset.moekoeFSAError);
        alert('目录选择失败：' + document.documentElement.dataset.moekoeFSAError);
        resetBatch();
        return;
      }

      if (waited >= FSA_TIMEOUT) {
        clearInterval(pickTimer);
        console.warn('[MoeKoe Download] FSA 超时');
        resetBatch();
      }
    }, 300);
  }

  function processFSA() {
    // 暂停了就不继续
    if (BATCH.state === 'paused') return;
    // 完成
    if (BATCH.index >= BATCH.songs.length) {
      BATCH.state = 'done';
      updateBatchBtn(BATCH.btn, '完成 (' + BATCH.songs.length + ')');
      // 有失败 → 写失败日志
      if (BATCH.failures.length > 0) {
        writeFailureLog();
      }
      setTimeout(resetBatch, 3000);
      if (BATCH.fail > 0) alert('完成：' + BATCH.success + ' 首成功，' + BATCH.fail + ' 首失败');
      return;
    }

    var song = BATCH.songs[BATCH.index];
    updateBatchBtn(BATCH.btn, (BATCH.index + 1) + '/' + BATCH.songs.length + ' ' + song.name);

    fetchSongUrl(song.hash, BATCH.quality).then(function (res) {
      if (BATCH.state === 'paused') return;
      return fetch(res.url).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob();
      }).then(function (blob) {
        if (BATCH.state === 'paused') return;
        var ext = getExtension(res.url);
        var name = buildFilename(song.name, song.author, ext);
        return new Promise(function (resolve, reject) {
          delete document.documentElement.dataset.moekoeFSAWritten;
          delete document.documentElement.dataset.moekoeFSAError;

          window.postMessage({ type: 'MOEKOE_FSA_WRITE', filename: name, blob: blob }, '*');

          var timeout = setTimeout(function () { reject(new Error('写文件超时')); }, 30000);
          var check = setInterval(function () {
            if (BATCH.state === 'paused') { clearTimeout(timeout); clearInterval(check); resolve('paused'); return; }
            if (document.documentElement.dataset.moekoeFSAWritten === name) { clearTimeout(timeout); clearInterval(check); resolve(); return; }
            if (document.documentElement.dataset.moekoeFSAError) {
              clearTimeout(timeout); clearInterval(check);
              reject(new Error(document.documentElement.dataset.moekoeFSAError));
            }
          }, 200);
        });
      });
    }).then(function (result) {
      if (result !== 'paused') BATCH.success++;
      BATCH.index++;
      if (BATCH.state === 'running') setTimeout(processFSA, 200);
    }).catch(function (err) {
      var failedSong = BATCH.songs[BATCH.index] || {};
      console.error('[MoeKoe Download] 失败:', failedSong.name, err.message);
      BATCH.fail++;
      BATCH.failures.push({ name: failedSong.name || '未知', author: failedSong.author || '', reason: err.message });
      BATCH.index++;
      if (BATCH.state === 'running') setTimeout(processFSA, 200);
    });
  }

  function resetBatch() {
    BATCH.songs = null;
    BATCH.index = 0;
    BATCH.state = 'idle';
    BATCH.btn = null;
    BATCH.success = 0;
    BATCH.fail = 0;
    updateBatchBtn(document.querySelector('.moekoe-batch-btn'), '下载全部');
  }

  function updateBatchBtn(btn, text) {
    if (!btn) return;
    btn.textContent = text || '下载全部';
  }

  // 在下载目录生成失败记录文件
  function writeFailureLog() {
    var lines = ['下载失败记录', '---', ''];
    BATCH.failures.forEach(function (f) {
      lines.push('歌曲: ' + f.name + (f.author ? ' - ' + f.author : ''));
      lines.push('原因: ' + f.reason);
      lines.push('');
    });
    var content = lines.join('\n');
    var blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    var filename = '_下载失败_' + BATCH.failures.length + '首.txt';
    window.postMessage({ type: 'MOEKOE_FSA_WRITE', filename: filename, blob: blob }, '*');
  }

  // =============================================
  //  6. 导出歌单为 txt
  // =============================================
  function onExportPlaylist() {
    var raw = document.documentElement.dataset.moekoeSongs || '';
    if (!raw) { alert('未获取到歌单数据。请先打开一个歌单页面，等待加载完成后重试。'); return; }
    var songs;
    try { songs = JSON.parse(raw); } catch(e) { songs = null; }
    if (!songs || !songs.length) { alert('歌单数据为空'); return; }

    // 从 DOM 中读取可见歌曲的专辑名，按 (歌名,歌手) 匹配补充
    var domAlbums = {};
    var domItems = document.querySelectorAll('.cover-view');
    domItems.forEach(function (item) {
      var titleEl = item.querySelector('.track-title-text');
      var artistEl = item.querySelector('.track-artist');
      var albumEl = item.querySelector('.track-album');
      if (titleEl && artistEl && albumEl) {
        var key = (titleEl.textContent.trim() + '|' + artistEl.textContent.trim()).toLowerCase();
        domAlbums[key] = albumEl.textContent.trim();
      }
    });

    var lines = [];
    songs.forEach(function (s) {
      var songName = s.songname || s.SongName || s.song_name || s.audio_name || (s.base && s.base.audio_name) || s.name || '';
      var artist = s.singername || s.SingerName || s.singer_name || s.author_name || (s.base && s.base.author_name) || s.author || '';
      var album = s.album_name || s.AlbumName || s.albumname || s.album || (s.base && s.base.album_name) || '';
      // 从 DOM 补专辑名
      if (!album) {
        var key = (songName + '|' + artist).toLowerCase();
        if (domAlbums[key]) album = domAlbums[key];
      }
      var parts = [];
      if (songName) parts.push(songName);
      if (artist) parts.push(artist);
      if (album) parts.push(album);
      lines.push(parts.join('-'));
    });
    var content = lines.join('\n');

    var blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    var now = new Date();
    var dateStr = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    var filename = '歌单_' + dateStr + '.txt';
    triggerBlobDownload(blob, filename);
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  // ---- 5b. 回退：逐个 <a download> ----
  function batchDownloadLegacy(songs) {
    if (songs.length > 50 && !confirm('该歌单有 ' + songs.length + ' 首歌，确认开始下载？')) return;

    isBatchRunning = true;
    var quality = getPreferredQuality();
    var success = 0, fail = 0;
    var btn = document.querySelector('.moekoe-batch-btn');
    updateBatchBtn(btn, '0/' + songs.length);

    function next(i) {
      if (i >= songs.length) {
        isBatchRunning = false;
        updateBatchBtn(btn, '完成 (' + success + '/' + songs.length + ')');
        setTimeout(function () { updateBatchBtn(btn, '下载全部'); }, 3000);
        console.log('[MoeKoe Download] 批量完成:', success + '成功, ' + fail + '失败');
        if (fail > 0) alert('完成：' + success + ' 首成功，' + fail + ' 首失败');
        return;
      }

      var song = songs[i];
      updateBatchBtn(btn, (i + 1) + '/' + songs.length + ' ' + song.name);

      fetchSongUrl(song.hash, quality).then(function (res) {
        return fetch(res.url).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.blob();
        }).then(function (blob) {
          var ext = getExtension(res.url);
          var name = buildFilename(song.name, song.author, ext);
          triggerBlobDownload(blob, name);
          success++;
        });
      }).catch(function (err) {
        console.error('[MoeKoe Download] 下载失败:', song.name, err.message);
        fail++;
      }).then(function () {
        setTimeout(function () { next(i + 1); }, 500);
      });
    }
    next(0);
  }

  // =============================================
  //  7. 注入所有按钮
  // =============================================
  function addButtons() {
    // 单曲下载
    var container = document.querySelector('.extra-controls');
    if (container && !document.querySelector('.moekoe-download-btn')) {
      var btn = document.createElement('button');
      btn.className = 'extra-btn moekoe-download-btn';
      // 拷贝已有 extra-btn 的 Vue scoped 属性，确保样式匹配
      var refBtn = container.querySelector('.extra-btn');
      if (refBtn) {
        for (var i = 0; i < refBtn.attributes.length; i++) {
          var attr = refBtn.attributes[i];
          if (attr.name.startsWith('data-v-')) btn.setAttribute(attr.name, '');
        }
      }
      btn.title = '下载歌曲';
      btn.innerHTML = '<i class="fas fa-download"></i>';
      btn.addEventListener('click', onDownload);
      container.insertBefore(btn, container.firstChild);
      console.log('[MoeKoe Download] 单曲下载按钮已添加');
    }

    // 批量下载
    var actions = document.querySelector('.track-list-actions');
    if (actions && !document.querySelector('.moekoe-batch-btn')) {
      var searchInput = actions.querySelector('.search-input');

      // 音质选择器
      if (!document.querySelector('.moekoe-quality-select')) {
        var sel = document.createElement('select');
        sel.className = 'moekoe-quality-select';
        var opts = [
          { value: 'high', label: 'Hi-Res' },
          { value: 'flac', label: 'FLAC' },
          { value: '320', label: '高品' },
          { value: '128', label: '标准' }
        ];
        var current = getPreferredQuality();
        opts.forEach(function (o) {
          var opt = document.createElement('option');
          opt.value = o.value;
          opt.textContent = o.label;
          if (o.value === current) opt.selected = true;
          sel.appendChild(opt);
        });
        sel.addEventListener('change', function () {
          try {
            var s = JSON.parse(localStorage.getItem('settings') || '{}');
            s.quality = sel.value;
            localStorage.setItem('settings', JSON.stringify(s));
          } catch (e) {}
        });
        sel.title = '选择下载音质';
        if (searchInput) actions.insertBefore(sel, searchInput);
        else actions.appendChild(sel);
      }

      var batchBtn = document.createElement('button');
      batchBtn.className = 'moekoe-batch-btn';
      batchBtn.textContent = '下载全部';
      batchBtn.title = '下载歌单中所有歌曲';
      batchBtn.style.cssText =
        'background:transparent;border:1px solid var(--secondary-color,#888);' +
        'padding:5px 12px;border-radius:5px;cursor:pointer;' +
        'color:var(--text-color,inherit);font-size:13px;white-space:nowrap;' +
        'display:inline-flex;align-items:center;transition:all 0.3s ease;' +
        'max-width:200px;overflow:hidden;text-overflow:ellipsis;';
      batchBtn.addEventListener('mouseenter', function () { this.style.opacity = '0.8'; });
      batchBtn.addEventListener('mouseleave', function () { this.style.opacity = '1'; });
      batchBtn.addEventListener('click', onBatchDownload);
      if (searchInput) actions.insertBefore(batchBtn, searchInput);
      else actions.appendChild(batchBtn);
      console.log('[MoeKoe Download] 批量下载按钮已添加');
    }

    // 导出歌单
    var actions2 = document.querySelector('.track-list-actions');
    if (actions2 && !document.querySelector('.moekoe-export-btn')) {
      var exportBtn = document.createElement('button');
      exportBtn.className = 'moekoe-export-btn';
      exportBtn.textContent = '📋 导出歌单';
      exportBtn.title = '导出当前歌单为 txt';
      exportBtn.style.cssText =
        'background:transparent;border:1px solid var(--secondary-color,#888);' +
        'padding:5px 12px;border-radius:5px;cursor:pointer;' +
        'color:var(--text-color,inherit);font-size:13px;white-space:nowrap;' +
        'display:inline-flex;align-items:center;transition:all 0.3s ease;';
      exportBtn.addEventListener('mouseenter', function () { this.style.opacity = '0.8'; });
      exportBtn.addEventListener('mouseleave', function () { this.style.opacity = '1'; });
      exportBtn.addEventListener('click', onExportPlaylist);
      actions2.appendChild(exportBtn);
      console.log('[MoeKoe Download] 导出歌单按钮已添加');
    }
  }

  // =============================================
  //  8. 样式
  // =============================================
  function injectStyle() {
    if (document.querySelector('#moekoe-download-style')) return;
    var style = document.createElement('style');
    style.id = 'moekoe-download-style';
    style.textContent =
      '.moekoe-download-btn:disabled{opacity:0.6;cursor:not-allowed}' +
      '.moekoe-batch-btn:hover{opacity:0.8}' +
      '.moekoe-batch-btn:active{opacity:0.6}' +
      '.moekoe-quality-select{background:transparent;border:1px solid var(--secondary-color,#888);' +
      'border-radius:5px;color:var(--text-color,inherit);font-size:13px;' +
      'padding:4px 6px;cursor:pointer;margin-right:6px;' +
      'outline:none;transition:all 0.3s ease;' +
      'max-width:100px}' +
      '.moekoe-quality-select:hover{opacity:0.8}' +
      '.moekoe-export-btn:hover{opacity:0.8}' +
      '.moekoe-export-btn:active{opacity:0.6}';
    document.head.appendChild(style);
  }

  // =============================================
  //  9. 持续监听 DOM 变化
  // =============================================
  function startObserver() {
    addButtons();
    var obs = new MutationObserver(function () { addButtons(); });
    obs.observe(document.body, { childList: true, subtree: true });
    setInterval(addButtons, 2000);
  }

  // =============================================
  //  10. Init
  // =============================================
  injectHook();
  injectStyle();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }
})();

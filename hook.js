// == MoeKoe Download - Hook (runs in main world) ==
// 拦截 fetch / XHR 请求以获取音频直链和歌单数据
(function () {
  'use strict';

  // 音频 URL 的目标路径
  var AUDIO_PATHS = ['/song/url', '/user/cloud/url'];
  // 歌单数据的目标路径
  var PLAYLIST_PATHS = ['/playlist/track/all', '/artist/audios', '/album/songs'];

  function saveAudioUrl(url) {
    document.documentElement.dataset.moekoeAudioUrl = url;
  }

  function saveSongs(songs, playlistId) {
    if (!songs || !songs.length) return;
    var list = songs.map(function (s) {
      return {
        hash: s.hash || (s.audio_info && s.audio_info.hash) || s.FileHash || '',
        name: s.name || s.audio_name || (s.base && s.base.audio_name) || s.SongName || '',
        author: s.author || s.author_name || (s.base && s.base.author_name) || s.SingerName || '',
        timelen: s.timelen || s.timelength || (s.audio_info && s.audio_info.duration) || 0
      };
    }).filter(function (s) { return s.hash && s.name; });
    if (!list.length) return;
    document.documentElement.dataset.moekoeSongs = JSON.stringify(list);
    if (playlistId) document.documentElement.dataset.moekoePlaylistId = playlistId;
  }

  // ---- patch fetch ----
  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var reqUrl = (typeof input === 'string' ? input : (input && input.url)) || '';
    return origFetch.call(this, input, init).then(function (resp) {
      // 音频 URL
      if (AUDIO_PATHS.some(function (p) { return reqUrl.indexOf(p) !== -1; })) {
        resp.clone().json().then(function (d) {
          if (d && d.url && Array.isArray(d.url) && d.url[0]) saveAudioUrl(d.url[0]);
          else if (d && d.data && d.data.url) saveAudioUrl(d.data.url);
        }).catch(function () {});
      }
      // 歌单数据
      if (PLAYLIST_PATHS.some(function (p) { return reqUrl.indexOf(p) !== -1; })) {
        resp.clone().json().then(function (d) {
          try {
            var songs = d && d.data;
            if (Array.isArray(songs)) { /* artist: data is array */ }
            else { songs = songs && (songs.songs || songs.list || []); }
            var match = reqUrl.match(/[?&]id=([^&]+)/);
            saveSongs(songs, match ? match[1] : '');
          } catch(e) {}
        }).catch(function () {});
      }
      return resp;
    });
  };

  // ---- patch XHR ----
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__moekoeUrl = (typeof url === 'string' ? url : '');
    return origOpen.apply(this, arguments);
  };

  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    var self = this;
    var url = self.__moekoeUrl;

    if (url && AUDIO_PATHS.some(function (p) { return url.indexOf(p) !== -1; })) {
      self.addEventListener('load', function () {
        try {
          var d = JSON.parse(self.responseText);
          if (d && d.url && Array.isArray(d.url) && d.url[0]) saveAudioUrl(d.url[0]);
          else if (d && d.data && d.data.url) saveAudioUrl(d.data.url);
        } catch (e) {}
      });
    }

    if (url && PLAYLIST_PATHS.some(function (p) { return url.indexOf(p) !== -1; })) {
      self.addEventListener('load', function () {
        try {
          var d = JSON.parse(self.responseText);
          var songs = d && d.data;
          if (!Array.isArray(songs)) songs = songs && (songs.songs || songs.list || []);
          var match = url.match(/[?&]id=([^&]+)/);
          saveSongs(songs, match ? match[1] : '');
        } catch(e) {}
      });
    }

    return origSend.apply(this, arguments);
  };

  // ---- File System Access API: 主世界写文件 ----
  window.__moekoeDirHandle = null;

  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'MOEKOE_FSA_WRITE') {
      var fname = e.data.filename;
      var blob = e.data.blob;
      var dh = window.__moekoeDirHandle;
      if (!dh) {
        document.documentElement.dataset.moekoeFSAError = 'no_dir_handle';
        return;
      }
      dh.getFileHandle(fname, { create: true }).then(function (fh) {
        return fh.createWritable();
      }).then(function (ws) {
        return ws.write(blob).then(function () { return ws.close(); });
      }).then(function () {
        document.documentElement.dataset.moekoeFSAWritten = fname;
      }).catch(function (err) {
        document.documentElement.dataset.moekoeFSAError = err.message;
      });
    }

    if (e.data && e.data.type === 'MOEKOE_FSA_PICK') {
      // 弹出目录选择器
      try {
        window.showDirectoryPicker().then(function (dh) {
          window.__moekoeDirHandle = dh;
          document.documentElement.dataset.moekoeFSAReady = '1';
        }).catch(function (err) {
          // 用户取消 = AbortError，不上报为错误
          if (err.name === 'AbortError' || (err.message && err.message.indexOf('abort') !== -1)) {
            document.documentElement.dataset.moekoeFSACancelled = '1';
          } else {
            document.documentElement.dataset.moekoeFSAError = err.message;
          }
        });
      } catch (err) {
        document.documentElement.dataset.moekoeFSAError = err.message;
      }
    }
  });

  console.log('[MoeKoe Download Hook] 已安装（含歌单拦截 + FSA）');
})();

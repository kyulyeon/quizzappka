/* =========================================================================
   Net : 실시간 연결 계층  (v2)
   -------------------------------------------------------------------------
   · Firebase Realtime Database REST + 익명 로그인 + SSE(실시간 스트림)
   · Firebase 가 없으면 'local' 모드 (같은 브라우저 탭 전용, 테스트용)

   DB 구조 (sessions/<CODE>/ 아래)
     hostUid        "호스트 uid"                        (최초 1회만 쓰기)
     meta           { title, seconds, total, createdAt } (호스트)
     state          { phase, qi, endsAt, correct, ts }    (호스트)
     players/<uid>  { name, joinedAt, seen }              (본인/호스트)
     banned/<uid>   { name, at }                          (호스트)
     answers/q<qi>/<uid> { opt, at, n }                    (본인, 1회, 시간 내)
     results/q<qi>/<uid> { ok, pts }                       (호스트)
     scores/<uid>   { name, score, correct }               (호스트)
     final          { at, rank: [...] }                    (호스트)
   전역
     alltime/<uid>  { name, score, correct, games, best, code }

   시간은 모두 서버 시각( {".sv":"timestamp"} )으로 저장해서
   참가자 기기 시계가 틀려도 점수가 왜곡되지 않습니다.
   ========================================================================= */
window.Net = (function () {
  'use strict';

  var CFG_KEY = 'hg.cfg2';
  var AUTH_KEY = 'hg.auth2';
  var UID_KEY = 'hg.uid';

  var cfg = { db: '', key: '', code: '', role: 'host', projectId: '' };
  var auth = { idToken: '', refreshToken: '', uid: '', exp: 0 };
  var mirror = {};
  var listeners = [];
  var statusListeners = [];
  var status = 'idle';

  var streamCtl = null;
  var reconnectT = null;
  var watchdogT = null;
  var safetyT = null;
  var notifyT = null;
  var bc = null;
  var streamFails = 0;
  var localUidVal = '';

  var SV = { '.sv': 'timestamp' };
  function sv() { return { '.sv': 'timestamp' }; }

  /* ============================== 설정 ============================== */
  function loadCfg() {
    try {
      var raw = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
      ['db', 'key', 'code', 'role', 'projectId'].forEach(function (k) { if (raw[k]) cfg[k] = raw[k]; });
    } catch (e) {}
    return config();
  }

  function saveCfg(patch) {
    if (patch) {
      ['db', 'key', 'code', 'projectId'].forEach(function (k) {
        if (patch[k] !== undefined) cfg[k] = patch[k];
      });
    }
    try {
      localStorage.setItem(CFG_KEY, JSON.stringify({ db: cfg.db, key: cfg.key, code: cfg.code, projectId: cfg.projectId }));
    } catch (e) {}
    return config();
  }

  function config() { return { db: cfg.db, key: cfg.key, code: cfg.code, role: cfg.role, projectId: cfg.projectId }; }
  function setRole(r) { cfg.role = r; }
  function isCloud() { return /^https:\/\/[a-z0-9.-]+\.(firebaseio\.com|firebasedatabase\.app)/i.test(String(cfg.db || '')); }

  /* Firebase 콘솔에서 복사한 아무 텍스트(설정 코드 전체)에서 URL/키를 뽑아냄 */
  function parseInput(text) {
    var s = String(text || '');
    var dbM = s.match(/https:\/\/[a-z0-9.-]+\.(?:firebaseio\.com|firebasedatabase\.app)/i);
    var keyM = s.match(/AIza[0-9A-Za-z_\-]{20,}/);
    var pidM = s.match(/projectId\s*:\s*["']([^"']+)["']/i)
      || s.match(/["']?([a-z0-9][a-z0-9-]{2,})["']?\s*:\s*["'][^"']*\.firebaseapp\.com["']/i)
      || s.match(/([a-z0-9][a-z0-9-]{2,})\.firebaseapp\.com/i);
    return {
      db: dbM ? dbM[0].replace(/\/+$/, '') : '',
      key: keyM ? keyM[0] : '',
      projectId: pidM ? pidM[1] : ''
    };
  }

  /* databaseURL 이 설정 코드에 없을 때: 프로젝트 ID 로 실제 DB 주소를 찾아낸다.
     (살아있는 DB 는 200/401/403 을 돌려주고, 없는 DB 는 404) */
  function detectDb(projectId) {
    var pid = String(projectId || '').trim();
    if (!pid) return Promise.resolve('');
    var list = [
      'https://' + pid + '-default-rtdb.firebaseio.com',
      'https://' + pid + '-default-rtdb.asia-southeast1.firebasedatabase.app',
      'https://' + pid + '-default-rtdb.europe-west1.firebasedatabase.app',
      'https://' + pid + '-default-rtdb.us-central1.firebasedatabase.app',
      'https://' + pid + '.firebaseio.com'
    ];

    function probe(url) {
      return fetch(url + '/sessions/__probe__.json', { cache: 'no-store' })
        .then(function (res) {
          return (res.status === 200 || res.status === 401 || res.status === 403) ? url : '';
        })
        .catch(function () { return ''; });
    }

    return Promise.all(list.map(probe)).then(function (found) {
      for (var i = 0; i < found.length; i++) if (found[i]) return found[i];
      return '';
    });
  }

  function randomCode(n) {
    var c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var out = '';
    for (var i = 0; i < (n || 5); i++) out += c.charAt(Math.floor(Math.random() * c.length));
    return out;
  }

  function setStatus(s) {
    if (status === s) return;
    status = s;
    statusListeners.forEach(function (fn) { try { fn(status); } catch (e) {} });
  }
  function getStatus() { return status; }
  function onStatus(fn) { statusListeners.push(fn); fn(status); }

  /* ============================== 인증 ============================== */
  function localUid() {
    if (!localUidVal) {
      try { localUidVal = localStorage.getItem(UID_KEY) || ''; } catch (e) {}
      if (!localUidVal) {
        localUidVal = 'u' + Math.random().toString(36).slice(2, 10);
        try { localStorage.setItem(UID_KEY, localUidVal); } catch (e) {}
      }
    }
    return localUidVal;
  }

  function loadAuth() {
    try {
      var a = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
      if (a && a.refreshToken) { auth = a; return true; }
    } catch (e) {}
    return false;
  }
  function saveAuth(a) {
    auth = a;
    try { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); } catch (e) {}
  }

  function signUp() {
    return fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + encodeURIComponent(cfg.key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true })
    })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (j) { return { ok: res.ok, j: j }; }); })
      .then(function (r) {
        if (!r.ok || !r.j.idToken) {
          var msg = String((r.j && r.j.error && r.j.error.message) || 'UNKNOWN');
          if (/OPERATION_NOT_ALLOWED|ADMIN_ONLY_OPERATION/i.test(msg)) {
            throw new Error('익명 로그인이 꺼져 있습니다. Firebase → Authentication → Sign-in method → Anonymous → 사용 설정');
          }
          if (/API key not valid|API_KEY_INVALID/i.test(msg)) {
            throw new Error('API 키가 올바르지 않습니다. 설정 코드를 다시 복사해 붙여넣어 주세요.');
          }
          if (/CONFIGURATION_NOT_FOUND|PROJECT_NOT_FOUND/i.test(msg)) {
            throw new Error('Firebase 프로젝트를 찾을 수 없습니다 (projectId 확인)');
          }
          throw new Error('로그인 실패: ' + msg);
        }
        return {
          idToken: r.j.idToken,
          refreshToken: r.j.refreshToken,
          uid: r.j.localId,
          exp: Date.now() + (parseInt(r.j.expiresIn, 10) || 3600) * 1000
        };
      });
  }

  function refreshAuth(rt) {
    return fetch('https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(cfg.key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(rt)
    })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (j) { return { ok: res.ok, j: j }; }); })
      .then(function (r) {
        if (!r.ok || !r.j.id_token) throw new Error('토큰 갱신 실패');
        return {
          idToken: r.j.id_token,
          refreshToken: r.j.refresh_token || rt,
          uid: r.j.user_id,
          exp: Date.now() + (parseInt(r.j.expires_in, 10) || 3600) * 1000
        };
      });
  }

  var authPending = null;
  function ensureAuth(force) {
    if (!isCloud()) return Promise.resolve({ uid: localUid(), idToken: '' });
    if (!force && auth.idToken && Date.now() < auth.exp - 120000) return Promise.resolve(auth);
    if (authPending) return authPending;

    authPending = (function () {
      var ok = loadAuth();
      var step = (ok && auth.refreshToken)
        ? refreshAuth(auth.refreshToken).catch(function () { return signUp(); })
        : signUp();
      return step.then(function (a) {
        saveAuth(a);
        return a;
      }).finally(function () { authPending = null; });
    })();

    return authPending;
  }

  function uid() { return isCloud() ? auth.uid : localUid(); }
  function token() {
    return isCloud() ? ensureAuth().then(function (a) { return a.idToken; }) : Promise.resolve('');
  }

  /* ============================== REST ============================== */
  function sessionUrl(path) {
    var base = String(cfg.db).replace(/\/+$/, '');
    var authed = false;
    return base + '/sessions/' + encodeURIComponent(cfg.code) + (path ? '/' + path : '') + '.json';
  }
  function answersUrl(path) {
    var base = String(cfg.db).replace(/\/+$/, '');
    var authed = false;
    return base + '/answers/' + encodeURIComponent(cfg.code) + (path ? '/' + path : '') + '.json';
  }
  function rootUrl(path) {
    return String(cfg.db).replace(/\/+$/, '') + '/' + path + '.json';
  }

  function request(url, opts, retried) {
    opts = opts || {};
    if (opts.auth !== false) {
      return token().then(function (t) { return doFetch(url + (t ? '?auth=' + encodeURIComponent(t) : ''), opts, retried); });
    }
    return doFetch(url, opts, retried);
  }

  function doFetch(url, opts, retried) {
    opts.cache = 'no-store';
    return fetch(url, opts).then(function (res) {
      return res.text().then(function (txt) {
        var data = null;
        if (txt) { try { data = JSON.parse(txt); } catch (e) { data = null; } }
        if (res.status === 401 && !retried) {
          return ensureAuth(true).then(function () {
            var u = url.replace(/([?&])auth=[^&]*/, '$1auth=' + encodeURIComponent(auth.idToken));
            return doFetch(u, opts, true);
          });
        }
        if (!res.ok) {
          var msg = (data && data.error) ? data.error : ('HTTP ' + res.status);
          throw new Error(String(msg).slice(0, 180));
        }
        return data;
      });
    });
  }

  function get(path) { return request(sessionUrl(path)); }
  function put(path, data) {
    return request(sessionUrl(path), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data === undefined ? null : data)
    });
  }
  function putRoot(path, data) {
    return request(rootUrl(path), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data === undefined ? null : data)
    });
  }
  function getRoot(path) { return request(rootUrl(path)); }
  function putAnswers(path, data) {
    return request(answersUrl(path), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data === undefined ? null : data)
    });
  }
  function getAnswers(qi) {
    if (!isCloud()) {
      var m = mirror || {};
      return Promise.resolve((m.answers && m.answers['q' + qi]) || null);
    }
    return request(answersUrl('q' + qi)).catch(function () { return null; });
  }

  /* ======================== mirror (로컬 사본) ======================== */
  function setDeep(root, path, value) {
    var parts = String(path || '/').split('/').filter(Boolean);
    if (!parts.length) return value && typeof value === 'object' ? value : {};
    var cur = root;
    for (var i = 0; i < parts.length - 1; i++) {
      var k = parts[i];
      if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
      cur = cur[k];
    }
    var last = parts[parts.length - 1];
    if (value === null || value === undefined) delete cur[last];
    else cur[last] = value;
    return root;
  }

  function applyPut(path, data) {
    var parts = String(path || '/').split('/').filter(Boolean);
    if (!parts.length) {
      mirror = (data && typeof data === 'object') ? data : {};
      return;
    }
    mirror = mirror || {};
    setDeep(mirror, parts.join('/'), data);
  }

  function applyPatch(path, data) {
    var base = String(path || '').replace(/\/+$/, '');
    Object.keys(data || {}).forEach(function (k) {
      applyPut(base + '/' + k, data[k]);
    });
  }

  function notify() {
    if (notifyT) return;
    notifyT = setTimeout(function () {
      notifyT = null;
      var snap = mirror || {};
      listeners.forEach(function (fn) { try { fn(snap); } catch (e) { console.error(e); } });
    }, 16);
  }

  function onChange(fn) { listeners.push(fn); }

  function snapshot() { return mirror || {}; }

  /* ============================ 실시간 스트림 ============================ */
  function stopStream() {
    if (streamCtl) { try { streamCtl.abort(); } catch (e) {} streamCtl = null; }
    if (watchdogT) { clearTimeout(watchdogT); watchdogT = null; }
  }

  function touchWatchdog() {
    if (watchdogT) clearTimeout(watchdogT);
    watchdogT = setTimeout(function () {
      stopStream();
      scheduleReconnect();
    }, 55000);
  }

  function scheduleReconnect() {
    if (reconnectT) return;
    streamFails++;
    var delay = Math.min(10000, 800 * Math.pow(1.7, Math.min(streamFails, 6)));
    setStatus('reconnecting');
    reconnectT = setTimeout(function () {
      reconnectT = null;
      startStream();
    }, delay);
  }

  function startStream() {
    if (!isCloud()) { startLocal(); return; }
    stopStream();
    setStatus('connecting');

    var ctl = new AbortController();
    streamCtl = ctl;

    ensureAuth()
      .then(function (a) {
        return fetch(sessionUrl('') + '?auth=' + encodeURIComponent(a.idToken), {
          headers: { Accept: 'text/event-stream' },
          signal: ctl.signal,
          cache: 'no-store'
        });
      })
      .then(function (res) {
        if (!res || !res.ok || !res.body) throw new Error('stream ' + (res ? res.status : 'no body'));
        streamFails = 0;
        setStatus('live');
        return readStream(res.body);
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return;
        if (streamCtl === ctl) {
          setStatus('offline');
          scheduleReconnect();
        }
      });
  }

  function readStream(body) {
    var reader = body.getReader();
    var dec = new TextDecoder();
    var buf = '';
    var evName = '';
    var evData = [];

    touchWatchdog();

    function pump() {
      return reader.read().then(function (chunk) {
        if (chunk.done) throw new Error('stream closed');
        buf += dec.decode(chunk.value, { stream: true });
        var idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          var line = buf.slice(0, idx).replace(/\r$/, '');
          buf = buf.slice(idx + 1);
          if (line === '') {
            if (evName || evData.length) handleFrame(evName, evData.join('\n'));
            evName = '';
            evData = [];
          } else if (line.charAt(0) === ':') {
            /* keep-alive comment */
          } else {
            var m = line.match(/^([^:]+):\s?(.*)$/);
            if (m) {
              if (m[1] === 'event') evName = m[2];
              else if (m[1] === 'data') evData.push(m[2]);
            }
          }
        }
        touchWatchdog();
        return pump();
      });
    }
    return pump();
  }

  function handleFrame(name, data) {
    touchWatchdog();
    if (!data || name === 'keep-alive') return;
    var payload;
    try { payload = JSON.parse(data); } catch (e) { return; }

    if (name === 'put') applyPut(payload.path, payload.data);
    else if (name === 'patch') applyPatch(payload.path, payload.data);
    else if (name === 'cancel' || name === 'auth_revoked') { scheduleReconnect(); return; }
    else return;

    notify();
  }

  /* 20초마다 안전하게 한 번 더 동기화 (스트림이 조용히 죽은 경우 복구) */
  function startSafetyPoll() {
    if (safetyT) clearInterval(safetyT);
    safetyT = setInterval(function () {
      if (!isCloud() || document.hidden) return;
      get('').then(function (snap) {
        mirror = (snap && typeof snap === 'object') ? snap : {};
        notify();
      }).catch(function () {});
    }, 20000);
  }

  /* ============================== 로컬 모드 ============================== */
  function localKey() { return 'hg.session2.' + cfg.code; }

  function readLocal() {
    try {
      var raw = localStorage.getItem(localKey());
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function resolveSV(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(resolveSV);
    if (v['.sv'] === 'timestamp') return Date.now();
    var out = {};
    Object.keys(v).forEach(function (k) { out[k] = resolveSV(v[k]); });
    return out;
  }

  function localWrite(path, value) {
    var s = readLocal() || { hostUid: localUid(), players: {}, answers: {}, results: {}, scores: {}, banned: {}, state: { phase: 'lobby' } };
    s = resolveSV(s) || s;
    setDeep(s, path, resolveSV(value));
    try { localStorage.setItem(localKey(), JSON.stringify(s)); } catch (e) {}
    mirror = s;
    if (bc) { try { bc.postMessage({ type: 'session', session: s }); } catch (e) {} }
    notify();
  }

  function startLocal() {
    setStatus('local');
    if (typeof BroadcastChannel === 'undefined') return;
    if (bc) return;
    bc = new BroadcastChannel('hg-quiz-' + cfg.code);
    bc.onmessage = function (ev) {
      var m = ev.data || {};
      if (m.type === 'session' && m.session) { mirror = m.session; notify(); }
    };
  }

  /* ============================== 연결 ============================== */
  function connect() {
    if (!cfg.code) return Promise.reject(new Error('세션 코드가 없습니다'));

    if (!isCloud()) {
      localUid();
      mirror = readLocal() || {};
      startLocal();
      setStatus('local');
      notify();
      return Promise.resolve(mirror);
    }

    return ensureAuth()
      .then(function () { return get(''); })
      .then(function (snap) {
        mirror = (snap && typeof snap === 'object') ? snap : {};
        notify();
        startStream();
        startSafetyPoll();
        return mirror;
      })
      .catch(function (e) {
        setStatus('offline');
        throw e;
      });
  }

  function disconnect() {
    stopStream();
    if (reconnectT) { clearTimeout(reconnectT); reconnectT = null; }
    if (safetyT) { clearInterval(safetyT); safetyT = null; }
    if (bc) { try { bc.close(); } catch (e) {} bc = null; }
    setStatus('idle');
  }

  /* -------------------- 특정 방(코드) 직접 제어 -------------------- */
  function urlForCode(code, path) {
    var base = String(cfg.db).replace(/\/+$/, '');
    var authed = false;
    return base + '/sessions/' + encodeURIComponent(code) + (path ? '/' + path : '') + '.json';
  }

  function putToCode(code, path, data) {
    if (!isCloud()) return Promise.resolve(true);
    return request(urlForCode(code, path), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data === undefined ? null : data)
    });
  }

  /* 방 닫기: 그 방에 있던 참가자 화면에 '방이 닫혔습니다' 를 띄우고 응답 데이터를 지움 */
  function closeRoom(code) {
    code = code || cfg.code;
    if (!isCloud()) {
      try { localStorage.removeItem('hg.session2.' + code); } catch (e) {}
      return Promise.resolve(true);
    }
    var base = String(cfg.db).replace(/\/+$/, '');
    var authed = false;
    return putToCode(code, 'state', {
      phase: 'closed', qi: -1, startedAt: 0, seconds: 15, correct: null, ts: sv(), total: 0
    })
      .catch(function () {})
      .then(function () {
        return request(base + '/answers/' + encodeURIComponent(code) + '.json', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: 'null'
        }).catch(function () {});
      });
  }

  /* ============================== 진단 ============================== */
  function diagnose() {
    var steps = [];
    function add(ok, name, detail, fix) {
      steps.push({ ok: !!ok, name: name, detail: detail || '', fix: fix || '' });
    }

    add(location.protocol !== 'file:', '페이지 주소',
      location.protocol === 'file:' ? 'file:// 로 열렸습니다 (연결이 막힐 수 있음)' : location.host + location.pathname,
      'python -m http.server 8000 실행 후 http://localhost:8000 으로 열거나, 배포 주소(GitHub Pages)로 여세요');

    if (!isCloud()) {
      add(true, '모드', '로컬 모드 — 같은 브라우저 탭에서만 참가됩니다',
        '실제 시청자 참가는 설정에서 Firebase 설정 코드를 붙여넣으세요');
      return Promise.resolve(steps);
    }

    add(true, 'DB 주소', cfg.db);
    add(!!cfg.key, 'API 키', cfg.key ? '확인됨' : '없음',
      '설정 칸에 Firebase 설정 코드를 통째로 다시 붙여넣으세요');

    var base = String(cfg.db).replace(/\/+$/, '');
    var authed = false;

    return fetch(base + '/.json?shallow=true', { cache: 'no-store' })
      .then(function (res) {
        if (res.status === 200) {
          add(false, '보안 규칙', '아직 열려 있음 (누구나 점수 조작 가능)',
            'Realtime Database → 규칙 탭에 firebase-rules.json 내용을 붙여넣고 게시하세요');
        } else if (res.status === 401 || res.status === 403) {
          add(true, '보안 규칙', '잠김 (정상)');
        } else {
          add(false, '보안 규칙', 'HTTP ' + res.status, '규칙을 다시 게시해 보세요');
        }
      })
      .catch(function (e) {
        add(false, 'DB 접속', '실패: ' + e.message,
          '인터넷 연결 / 광고차단 확장 / 사내 방화벽을 확인하세요');
      })
      .then(function () { return ensureAuth(true); })
      .then(function (a) {
        authed = true;
        add(true, '익명 로그인', 'uid ' + String(a.uid).slice(0, 8) + '…');
      })
      .catch(function (e) {
        add(false, '익명 로그인', e.message,
          'Firebase → Authentication → Sign-in method → Anonymous → 사용 설정');
      })
      .then(function () {
        if (!authed) return;
        return get('hostUid').then(function (cur) {
          if (!cur) {
            return put('hostUid', auth.uid).then(function () {
              add(true, '호스트 등록', '이 방의 호스트로 새로 등록했습니다');
            });
          }
          if (cur === auth.uid) add(true, '호스트 등록', '이미 이 방의 호스트입니다');
          else add(false, '호스트 등록', '다른 계정이 이 코드의 호스트입니다',
            '설정에서 세션 코드를 바꾸거나 "새 방 만들기"를 누르세요');
        }).catch(function (e) {
          add(false, '호스트 등록', e.message, '규칙(sessions/hostUid)을 다시 게시하세요');
        });
      })
      .then(function () {
        if (!authed) return;
        return get('state').then(function () {
          add(true, '세션 읽기', 'OK');
        }).catch(function (e) {
          add(false, '세션 읽기', e.message, '규칙의 sessions .read 허용을 확인하세요');
        });
      })
      .then(function () { return steps; });
  }

  /* ============================== 호스트 ============================== */
  function claimHost() {
    if (!isCloud()) { localWrite('hostUid', localUid()); return Promise.resolve(true); }
    return get('hostUid').then(function (cur) {
      if (!cur) return put('hostUid', auth.uid);
      if (cur !== auth.uid) throw new Error('이 코드는 이미 다른 호스트가 사용 중입니다. 설정에서 코드/세션을 바꾸세요.');
      return true;
    });
  }

  function setMeta(meta) {
    var value = { title: meta.title, seconds: meta.seconds, total: meta.total, createdAt: sv() };
    if (!isCloud()) { localWrite('meta', value); return Promise.resolve(true); }
    return put('meta', value);
  }

  function setState(state) {
    if (!isCloud()) { localWrite('state', state); return Promise.resolve(true); }
    return put('state', state);
  }

  function setScores(scores) {
    if (!isCloud()) { localWrite('scores', scores); return Promise.resolve(true); }
    return put('scores', scores);
  }

  function setResult(qi, map) {
    if (!isCloud()) { localWrite('results/q' + qi, map); return Promise.resolve(true); }
    return put('results/q' + qi, map);
  }

  function setFinal(final) {
    if (!isCloud()) { localWrite('final', final); return Promise.resolve(true); }
    return put('final', final);
  }

  function resetRound() {
    if (!isCloud()) {
      ['state', 'scores', 'final', 'results', 'answers'].forEach(function (p) { localWrite(p, null); });
      return Promise.resolve(true);
    }
    return Promise.all([
      put('state', { phase: 'lobby', qi: -1, startedAt: 0, seconds: cfg.seconds || 15, correct: null, ts: sv() }),
      put('scores', null),
      put('results', null),
      put('final', null),
      putAnswers('', null)
    ]);
  }

  function ban(pid, name) {
    if (!isCloud()) { localWrite('banned/' + pid, { name: name, at: Date.now() }); localWrite('players/' + pid, null); return Promise.resolve(true); }
    return put('banned/' + pid, { name: name, at: sv() })
      .then(function () { return put('players/' + pid, null); })
      .catch(function () {});
  }

  function removePlayer(pid) {
    if (!isCloud()) { localWrite('players/' + pid, null); return Promise.resolve(true); }
    return put('players/' + pid, null);
  }

  function readAllTime() {
    if (!isCloud()) {
      try { return Promise.resolve(JSON.parse(localStorage.getItem('hg.alltime') || 'null')); } catch (e) { return Promise.resolve(null); }
    }
    return getRoot('alltime').catch(function () { return null; });
  }

  function writeAllTime(rows) {
    // rows: [{uid, name, score, correct}]  — 전적 누적
    return readAllTime().then(function (cur) {
      cur = cur || {};
      var jobs = rows.map(function (r) {
        var prev = cur[r.uid] || { games: 0, score: 0, best: 0, correct: 0 };
        var next = {
          name: r.name,
          code: cfg.code,
          games: (prev.games || 0) + 1,
          score: (prev.score || 0) + (r.score || 0),
          best: Math.max(prev.best || 0, r.score || 0),
          correct: (prev.correct || 0) + (r.correct || 0),
          updatedAt: sv()
        };
        cur[r.uid] = next;
        if (!isCloud()) return Promise.resolve(true);
        return putRoot('alltime/' + r.uid, next).catch(function () {});
      });
      if (!isCloud()) {
        try { localStorage.setItem('hg.alltime', JSON.stringify(cur)); } catch (e) {}
        return true;
      }
      return Promise.all(jobs);
    });
  }

  /* ============================== 참가자 ============================== */
  function isBanned(pid) {
    var s = mirror || {};
    return !!(s.banned && s.banned[pid]);
  }

  function join(name) {
    var me = uid();
    var node = { name: name, joinedAt: sv(), seen: sv() };
    if (!isCloud()) { localWrite('players/' + me, node); return Promise.resolve(true); }
    return put('players/' + me, node);
  }

  function heartbeat(name) {
    var me = uid();
    var node = { name: name, joinedAt: sv(), seen: sv() };
    if (!isCloud()) { return Promise.resolve(true); } // 로컬 모드는 필요 없음
    return put('players/' + me, node).catch(function () {});
  }

  function answer(qi, opt, name) {
    var me = uid();
    var node = { opt: opt, at: sv(), n: name };
    if (!isCloud()) { localWrite('answers/q' + qi + '/' + me, node); return Promise.resolve(true); }
    return putAnswers('q' + qi + '/' + me, node);
  }

  return {
    /* 공통 */
    loadCfg: loadCfg,
    saveCfg: saveCfg,
    config: config,
    setRole: setRole,
    isCloud: isCloud,
    parseInput: parseInput,
    detectDb: detectDb,
    randomCode: randomCode,
    connect: connect,
    disconnect: disconnect,
    onChange: onChange,
    onStatus: onStatus,
    getStatus: getStatus,
    snapshot: snapshot,
    uid: uid,
    sv: sv,
    getPath: get,
    getAnswers: getAnswers,

    /* 호스트 */
    claimHost: claimHost,
    closeRoom: closeRoom,
    diagnose: diagnose,
    setMeta: setMeta,
    setState: setState,
    setScores: setScores,
    setResult: setResult,
    setFinal: setFinal,
    resetRound: resetRound,
    ban: ban,
    removePlayer: removePlayer,
    readAllTime: readAllTime,
    writeAllTime: writeAllTime,

    /* 참가자 */
    join: join,
    heartbeat: heartbeat,
    answer: answer,
    isBanned: isBanned
  };
})();

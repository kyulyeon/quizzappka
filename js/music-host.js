/* =========================================================================
   음악 테스트 · HOST (주관식 타이핑 퀴즈)
   - 시청자는 링크로 접속해 닉네임 입력 후 '정답을 직접 타이핑'
   - 채점은 자동(공백/문장부호 무시 + 부분일치) + 호스트 수동 O/X
   - 점수: 정답 1개당 고정 점수 (속도 무관), 마지막엔 TOP 3
   단축키: Space(시작/공개/다음) · R(처음부터) · F(전체화면) · S(설정)
   ========================================================================= */
(function () {
  'use strict';

  var M = window.MUSIC;
  var Net = window.Net;
  var TOTAL = M.questions.length;
  var DEFAULT_SECS = M.seconds || 15;
  var POINTS = M.pointsPerCorrect || 1;

  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* 채점: 소문자 + 공백/문장부호 제거 후 비교, 2글자 이상이면 부분 일치도 인정 */
  /* 비교용 정규화: 전각문자 통일 + 소문자 + 한글/영문/숫자만 남김
     → 띄어쓰기, 마침표, 따옴표, ・, - , ! 등이 전부 무시됨 */
  function norm(s) {
    var t = String(s == null ? '' : s);
    try { t = t.normalize('NFKC'); } catch (e) {}
    return t.toLowerCase().replace(/[^0-9a-z\uac00-\ud7a3]/g, '');
  }
  function answerList(item) {
    var out = [item.title || ''];
    (item.answers || []).forEach(function (x) { out.push(x); });
    return out.filter(Boolean);
  }

  /* 정답 판정 (아주 관대하게)
     1) 띄어쓰기·문장부호 무시한 완전 일치
     2) 입력 안에 정답이 들어있으면 인정        ('노래는 에잇', '에잇 아이유')
     3) 정답의 60% 이상을 입력했으면 인정        ('이렇게좋아해본적')
     → 애매하면 호스트가 O/X 로 최종 판정 */
  function matches(txt, answers) {
    var a = norm(txt);
    if (!a) return false;
    for (var i = 0; i < answers.length; i++) {
      var b = norm(answers[i]);
      if (!b) continue;
      if (a === b) return true;
      if (b.length >= 2 && a.indexOf(b) >= 0 && a.length <= b.length + 10) return true;
      if (a.length >= 2 && b.indexOf(a) >= 0 && a.length >= Math.max(2, Math.ceil(b.length * 0.6))) return true;
    }
    return false;
  }

  function storedSecs() {
    var v = parseInt(localStorage.getItem('hg.seconds'), 10);
    return (v >= 5 && v <= 120) ? v : DEFAULT_SECS;
  }
  function limitMs() { return H.qSecs * 1000; }

  var H = {
    code: '', link: '', ready: false,
    phase: 'lobby', qi: -1, correct: null,
    endsAt: 0, qSecs: 0, secs: 0, qStart: 0, skew: 0, lastTs: 0, metaTs: 0,
    players: {}, banned: {}, answers: {}, results: {}, state: {}, final: null,
    sound: true, timerId: null, stageSig: '', sideSig: '',
    pollT: null, revealing: false, resume: null, lastAnswer: '', lastQi: -1, clipT: null, fullPlaying: false
  };

  /* ------------------------------ 소리 ------------------------------ */
  var ac = null;
  function tone(freq, dur, type) {
    if (!H.sound) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = ac || new AC();
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      var t = ac.currentTime;
      g.gain.setValueAtTime(0.06, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(ac.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  }

  /* ---------------------------- 클립 재생 ---------------------------- */
  function clipEl() { return document.getElementById('clip'); }

  function stopClip() {
    if (H.clipT) { clearTimeout(H.clipT); H.clipT = null; }
    H.fullPlaying = false;
    var a = clipEl();
    if (a) { try { a.pause(); } catch (e) {} }
    var b = document.querySelector('#btnFullSong');
    if (b) b.textContent = '🎧 전체곡 듣기';
  }

  function playClip(item, mode) {
    var a = clipEl();
    if (!a || !item || !item.audio) {
      toast('이 문제에는 audio 파일이 없습니다');
      return;
    }
    if (a.getAttribute('data-src') !== item.audio) {
      a.setAttribute('data-src', item.audio);
      a.src = item.audio;
    }
    var at = (mode === 'highlight')
      ? (Number(item.highlightStart) || 0)
      : (Number(item.introStart) || 0);
    try { a.currentTime = at; } catch (e) {}
    H.fullPlaying = false;
    var len = Math.max(0.3, Number(M.clipSeconds) || 1);

    var pr = a.play();
    if (pr && pr.then) {
      pr.then(function () {
        if (H.clipT) clearTimeout(H.clipT);
        H.clipT = setTimeout(function () {
          try { a.pause(); } catch (e) {}
          H.clipT = null;
        }, len * 1000);
      }).catch(function () {
        toast('브라우저가 자동재생을 막았어요 — ▶ 버튼을 누르세요');
      });
    }
  }

  function toggleFullSong(item) {
    var a = clipEl();
    if (!a || !item || !item.audio) { toast('음원이 없습니다'); return; }

    if (H.fullPlaying) {
      stopClip();
      H.fullPlaying = false;
      var b = document.querySelector('#btnFullSong');
      if (b) b.textContent = '🎧 전체곡 듣기';
      return;
    }

    if (a.getAttribute('data-src') !== item.audio) {
      a.setAttribute('data-src', item.audio);
      a.src = item.audio;
    }
    if (H.clipT) { clearTimeout(H.clipT); H.clipT = null; }
    try { a.currentTime = 0; } catch (e) {}
    H.fullPlaying = true;

    var pr = a.play();
    if (pr && pr.then) {
      pr.catch(function () { toast('재생이 막혔어요 — 다시 눌러주세요'); });
    }
    var btn = document.querySelector('#btnFullSong');
    if (btn) btn.textContent = '⏸ 전체곡 정지';
  }

  /* --------------------------- 상태 계산 --------------------------- */
  function normResults(raw) {
    var out = {};
    Object.keys(raw || {}).forEach(function (k) {
      var qi = parseInt(String(k).replace(/^q/, ''), 10);
      if (!isNaN(qi)) out[qi] = raw[k] || {};
    });
    return out;
  }

  function scoresFrom(results) {
    var out = {};
    function slot(pid) {
      if (!out[pid]) out[pid] = { name: (H.players[pid] && H.players[pid].name) || '참가자', score: 0, correct: 0 };
      return out[pid];
    }
    Object.keys(H.players).forEach(slot);
    Object.keys(results).forEach(function (qk) {
      var m = results[qk] || {};
      Object.keys(m).forEach(function (pid) {
        var r = m[pid];
        if (!r) return;
        var s = slot(pid);
        s.score += r.pts || 0;
        if (r.ok) s.correct += 1;
      });
    });
    return out;
  }

  function ranked() {
    var sc = scoresFrom(H.results);
    return Object.keys(sc).map(function (pid) {
      return { id: pid, name: sc[pid].name, score: sc[pid].score, correct: sc[pid].correct };
    }).sort(function (a, b) {
      return b.score - a.score || b.correct - a.correct || a.name.localeCompare(b.name);
    });
  }

  function answeredCount(qi) { return Object.keys(H.answers[qi] || {}).length; }
  function serverNow() { return Date.now() + H.skew; }
  function isOnline(pid) {
    var p = H.players[pid];
    if (!p) return false;
    return !p.seen || serverNow() - p.seen < 75000;
  }

  function ingest(snap) {
    snap = snap || {};
    H.state = snap.state || {};
    H.players = snap.players || {};
    H.banned = snap.banned || {};
    H.results = normResults(snap.results);
    H.final = snap.final || null;

    var st = H.state;
    if (typeof st.ts === 'number' && st.ts !== H.lastTs) {
      H.lastTs = st.ts;
      H.skew = st.ts - Date.now();
    } else if (snap.meta && typeof snap.meta.createdAt === 'number' && snap.meta.createdAt !== H.metaTs) {
      H.metaTs = snap.meta.createdAt;
      H.skew = snap.meta.createdAt - Date.now();
    }
    if (typeof st.startedAt === 'number' && st.startedAt > 0 && st.startedAt !== H.qStart) {
      H.qStart = st.startedAt;
      H.qSecs = st.seconds || H.qSecs || DEFAULT_SECS;
      if (H.phase === 'question') H.endsAt = H.qStart + limitMs() - H.skew;
    }

    if (H.phase === 'lobby') {
      var done = Object.keys(H.results).length > 0;
      H.resume = done && ['question', 'reveal', 'end'].indexOf(st.phase) >= 0
        ? { phase: st.phase, qi: typeof st.qi === 'number' ? st.qi : 0 }
        : null;
    } else {
      H.resume = null;
    }
  }

  /* ------------------------------ 타이머 ------------------------------ */
  var lastSec = -1;
  function clearTimer() { if (H.timerId) { cancelAnimationFrame(H.timerId); H.timerId = null; } }

  function startTimer() {
    clearTimer();
    lastSec = -1;
    function loop() {
      if (H.phase !== 'question') return;
      var left = Math.max(0, H.endsAt - Date.now());
      var ratio = Math.max(0, Math.min(1, left / limitMs()));
      var bar = $('#tbar'), wrap = $('.timer-bar'), sec = $('#tsec');
      if (bar) bar.style.width = (ratio * 100).toFixed(2) + '%';
      if (wrap) wrap.classList.toggle('danger', ratio <= 0.34);
      var s = Math.ceil(left / 1000);
      if (sec) sec.textContent = s;
      if (s !== lastSec) {
        lastSec = s;
        if (s <= 5 && s > 0) tone(700 + (5 - s) * 45, 0.06, 'square');
      }
      if (left <= 0) { clearTimer(); tone(300, 0.3, 'sawtooth'); reveal(); return; }
      H.timerId = requestAnimationFrame(loop);
    }
    H.timerId = requestAnimationFrame(loop);
  }

  function startAnswerPoll() {
    stopAnswerPoll();
    H.pollT = setInterval(function () {
      if (H.phase !== 'question') return;
      syncAnswers().then(renderSide);
    }, 700);
  }
  function stopAnswerPoll() { if (H.pollT) { clearInterval(H.pollT); H.pollT = null; } }

  function syncAnswers() {
    var qi = H.qi;
    if (qi < 0) return Promise.resolve();
    return Net.getAnswers(qi).then(function (m) {
      if (qi === H.qi) H.answers[qi] = m || {};
    }).catch(function () {});
  }

  /* ------------------------------ 렌더 ------------------------------ */
  function renderStatus(s) {
    var el = $('#statusPill');
    if (!el) return;
    var map = {
      live: ['실시간 연결', 'live'], connecting: ['연결 중…', 'wait'],
      reconnecting: ['재연결 중…', 'wait'], offline: ['오프라인', 'bad'],
      local: ['로컬 모드', 'wait'], idle: ['대기', 'wait']
    };
    var v = map[s] || map.idle;
    el.textContent = v[0];
    el.className = 'chip status ' + v[1];
  }

  function buildLink() {
    var u = new URL('musicplay.html', location.href);
    u.searchParams.set('s', H.code);
    if (Net.isCloud()) {
      u.searchParams.set('db', Net.config().db);
      u.searchParams.set('k', Net.config().key);
    }
    return u.href;
  }

  function qrSources(link) {
    var enc = encodeURIComponent(link);
    return [
      'https://api.qrserver.com/v1/create-qr-code/?size=420x420&margin=10&ecc=M&data=' + enc,
      'https://quickchart.io/qr?size=420&margin=2&ecLevel=M&text=' + enc
    ];
  }

  function paintQr(imgFailed) {
    var box = $('#qrBox'), img = $('#qrImg'), note = $('#qrNote');
    if (!box || !img) return;
    if (img.getAttribute('data-src') !== H.link) {
      img.setAttribute('data-src', H.link);
      var urls = qrSources(H.link), i = 0;
      (function next() {
        if (i >= urls.length) { box.style.display = 'none'; img.removeAttribute('src'); paintQrNote(true); return; }
        var url = urls[i++];
        box.href = url;
        img.onerror = next;
        img.onload = function () { box.style.display = ''; };
        img.src = url;
      })();
      paintQrNote(false);
      return;
    }
    paintQrNote(imgFailed);
  }
  function paintQrNote(failed) {
    var el = $('#qrNote');
    if (!el) return;
    if (!failed) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = 'QR 이미지를 못 불러왔어요 — <b>참가 링크 복사</b>를 사용하세요.';
  }

  function paintChrome() {
    $('#joinCode').textContent = H.code;
    $('#modeLabel').textContent = Net.isCloud() ? 'FIREBASE · 실시간' : 'LOCAL (테스트)';
    $('#modeLabel').classList.toggle('warn', !Net.isCloud());
    H.link = buildLink();
    $('#linkOpen').href = H.link;
    paintQr(false);
    $('#joinNote').innerHTML = Net.isCloud()
      ? '시청자는 QR/링크 접속 → 닉네임 입력 → 정답을 직접 타이핑'
      : '<b>로컬 모드</b>: 같은 브라우저 탭만 참가됩니다.';
  }

  function stageLobby() {
    var resume = H.resume
      ? '<div class="resume"><div><b>이전 라운드가 있습니다</b> · ' + Object.keys(H.results).length + '문제 진행 / ' +
        Object.keys(H.players).length + '명 참가</div><button class="btn" id="btnResume">이어서 하기</button></div>'
      : '';
    return '<div class="lobby">' +
        '<div class="kicker">MUSIC TEST</div>' +
        (M.poster ? '<img class="poster" src="' + esc(M.poster) + '" alt="포스터" />' : '') +
        '<h1>' + esc(M.title || '음악 테스트') + '</h1>' +
        '<p class="sub">전체 <b>' + TOTAL + '문제</b> · 문제당 <b>' + H.secs + '초</b> · 시청자가 <b>직접 타이핑</b>해서 제출</p>' +
        '<div class="lobby-badges">' +
          '<span class="pill">참가 코드 <b>' + esc(H.code) + '</b></span>' +
          '<span class="pill">참가자 <b>' + Object.keys(H.players).length + '</b>명</span>' +
        '</div>' +
        resume +
        '<div class="lobby-actions">' +
          '<button class="btn primary big" id="btnStart">새로 시작하기</button>' +
          '<button class="btn ghost" id="btnNewRoom">새 방 만들기 (코드 변경)</button>' +
        '</div>' +
        '<p class="hint">Space = 시작 · 정답 공개 · 다음 문제 &nbsp;|&nbsp; R = 처음부터 &nbsp;|&nbsp; F = 전체화면</p>' +
      '</div>';
  }

  function stageQuestion(i, revealed) {
    var item = M.questions[i];
    var map = H.answers[i] || {};
    var rows = Object.keys(map).map(function (pid) {
      var a = map[pid] || {};
      var r = (H.results[i] || {})[pid];
      var ok = r ? !!r.ok : matches(a.txt, (item.answers && item.answers.length) ? item.answers : []);
      return {
        ok: ok,
        html: '<li class="tanswer ' + (ok ? 'ok' : 'no') + '">' +
            '<span class="who">' + esc(a.n || (H.players[pid] && H.players[pid].name) || '참가자') + '</span>' +
            '<span class="what">' + esc(a.txt || '') + '</span>' +
            '<span class="mark">' + (ok ? '✓' : '✗') + '</span>' +
            '<button class="ta-btn" data-ok="' + pid + '" title="정답 처리">O</button>' +
            '<button class="ta-btn" data-no="' + pid + '" title="오답 처리">X</button>' +
          '</li>'
      };
    }).sort(function (a, b) { return (b.ok ? 1 : 0) - (a.ok ? 1 : 0); });

    rows = rows.map(function (x) { return x.html; }).join('');

    var answerNow = (H.lastQi === i) ? H.lastAnswer : '';
    var cover = revealed && item.image
      ? '<img class="cover" src="' + esc(item.image) + '" alt="album cover" />'
      : '';

    var correctBox = revealed
      ? '<div class="t-correct">' +
          '<span class="tag">정답</span>' +
          '<b>' + esc(item.title || '—') + '</b>' +
          '<span class="alt">' + esc(item.emoji || '') + ' ' + esc(item.artist || '') + '</span>' +
          (item.album ? '<span class="note">' + esc(item.album) + '</span>' : '') +
        '</div>' +
        '<div class="answer-row">' +
          '<button class="btn primary" id="btnFullSong">🎧 전체곡 듣기</button>' +
        '</div>'
      : '';

    var body = revealed
      ? (rows ? '<ul class="tanswer-list">' + rows + '</ul>' : '<p class="empty-big">제출한 사람이 없습니다</p>')
      : '<div class="t-waiting">' +
          '<div class="live-count" id="liveCount">' + answeredCount(i) + ' / ' + Object.keys(H.players).length + '명 제출</div>' +
          '<p class="t-tip">' + esc(item.hint || '1초만 듣고 제목을 입력하세요') + '</p>' +
          '<div class="clip-btns">' +
            '<button class="btn" id="btnClip" data-mode="intro">▶ 인트로 ' + (Number(M.clipSeconds) || 1) + '초</button>' +
            '<button class="btn ghost" id="btnClipHi" data-mode="highlight">▶ 하이라이트 ' + (Number(M.clipSeconds) || 1) + '초</button>' +
          '</div>' +
        '</div>';

    var bottom = revealed
      ? '<div class="reveal-row">' +
          '<div class="reveal-answer"><span class="tag">정답</span>' +
            '<span class="reveal-txt">' + esc(item.answers[0]) + '</span></div>' +
          '<button class="btn primary big" id="btnNext">' + (i + 1 >= TOTAL ? '최종 결과 보기' : '다음 문제') + ' →</button>' +
        '</div>'
      : '<div class="timer-row">' +
          '<div class="live-count" id="liveCount">' + answeredCount(i) + ' / ' + Object.keys(H.players).length + '명 제출</div>' +
          '<div class="timer-bar"><i id="tbar" style="width:100%"></i></div>' +
          '<div class="timer-sec"><b id="tsec">' + H.qSecs + '</b><small>초</small></div>' +
        '</div>';

    return '<div class="q-wrap' + (revealed ? ' is-reveal' : '') + '">' +
        '<div class="q-top">' +
          '<span class="chip">🎵 ' + esc(M.title || '음악 테스트') + '</span>' +
          '<span class="chip ghost">Q' + (i + 1) + ' / ' + TOTAL + '</span>' +
        '</div>' +
        '<h2 class="q-title">' + esc(item.q || M.q || '이 곡의 제목은?') + '</h2>' +
        (revealed
          ? '<div class="reveal-cover">' + cover +
              '<div class="reveal-cover-side">' + correctBox + body + '</div>' +
            '</div>'
          : body) +
        bottom +
      '</div>';
  }

  function stageEnd() {
    var rows = ranked();
    var medal = ['🥇', '🥈', '🥉'];
    var podium = rows.slice(0, 3).map(function (p, i) {
      return '<div class="pod pod-' + (i + 1) + '">' +
          '<div class="medal">' + medal[i] + '</div>' +
          '<div class="pod-name">' + esc(p.name) + '</div>' +
          '<div class="pod-score">' + p.score + '<small>점</small></div>' +
          '<div class="pod-correct">' + p.correct + ' / ' + TOTAL + ' 정답</div>' +
        '</div>';
    }).join('');

    return '<div class="end-wrap">' +
        '<div class="kicker">FINAL RESULT</div>' +
        '<h2 class="end-title">최종 순위</h2>' +
        (rows.length
          ? '<div class="podium">' + podium + '</div>' +
            '<p class="end-note">TOP 3 · 전체 순위는 <b>CSV 저장</b>으로 확인할 수 있어요</p>'
          : '<p class="empty-big">참가자가 없습니다.</p>') +
        '<div class="end-actions">' +
          '<button class="btn primary" id="btnRestart">새 라운드 시작</button>' +
          '<button class="btn ghost" id="btnCsv">CSV 저장</button>' +
        '</div>' +
      '</div>';
  }

  function renderStage() {
    var stage = $('#stage');
    if (!stage) return;
    var sig = [H.phase, H.qi, H.correct, H.qi >= 0 ? answeredCount(H.qi) : -1,
      H.phase === 'lobby' ? (H.resume ? 'r' + H.resume.qi + H.resume.phase : '-') : '',
      H.phase === 'lobby' ? Object.keys(H.players).length : ''].join('|');
    if (sig === H.stageSig) return;
    H.stageSig = sig;

    if (H.phase === 'lobby') stage.innerHTML = stageLobby();
    else if (H.phase === 'question') { stage.innerHTML = stageQuestion(H.qi, false); startTimer(); }
    else if (H.phase === 'reveal') stage.innerHTML = stageQuestion(H.qi, true);
    else if (H.phase === 'end') stage.innerHTML = stageEnd();

    var prog = $('#progressBar');
    if (prog) prog.style.width = (H.qi < 0 ? 0 : ((H.qi + (H.phase === 'reveal' || H.phase === 'end' ? 1 : 0.35)) / TOTAL) * 100) + '%';
    var counter = $('#qCounter');
    if (counter) counter.textContent = H.phase === 'lobby' ? '대기 중' : H.phase === 'end' ? '종료' : 'Q' + (H.qi + 1) + ' / ' + TOTAL;
  }

  function renderSide() {
    var list = $('#rankList');
    if (!list) return;
    var rows = ranked();
    $('#pCount').textContent = rows.length;

    var sig = JSON.stringify([rows.map(function (p) { return [p.id, p.name, p.score, p.correct]; }),
      H.phase === 'reveal' ? H.qi : -1, Object.keys(H.players).map(function (p) { return p + (isOnline(p) ? 1 : 0); })]);
    if (sig !== H.sideSig) {
      H.sideSig = sig;
      list.innerHTML = rows.length
        ? rows.map(function (p, i) {
            return '<li class="rank-item">' +
                '<span class="dot' + (isOnline(p.id) ? ' on' : '') + '"></span>' +
                '<span class="rk">' + (i + 1) + '</span>' +
                '<span class="nm">' + esc(p.name) + '</span>' +
                '<span class="pt">' + p.score + '</span>' +
                '<button class="del" data-kick="' + p.id + '" title="내보내기">×</button>' +
              '</li>';
          }).join('')
        : '<li class="empty">참가자를 기다리는 중…</li>';
    }
    var lc = $('#liveCount');
    if (lc && H.qi >= 0) lc.textContent = answeredCount(H.qi) + ' / ' + Object.keys(H.players).length + '명 제출';
  }

  function renderAll() { renderStage(); renderSide(); }

  /* ------------------------------ 플로우 ------------------------------ */
  function openQuestion(i) {
    H.qi = i;
    H.phase = 'question';
    H.correct = null;
    H.revealing = false;
    H.qStart = 0;
    H.qSecs = H.secs;
    H.endsAt = Date.now() + limitMs();
    H.answers[i] = {};
    H.stageSig = '';
    H.sideSig = '';
    H.lastAnswer = '';
    H.lastQi = -1;
    renderAll();
    startTimer();
    startAnswerPoll();
    playClip(M.questions[i], 'intro');

    Net.setState({
      phase: 'question', qi: i, startedAt: Net.sv(), ts: Net.sv(),
      seconds: H.qSecs, correct: null, total: TOTAL
    }).catch(function (e) { toast('문제 시작 저장 실패: ' + e.message); });
  }

  function startQuiz() {
    if (H.phase !== 'lobby' && H.phase !== 'end') return;
    if (!H.ready) { toast('아직 연결 중입니다…'); return; }
    H.results = {};
    H.answers = {};
    H.resume = null;
    H.stageSig = '';
    H.sideSig = '';
    Net.resetRound(H.secs).then(function () { openQuestion(0); })
      .catch(function () { openQuestion(0); });
  }

  function gradeAll(qi) {
    var item = M.questions[qi];
    var list = answerList(item);
    var src = H.answers[qi] || {};
    var map = {};

    Object.keys(src).forEach(function (pid) {
      var a = src[pid];
      if (!a) return;
      var ok = matches(a.txt, list);
      map[pid] = { ok: ok, pts: ok ? POINTS : 0 };
    });

    H.results[qi] = map;
    H.lastAnswer = item.title;
    H.lastQi = qi;
    H.stageSig = '';
    H.sideSig = '';
    renderAll();

    Net.setResult(qi, map).catch(function () {});
    Net.setScores(scoresFrom(H.results)).catch(function () {});
    Net.setState({
      phase: 'reveal', qi: qi, startedAt: H.qStart || 0, ts: Net.sv(),
      seconds: H.qSecs, correct: 0, total: TOTAL, answer: item.title
    }).catch(function () {});
  }

  function reveal() {
    if (H.phase !== 'question' || H.revealing) return;
    H.revealing = true;
    clearTimer();
    stopAnswerPoll();

    stopClip();

    syncAnswers().then(function () {
      var qi = H.qi;
      var item = M.questions[qi];
      H.phase = 'reveal';
      H.correct = 0;
      H.revealing = false;

      gradeAll(qi);

      tone(680, 0.14, 'triangle');
      setTimeout(function () { tone(940, 0.2, 'triangle'); }, 120);
    });
  }

  function next() {
    if (H.phase !== 'reveal') return;
    if (H.qi + 1 >= TOTAL) return finish();
    openQuestion(H.qi + 1);
  }

  function finish() {
    H.phase = 'end';
    H.stageSig = '';
    H.sideSig = '';
    renderAll();
    tone(880, 0.2, 'triangle');

    var rows = ranked();
    Net.setFinal({
      at: Net.sv(),
      rank: rows.map(function (p) { return { uid: p.id, name: p.name, score: p.score, correct: p.correct }; })
    }).catch(function () {});
    Net.setState({ phase: 'end', qi: H.qi, startedAt: H.qStart || 0, ts: Net.sv(), seconds: H.qSecs, correct: 0, total: TOTAL, answer: H.lastAnswer || '' })
      .catch(function () {});
  }

  function restart() {
    clearTimer();
    stopClip();
    stopAnswerPoll();
    H.phase = 'lobby'; H.qi = -1; H.correct = null; H.endsAt = 0;
    H.answers = {}; H.results = {}; H.resume = null;
    H.stageSig = ''; H.sideSig = '';
    Net.resetRound(H.secs).catch(function () {}).then(renderAll);
  }

  function resumeRound() {
    var r = H.resume;
    if (!r) return;
    if (r.phase === 'reveal') {
      H.qi = r.qi; H.phase = 'reveal'; H.correct = 0; H.resume = null;
      H.stageSig = ''; renderAll();
      syncAnswers().then(function () { H.stageSig = ''; renderAll(); });
    } else if (r.phase === 'question') {
      H.resume = null;
      openQuestion(r.qi);
    } else {
      H.qi = typeof H.state.qi === 'number' ? H.state.qi : TOTAL - 1;
      H.phase = 'end';
      H.resume = null; H.stageSig = '';
      renderAll();
    }
  }

  /* ------------------------------ 운영 ------------------------------ */
  function manual(pid, ok) {
    if (H.phase !== 'reveal' || H.qi < 0) return;
    H.results[H.qi] = H.results[H.qi] || {};
    H.results[H.qi][pid] = { ok: ok, pts: ok ? POINTS : 0, manual: true };
    H.sideSig = '';
    H.stageSig = '';
    renderAll();
    Net.setResult(H.qi, H.results[H.qi]).catch(function () {});
    Net.setScores(scoresFrom(H.results)).catch(function () {});
    tone(ok ? 900 : 300, 0.07, 'square');
  }

  function kick(pid) {
    var name = (H.players[pid] && H.players[pid].name) || '참가자';
    if (!window.confirm('"' + name + '" 님을 내보낼까요?')) return;
    Net.ban(pid, name).then(function () {
      delete H.players[pid];
      H.sideSig = ''; H.stageSig = '';
      renderAll();
      toast(name + ' 님을 내보냈습니다');
    });
  }

  function newRoom() {
    var old = H.code;
    var nc = Net.randomCode();
    var text = ['새 방을 만들까요?', '',
      '· 지금 방(' + old + ')은 닫히고 참가자 전원이 나갑니다',
      '· 새 방 코드: ' + nc,
      '· 새 참가 링크를 다시 올려야 합니다'].join(String.fromCharCode(10));
    if (!window.confirm(text)) return;
    toast('방을 닫고 새 방을 준비하는 중…');
    Net.closeRoom(old).then(function () {
      Net.saveCfg({ code: nc });
      try { localStorage.setItem('hg.code.music', nc); } catch (e) {}
      try { sessionStorage.setItem('hg.newroom', nc); } catch (e) {}
      location.reload();
    });
  }

  function exportCsv() {
    var rows = [['순위', '이름', '점수', '정답수']];
    ranked().forEach(function (p, i) { rows.push([i + 1, p.name, p.score, p.correct]); });
    var csv = '\ufeff' + rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'music-test-' + H.code + '.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  var toastT = null;
  function toast(msg) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.hidden = true; }, 4000);
  }

  function copy(text, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, function () { window.prompt('복사', text); });
    } else window.prompt('복사', text);
  }

  function toggleFull() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
    else document.exitFullscreen && document.exitFullscreen();
  }

  /* ------------------------------ 설정 ------------------------------ */
  function openSettings() {
    var cfg = Net.config();
    $('#setPaste').value = cfg.db
      ? ['databaseURL: "' + cfg.db + '",', 'apiKey: "' + cfg.key + '"'].join(String.fromCharCode(10))
      : '';
    $('#setCode').value = cfg.code || '';
    $('#setSeconds').value = H.secs;
    $('#settings').hidden = false;
  }

  function setSeconds(v) {
    v = parseInt(v, 10);
    if (!(v >= 5 && v <= 120)) return;
    H.secs = v;
    try { localStorage.setItem('hg.seconds', String(v)); } catch (e) {}
    var inp = $('#setSeconds');
    if (inp && String(inp.value) !== String(v)) inp.value = v;
    if (H.phase !== 'question') { H.stageSig = ''; renderStage(); }
    toast(v + '초로 설정 — 다음 문제부터 적용됩니다');
  }

  function saveSettings() {
    var p = Net.parseInput($('#setPaste').value);
    if (!p.key) {
      alert('apiKey 를 찾지 못했습니다. databaseURL 과 apiKey 두 줄을 그대로 붙여넣어 주세요.');
      return;
    }
    var code = ($('#setCode').value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '') || Net.randomCode();
    Net.saveCfg({ key: p.key, projectId: p.projectId });

    if (p.db) {
      Net.saveCfg({ db: p.db, code: code });
      try { localStorage.setItem('hg.code.music', code); } catch (e) {}
      location.reload();
      return;
    }
    toast('DB 주소를 찾는 중…');
    Net.detectDb(p.projectId).then(function (db) {
      if (!db) { alert('databaseURL 을 찾지 못했습니다. databaseURL 줄도 함께 붙여넣어 주세요.'); return; }
      Net.saveCfg({ db: db, code: code });
      try { localStorage.setItem('hg.code.music', code); } catch (e) {}
      location.reload();
    });
  }

  /* ------------------------------ 이벤트 ------------------------------ */
  function primary() {
    if (H.phase === 'lobby') startQuiz();
    else if (H.phase === 'question') reveal();
    else if (H.phase === 'reveal') next();
    else if (H.phase === 'end') restart();
  }

  function bindEvents() {
    document.addEventListener('click', function (e) {
      var t = e.target;

      if (t.closest('#btnStart')) return startQuiz();
      if (t.closest('#btnResume')) return resumeRound();
      if (t.closest('#btnNext')) return next();
      if (t.closest('#btnRestart')) return restart();
      if (t.closest('#btnNewRoom')) return newRoom();
      if (t.closest('#btnClip')) return playClip(M.questions[H.qi], 'intro');
      if (t.closest('#btnClipHi')) return playClip(M.questions[H.qi], 'highlight');
      if (t.closest('#btnFullSong')) return toggleFullSong(M.questions[H.qi]);
      if (t.closest('#btnCsv')) return exportCsv();
      if (t.closest('#btnFull')) return toggleFull();
      if (t.closest('#btnSettings')) return openSettings();
      if (t.closest('#btnCopy') || t.closest('#joinCode')) return copy(H.link, '참가 링크를 복사했어요!');
      if (t.closest('#setSave')) return saveSettings();
      if (t.closest('#setCancel')) { $('#settings').hidden = true; return; }
      var secBtn = t.closest('[data-secs]');
      if (secBtn) return setSeconds(secBtn.getAttribute('data-secs'));
      if (t.closest('#btnSound')) {
        H.sound = !H.sound;
        $('#btnSound').textContent = H.sound ? '🔊' : '🔇';
        $('#btnSound').classList.toggle('off', !H.sound);
        return;
      }

      var kickBtn = t.closest('[data-kick]');
      if (kickBtn) return kick(kickBtn.getAttribute('data-kick'));
      var ok = t.closest('[data-ok]');
      if (ok) return manual(ok.getAttribute('data-ok'), true);
      var no = t.closest('[data-no]');
      if (no) return manual(no.getAttribute('data-no'), false);

      if (H.phase === 'reveal' && t.closest('.tanswer')) return next();
    });

    var secInput = $('#setSeconds');
    if (secInput) secInput.addEventListener('input', function () { setSeconds(this.value); });

    document.addEventListener('keydown', function (e) {
      var tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      if (e.code === 'Space') { e.preventDefault(); primary(); }
      else if (e.key === 'r' || e.key === 'R') restart();
      else if (e.key === 'f' || e.key === 'F') toggleFull();
      else if (e.key === 's' || e.key === 'S') openSettings();
    });

    window.addEventListener('beforeunload', function () { stopAnswerPoll(); Net.disconnect(); });
  }

  /* ------------------------------ 부트 ------------------------------ */
  function boot() {
    Net.loadCfg();

    var qp = new URLSearchParams(location.search);
    if (qp.get('db')) {
      Net.saveCfg({
        db: qp.get('db'),
        key: qp.get('k') || Net.config().key,
        code: (qp.get('code') || Net.config().code || '').toUpperCase()
      });
    }

    var cfg = Net.config();
    var savedCode = null, otherCode = null;
    try { savedCode = localStorage.getItem('hg.code.music'); otherCode = localStorage.getItem('hg.code.quiz'); } catch (e) {}
    if (savedCode) cfg = Net.saveCfg({ code: savedCode });
    else {
      var code = (!cfg.code || otherCode === cfg.code) ? Net.randomCode() : cfg.code;
      cfg = Net.saveCfg({ code: code });
      try { localStorage.setItem('hg.code.music', code); } catch (e) {}
    }

    H.code = cfg.code;
    H.secs = storedSecs();
    H.qSecs = H.secs;

    Net.setRole('host');
    Net.onChange(function (snap) { ingest(snap); renderSide(); renderStage(); });
    Net.onStatus(renderStatus);

    var au = document.getElementById('clip');
    if (au) au.addEventListener('ended', function () { stopClip(); });

    paintChrome();
    bindEvents();
    renderAll();

    if (cfg.key && cfg.projectId && !cfg.db) {
      toast('databaseURL 이 없어서 DB 주소를 찾는 중…');
      Net.detectDb(cfg.projectId).then(function (db) {
        if (db) { Net.saveCfg({ db: db }); location.reload(); return; }
        toast('DB 주소를 찾지 못했습니다. 설정에서 databaseURL 을 함께 넣어주세요.');
        openSettings();
      });
      return;
    }

    try {
      var nr = sessionStorage.getItem('hg.newroom');
      if (nr) {
        sessionStorage.removeItem('hg.newroom');
        setTimeout(function () { toast('새 방 ' + nr + ' 준비 완료 — 참가 링크를 다시 뿌려주세요!'); }, 700);
      }
    } catch (e) {}

    Net.connect()
      .then(function () { return Net.claimHost(); })
      .then(function () { return Net.setMeta({ title: M.title || '음악 테스트', seconds: H.secs, total: TOTAL }); })
      .then(function () { H.ready = true; })
      .catch(function (e) {
        H.ready = Net.getStatus() === 'local';
        toast('Firebase 연결 실패: ' + e.message);
        if (!H.ready) openSettings();
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

/* =========================================================================
   음악 테스트 · PLAYER (주관식 타이핑)
   - 링크 접속 → 닉네임 입력 → 정답을 직접 타이핑해서 제출
   - 정답/오답은 호스트가 확정한 results 를 그대로 읽어서 표시
   ========================================================================= */
(function () {
  'use strict';

  var M = window.MUSIC;
  var Net = window.Net;
  var TOTAL = M.questions.length;

  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function asList(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    if (typeof v !== 'object') return [];
    return Object.keys(v).sort(function (a, b) { return Number(a) - Number(b); })
      .map(function (k) { return v[k]; })
      .filter(function (x) { return x && typeof x === 'object'; });
  }

  var params = new URLSearchParams(location.search);
  var CODE = (params.get('s') || '').toUpperCase();
  var DB = params.get('db') || '';
  var KEY = params.get('k') || '';

  var P = {
    name: '', snap: {}, ans: null, skew: 0, tsKey: 0,
    sending: false, note: '', cdT: null, hbT: null, renderKey: ''
  };

  function ansKey() { return 'hg.music.ans.' + CODE; }
  function loadAns() {
    try {
      var a = JSON.parse(localStorage.getItem(ansKey()) || 'null');
      if (a && typeof a.q === 'number') P.ans = a;
    } catch (e) {}
  }
  function saveAns(a) {
    P.ans = a;
    try { localStorage.setItem(ansKey(), JSON.stringify(a)); } catch (e) {}
  }

  /* ------------------------------ 렌더 ------------------------------ */
  function renderStatus(s) {
    var el = $('#pStat');
    if (!el) return;
    var map = {
      live: ['실시간', 'live'], connecting: ['연결 중', 'wait'], reconnecting: ['재연결', 'wait'],
      offline: ['오프라인', 'bad'], local: ['로컬', 'wait'], idle: ['대기', 'wait']
    };
    var v = map[s] || map.idle;
    el.textContent = v[0];
    el.className = 'p-stat ' + v[1];
  }

  function header() {
    var el = $('#pScore');
    if (!el) return;
    if (!P.name) { el.innerHTML = ''; return; }
    var s = (P.snap.scores || {})[Net.uid()];
    el.innerHTML = s ? '<b>' + s.score + '</b>점 · ' + s.correct + '/' + TOTAL : '<b>0</b>점';
  }

  function render() {
    header();
    var st = $('#pStage');
    if (!st) return;

    var sn = P.snap || {};
    var sg = sn.state || {};
    var sc = (sn.scores || {})[Net.uid()] || null;
    var key = [
      P.name, P.note, !!sn.state, sg.phase, sg.qi, sg.ts, sg.answer,
      P.ans && P.ans.q, P.ans && P.ans.txt,
      Object.keys(sn.players || {}).length,
      sc ? sc.score + '/' + sc.correct : '',
      sn.final && sn.final.at
    ].join('|');
    if (key === P.renderKey) return;
    P.renderKey = key;

    if (!CODE) return noCode();
    if (!P.name) return screenJoin();
    if (Net.isBanned(Net.uid())) return msg('내보내졌습니다', '호스트가 이 세션에서 내보냈어요.', true);

    var state = sn.state;
    if (!state || !state.phase) return msg('대기 중', '호스트가 준비하고 있어요…', false);

    if (state.phase === 'lobby') return msg('준비 완료', '<b>' + esc(P.name) + '</b>님, 곧 시작합니다!', false);
    if (state.phase === 'closed') return screenClosed();
    if (state.phase === 'end') return screenEnd();

    var qi = state.qi;
    var item = M.questions[qi];
    if (!item) return msg('대기 중', '문제를 불러오는 중…', false);

    if (state.phase === 'reveal') return screenReveal(state, item);
    return screenQuestion(state, item);
  }

  function noCode() {
    $('#pStage').innerHTML = '<div class="p-msg is-error">' +
        '<h2>참가자용 페이지입니다</h2>' +
        '<p class="p-sub">이 주소에는 <b>세션 코드</b>가 없어요.<br />진행자가 <b>참가 링크 복사</b>로 보내준 링크로 접속해 주세요.</p>' +
        '<a class="btn primary big block" href="musictest.html">진행자(호스트) 화면 열기</a>' +
      '</div>';
  }

  function msg(title, body, isError) {
    $('#pStage').innerHTML = '<div class="p-msg' + (isError ? ' is-error' : '') + '">' +
      '<h2>' + title + '</h2><p class="p-sub">' + body + '</p></div>';
  }

  function screenClosed() {
    if (P.hbT) { clearInterval(P.hbT); P.hbT = null; }
    $('#pStage').innerHTML = '<div class="p-msg is-error">' +
        '<h2>방이 닫혔습니다</h2>' +
        '<p class="p-sub">진행자가 <b>새 방</b>을 열었어요.<br />채팅에 올라온 <b>새 링크</b>로 다시 참가해 주세요.</p>' +
      '</div>';
  }

  function screenJoin() {
    $('#pStage').innerHTML = '<div class="p-join">' +
        '<h1>' + esc(M.title || '음악 테스트') + '</h1>' +
        '<p class="p-sub">세션 <b>' + esc(CODE) + '</b> · 전체 ' + TOTAL + '문제 · <b>정답을 직접 타이핑</b></p>' +
        '<input id="nameInput" class="p-input" maxlength="12" placeholder="닉네임 입력" autocomplete="off" />' +
        '<button class="btn primary big block" id="btnJoin">참가하기</button>' +
      '</div>';
    var input = $('#nameInput');
    input.value = '';
    input.focus();
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
    $('#btnJoin').addEventListener('click', doJoin);
  }

  function uniqueName(base) {
    var taken = {};
    Object.keys((P.snap && P.snap.players) || {}).forEach(function (pid) {
      if (pid === Net.uid()) return;
      taken[String(P.snap.players[pid].name || '').toLowerCase()] = 1;
    });
    var n = base, i = 2;
    while (taken[n.toLowerCase()]) { n = base + '#' + i; i += 1; }
    return n;
  }

  function doJoin() {
    var input = $('#nameInput');
    var v = (input.value || '').trim().replace(/\s+/g, ' ').slice(0, 12);
    if (!v) { input.focus(); return; }
    P.name = uniqueName(v);
    localStorage.setItem('hg.music.name', P.name);
    Net.join(P.name).then(function () {
      startHeartbeat();
      P.renderKey = '';
      render();
    }).catch(function (e) {
      P.note = '참가 실패: ' + e.message;
      P.renderKey = '';
      render();
    });
  }

  function startHeartbeat() {
    if (P.hbT) return;
    P.hbT = setInterval(function () { if (P.name) Net.heartbeat(P.name); }, 20000);
  }

  /* ---------------------------- 문제 화면 ---------------------------- */
  function clockLeft(state) {
    var start = state.startedAt;
    var secs = state.seconds || M.seconds || 15;
    if (typeof start !== 'number' || !start) return null;
    if (typeof state.ts === 'number' && state.ts !== P.tsKey) {
      P.tsKey = state.ts;
      P.skew = state.ts - Date.now();
    }
    return Math.max(0, (start + secs * 1000) - (Date.now() + P.skew));
  }

  function screenQuestion(state, item) {
    if (P.ans && P.ans.q === state.qi) return screenAnswered(state);

    var left = clockLeft(state);
    $('#pStage').innerHTML = '<div class="p-question">' +
        '<div class="p-qtop">' +
          '<span class="chip">Q' + (state.qi + 1) + ' / ' + TOTAL + '</span>' +
          '<span class="chip ghost" id="pCd">' + (left === null ? (state.seconds || 15) : Math.ceil(left / 1000)) + '초</span>' +
        '</div>' +
        '<h2 class="p-qtitle">' + esc(item.q) + '</h2>' +
        (item.hint ? '<p class="p-hint">' + esc(item.hint) + '</p>' : '') +
        '<input id="ansInput" class="p-input big" maxlength="60" placeholder="정답 입력" autocomplete="off" autocapitalize="off" />' +
        '<button class="btn primary big block" id="btnSubmit">제출</button>' +
      '</div>';

    var input = $('#ansInput');
    input.focus();
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    $('#btnSubmit').addEventListener('click', submit);
    startCountdown(state);
  }

  function startCountdown(state) {
    stopCountdown();
    P.cdT = setInterval(function () {
      var node = $('#pCd');
      if (!node) { stopCountdown(); return; }
      var left = clockLeft(state);
      if (left === null) return;
      node.textContent = Math.ceil(left / 1000) + '초';
      node.classList.toggle('danger', left <= 5000);
      if (left <= 1600) {
        var btn = $('#btnSubmit');
        if (btn && btn.textContent !== '시간 종료') { btn.textContent = '시간 종료'; btn.classList.add('off'); }
      }
      if (left <= 0) stopCountdown();
    }, 200);
  }
  function stopCountdown() { if (P.cdT) { clearInterval(P.cdT); P.cdT = null; } }

  function submit() {
    if (P.sending) return;
    var state = P.snap.state;
    if (!state || state.phase !== 'question') return;
    var input = $('#ansInput');
    var txt = (input && input.value || '').trim().slice(0, 60);
    if (!txt) { if (input) input.focus(); return; }

    var qi = state.qi;
    stopCountdown();
    P.sending = true;
    P.note = '';
    var prev = P.ans;
    saveAns({ q: qi, txt: txt });
    try { navigator.vibrate && navigator.vibrate(25); } catch (e) {}
    P.renderKey = '';
    render();

    Net.answerText(qi, txt, P.name).then(function () {
      P.sending = false;
      P.renderKey = '';
      render();
    }).catch(function (e) {
      var m = String(e.message || '');
      if (/denied|permission/i.test(m)) {
        if (prev && prev.q === qi) saveAns(prev);
        else saveAns({ q: qi, txt: null });
        P.sending = false;
        P.renderKey = '';
        render();
        return;
      }
      setTimeout(function () {
        Net.answerText(qi, txt, P.name).then(function () {
          P.sending = false; P.renderKey = ''; render();
        }).catch(function () {
          P.sending = false;
          P.note = '전송 실패 — 잠시 후 다시 시도해 주세요';
          P.renderKey = ''; render();
        });
      }, 400);
    });
  }

  function screenAnswered(state) {
    var txt = P.ans && P.ans.q === state.qi ? P.ans.txt : null;
    $('#pStage').innerHTML = '<div class="p-wait">' +
        '<div class="p-spinner"></div>' +
        '<h2>제출 완료!</h2>' +
        '<p class="p-picked">내 답: <b>' + (txt ? esc(txt) : '제출됨') + '</b></p>' +
        (P.note ? '<p class="p-note">' + esc(P.note) + '</p>' : '') +
        '<p class="p-sub">정답 공개를 기다리는 중…</p>' +
        '<div class="p-progress-note">Q' + (state.qi + 1) + ' / ' + TOTAL + '</div>' +
      '</div>';
  }

  function screenReveal(state, item) {
    var uid = Net.uid();
    var mine = P.ans && P.ans.q === state.qi ? P.ans.txt : null;
    var r = (((P.snap.results || {})['q' + state.qi]) || {})[uid];
    var correctTxt = state.answer || item.answers[0];

    var verdict;
    if (!r) {
      verdict = '<div class="verdict miss"><span>⏱</span><b>미응답</b><small>다음 문제는 꼭!</small></div>';
    } else if (r.ok) {
      verdict = '<div class="verdict hit"><span>✓</span><b>정답!</b><small>잘했어요</small></div>';
    } else {
      verdict = '<div class="verdict miss"><span>✗</span><b>오답</b><small>아쉬워요</small></div>';
    }

    var score = ((P.snap.scores || {})[uid]) || { score: 0, correct: 0 };

    $('#pStage').innerHTML = '<div class="p-reveal">' +
        '<div class="p-qtop"><span class="chip">Q' + (state.qi + 1) + ' / ' + TOTAL + '</span>' +
          '<span class="chip ghost">' + esc(M.title || '음악 테스트') + '</span></div>' +
        '<h2 class="p-qtitle small">' + esc(item.q) + '</h2>' +
        (item.image ? '<img class="cover p-cover" src="' + esc(item.image) + '" alt="album cover" />' : '') +
        verdict +
        '<div class="p-answer"><span class="tag">정답</span><b>' + esc(correctTxt) + '</b>' +
          (item.note ? '<span class="mini">' + esc(item.note) + '</span>' : '') + '</div>' +
        (mine ? '<p class="p-picked">내 답: <b>' + esc(mine) + '</b></p>' : '') +
        '<div class="p-scoreline">내 점수 <b>' + score.score + '</b>점 (' + score.correct + '/' + TOTAL + ' 정답)</div>' +
        '<p class="p-sub">다음 문제를 기다리는 중…</p>' +
      '</div>';
  }

  function screenEnd() {
    var uid = Net.uid();
    var rank = asList((P.snap || {}).final && P.snap.final.rank).sort(function (a, b) {
      return (b.score || 0) - (a.score || 0) || (b.correct || 0) - (a.correct || 0);
    });
    if (!rank.length) {
      var scores = (P.snap && P.snap.scores) || {};
      rank = Object.keys(scores).map(function (pid) {
        var s = scores[pid] || {};
        return { uid: pid, name: s.name || '참가자', score: s.score || 0, correct: s.correct || 0 };
      }).sort(function (a, b) { return b.score - a.score || b.correct - a.correct; });
    }

    var idx = -1;
    for (var i = 0; i < rank.length; i++) { if (rank[i].uid === uid) { idx = i; break; } }
    var me = idx >= 0 ? rank[idx] : null;
    var medal = ['🥇', '🥈', '🥉'];
    var top = rank.slice(0, 3).map(function (r2, i2) {
      return '<li class="p-rank-row' + (r2.uid === uid ? ' me' : '') + '">' +
          '<span class="rk">' + (medal[i2] || i2 + 1) + '</span>' +
          '<span class="nm">' + esc(r2.name) + '</span>' +
          '<span class="pt">' + r2.score + '점</span></li>';
    }).join('');

    var mineCard = me
      ? '<div class="p-myrank"><div class="big">' + (idx + 1) + '위</div>' +
        '<div class="sub">' + me.score + '점 · ' + me.correct + '/' + TOTAL + ' 정답</div></div>'
      : '';

    $('#pStage').innerHTML = '<div class="p-end">' +
        '<h2>최종 결과</h2>' +
        (idx >= 3 ? mineCard : '') +
        '<div class="p-top3-label">TOP 3</div>' +
        '<ol class="p-rank-list">' + top + '</ol>' +
        (idx < 3 && me ? mineCard : '') +
        '<p class="p-sub">참여해줘서 고마워요!</p>' +
      '</div>';
  }

  function onSnap(snap) { P.snap = snap || {}; render(); }

  function boot() {
    Net.loadCfg();
    Net.saveCfg({
      code: CODE || Net.config().code,
      db: DB || Net.config().db,
      key: KEY || Net.config().key
    });
    Net.setRole('player');
    Net.onChange(onSnap);
    Net.onStatus(renderStatus);

    loadAns();
    P.name = localStorage.getItem('hg.music.name') || '';

    render();
    renderStatus(Net.getStatus());
    if (!CODE) return;

    Net.connect().then(function () {
      if (P.name && !Net.isBanned(Net.uid())) {
        return Net.join(P.name).then(function () { startHeartbeat(); });
      }
      return null;
    }).catch(function (e) {
      $('#pStage').innerHTML = '<div class="p-msg is-error">' +
          '<h2>연결 실패</h2>' +
          '<p class="p-sub">' + esc(e.message) + '</p>' +
          '<p class="p-sub mini">세션 ' + esc(CODE) + ' · DB ' + esc(String(DB || Net.config().db || '없음').replace('https://', '')) + '</p>' +
          '<p class="p-sub mini">링크를 직접 고치면 안 됩니다. 진행자에게 다시 받으세요.</p>' +
        '</div>';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

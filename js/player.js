/* =========================================================================
   PLAYER (시청자) 화면
   - 링크로 접속 → 닉네임 입력 → 자동 참가 (호스트가 추가할 필요 없음)
   - DB 실시간 스트림으로 즉시 반영, 정답/점수는 호스트가 확정
   ========================================================================= */
(function () {
  'use strict';

  var QUIZ = window.QUIZ;
  var Net = window.Net;
  var TOTAL = QUIZ.questions.length;
  var SHAPES = ['▲', '◆', '●', '■', '★', '✚'];

  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* 문자열 배열 변환 (Firebase 는 배열을 {0:..,1:..} 객체로 저장) */
  function asStrList(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v.map(function (x) { return String(x); });
    if (typeof v !== 'object') return [];
    return Object.keys(v)
      .sort(function (a, b) { return Number(a) - Number(b); })
      .map(function (k) { return String(v[k]); });
  }

  /* Firebase Realtime DB 는 배열을 {0:..,1:..} 객체로 저장하므로 항상 배열로 되돌린다 */
  function asList(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    if (typeof v !== 'object') return [];
    return Object.keys(v)
      .sort(function (a, b) { return Number(a) - Number(b); })
      .map(function (k) { return v[k]; })
      .filter(function (x) { return x && typeof x === 'object'; });
  }

  function QN() {
    return (P.snap && P.snap.state && P.snap.state.total) || TOTAL;
  }

  var params = new URLSearchParams(location.search);
  var CODE = (params.get('s') || '').toUpperCase();
  var DB = params.get('db') || '';
  var KEY = params.get('k') || '';

  var P = {
    name: '', snap: {}, ans: null, skew: 0, tsKey: 0,
    sending: false, note: '', cdT: null, hbT: null,
    joinedOnce: false, renderKey: ''
  };

  function ansKey() { return 'hg.ans.' + CODE; }

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
      live: ['실시간', 'live'], connecting: ['연결 중', 'wait'],
      reconnecting: ['재연결', 'wait'], offline: ['오프라인', 'bad'],
      local: ['로컬', 'wait'], idle: ['대기', 'wait']
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

    /* 하트비트(다른 참가자 seen 갱신) 같은 사소한 변화로 화면이 다시 그려지면
       터치가 씹히므로, '보이는 값'이 바뀔 때만 다시 그린다. */
    var sn = P.snap || {};
    var sg = sn.state || {};
    var sc = (sn.scores || {})[Net.uid()] || null;
    var key = [
      P.name, P.note, !!sn.state, sg.phase, sg.qi, sg.correct, sg.ts,
      P.ans && P.ans.q, P.ans && P.ans.o,
      Object.keys(sn.players || {}).length,
      sc ? sc.score + '/' + sc.correct : '',
      sn.final && sn.final.at
    ].join('|');
    if (key === P.renderKey) return;
    P.renderKey = key;

    if (!CODE) return noCode();
    if (!P.name) return screenJoin();

    var snap = P.snap || {};
    if (Net.isBanned(Net.uid())) {
      return msg('내보내졌습니다', '호스트가 이 세션에서 내보냈어요.', true);
    }

    var state = snap.state;
    if (!state || !state.phase) return msg('대기 중', '호스트가 퀴즈를 준비하고 있어요…', false);

    if (state.phase === 'lobby') return msg('준비 완료', '<b>' + esc(P.name) + '</b>님, 곧 시작합니다!', false);
    if (state.phase === 'closed') return screenClosed();
    if (state.phase === 'end') return screenEnd(state);

    var qi = state.qi;
    var qOpts = asStrList(state.q && state.q.o);
    var item = qOpts.length
      ? { q: (state.q && state.q.t) || '', part: (state.q && state.q.p) || '', options: qOpts }
      : QUIZ.questions[qi];
    if (!item) return msg('대기 중', '문제를 불러오는 중…', false);

    if (state.phase === 'reveal') return screenReveal(state, item);
    return screenQuestion(state, item);
  }

  function noCode() {
    $('#pStage').innerHTML = '<div class="p-msg is-error">' +
        '<h2>참가자용 페이지입니다</h2>' +
        '<p class="p-sub">이 주소에는 <b>세션 코드</b>가 없어서 참가할 수 없어요.<br />' +
          '진행자가 <b>참가 링크 복사</b> 로 보내준 링크로 접속해 주세요.<br />' +
          '<span class="mini">(예: play.html?s=K7M2P&amp;db=...&amp;k=...)</span></p>' +
        '<p class="p-sub">진행자라면 아래 버튼으로 호스트 화면을 여세요.</p>' +
        '<a class="btn primary big block" href="index.html">호스트(진행자) 화면 열기</a>' +
      '</div>';
  }

  function msg(title, body, isError) {
    var st = $('#pStage');
    st.innerHTML = '<div class="p-msg' + (isError ? ' is-error' : '') + '">' +
      '<h2>' + title + '</h2><p class="p-sub">' + body + '</p></div>';
  }

  function screenClosed() {
    if (P.hbT) { clearInterval(P.hbT); P.hbT = null; }
    $('#pStage').innerHTML = '<div class="p-msg is-error">' +
        '<h2>방이 닫혔습니다</h2>' +
        '<p class="p-sub">진행자가 <b>새 방</b>을 열었어요.<br />' +
          '채팅에 올라온 <b>새 링크</b>로 다시 참가해 주세요.' +
          '<br /><span class="mini">(닉네임은 그대로 기억됩니다)</span></p>' +
      '</div>';
  }

  function screenJoin() {
    var st = $('#pStage');
    st.innerHTML = '<div class="p-join">' +
        '<h1>유하경 능력고사</h1>' +
        '<p class="p-sub">세션 <b>' + esc(CODE) + '</b> · 전체 ' + QN() + '문제</p>' +
        '<input id="nameInput" class="p-input" maxlength="12" placeholder="닉네임 입력" autocomplete="off" />' +
        '<button class="btn primary big block" id="btnJoin">참가하기</button>' +
        '<p class="hint">닉네임은 리더보드에 표시됩니다.</p>' +
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
    localStorage.setItem('hg.name', P.name);
    Net.join(P.name).then(function () {
      P.joinedOnce = true;
      startHeartbeat();
      render();
    }).catch(function (e) {
      P.note = '참가 실패: ' + e.message;
      render();
    });
  }

  function startHeartbeat() {
    if (P.hbT) return;
    P.hbT = setInterval(function () {
      if (P.name) Net.heartbeat(P.name);
    }, 20000);
  }

  /* ---------------------------- 문제 화면 ---------------------------- */
  function clockLeft(state) {
    var start = state.startedAt;
    var secs = state.seconds || QUIZ.seconds;
    if (typeof start !== 'number' || !start) return null;
    if (typeof state.ts === 'number' && state.ts !== P.tsKey) {
      P.tsKey = state.ts;
      P.skew = state.ts - Date.now();
    }
    return Math.max(0, (start + secs * 1000) - (Date.now() + P.skew));
  }

  function screenQuestion(state, item) {
    var mine = P.ans && P.ans.q === state.qi;
    if (mine) return screenAnswered(state, item);

    var left = clockLeft(state);
    var opts = item.options.map(function (text, k) {
      return '<button class="p-ans tone-' + (k % 4) + '" data-k="' + k + '">' +
          '<span class="badge">' + (SHAPES[k] || k + 1) + '</span>' +
          '<span class="ans-text">' + esc(text) + '</span>' +
        '</button>';
    }).join('');

    $('#pStage').innerHTML = '<div class="p-question">' +
        '<div class="p-qtop">' +
          '<span class="chip">Q' + (state.qi + 1) + ' / ' + QN() + '</span>' +
          '<span class="chip ghost" id="pCd">' + (left === null ? QUIZ.seconds : Math.ceil(left / 1000)) + '초</span>' +
        '</div>' +
        '<h2 class="p-qtitle">' + esc(item.q) + '</h2>' +
        '<div class="p-ans-grid n' + item.options.length + '">' + opts + '</div>' +
      '</div>';

    Array.prototype.forEach.call(document.querySelectorAll('.p-ans'), function (btn) {
      btn.addEventListener('click', function () { submit(parseInt(btn.getAttribute('data-k'), 10)); });
    });

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
      if (left <= 0) stopCountdown();
    }, 200);
  }

  function stopCountdown() {
    if (P.cdT) { clearInterval(P.cdT); P.cdT = null; }
  }

  function submit(k) {
    if (P.sending) return;
    var state = P.snap.state;
    if (!state || state.phase !== 'question') return;
    var qi = state.qi;

    stopCountdown();
    P.sending = true;
    P.note = '';
    var prev = P.ans;
    saveAns({ q: qi, o: k });
    try { navigator.vibrate && navigator.vibrate(25); } catch (e) {}
    render();

    Net.answer(qi, k, P.name).then(function () {
      P.sending = false;
      render();
    }).catch(function (e) {
      var m = String(e.message || '');
      if (/denied|permission/i.test(m)) {
        // 이미 제출했거나 제한 시간이 지난 경우 → 이전 기록 복원 (없으면 '제출됨')
        if (prev && prev.q === qi) saveAns(prev);
        else saveAns({ q: qi, o: null });
        P.sending = false;
        render();
        return;
      }
      setTimeout(function () {
        Net.answer(qi, k, P.name).then(function () {
          P.sending = false;
          render();
        }).catch(function () {
          P.sending = false;
          P.note = '전송 실패 — 잠시 후 다시 시도해 주세요';
          render();
        });
      }, 400);
    });
  }

  function screenAnswered(state, item) {
    var opt = P.ans && P.ans.q === state.qi ? P.ans.o : null;
    var text = opt != null && item.options[opt] != null ? item.options[opt] : '';
    $('#pStage').innerHTML = '<div class="p-wait">' +
        '<div class="p-spinner"></div>' +
        '<h2>제출 완료!</h2>' +
        '<p class="p-picked">내 답: <b>' + (opt == null ? '제출됨' : (SHAPES[opt] || '') + ' ' + esc(text)) + '</b></p>' +
        (P.note ? '<p class="p-note">' + esc(P.note) + '</p>' : '') +
        '<p class="p-sub">정답 공개를 기다리는 중…</p>' +
        '<div class="p-progress-note">Q' + (state.qi + 1) + ' / ' + QN() + '</div>' +
      '</div>';
  }

  function screenReveal(state, item) {
    var correct = state.correct;
    var correctText = item.options[correct] != null ? item.options[correct] : '';
    var has = !!(P.ans && P.ans.q === state.qi);
    var mine = has ? P.ans.o : null;

    var verdict;
    if (!has) {
      verdict = '<div class="verdict miss"><span>⏱</span><b>미응답</b><small>다음 문제는 꼭!</small></div>';
    } else if (mine === null) {
      verdict = '<div class="verdict miss"><span>…</span><b>제출 완료</b><small>정답 확인은 다음 문제부터</small></div>';
    } else if (mine === correct) {
      verdict = '<div class="verdict hit"><span>✓</span><b>정답!</b><small>잘했어요</small></div>';
    } else {
      verdict = '<div class="verdict miss"><span>✗</span><b>오답</b><small>아쉬워요</small></div>';
    }

    var score = ((P.snap.scores || {})[Net.uid()]) || { score: 0, correct: 0 };

    $('#pStage').innerHTML = '<div class="p-reveal">' +
        '<div class="p-qtop"><span class="chip">Q' + (state.qi + 1) + ' / ' + QN() + '</span>' +
          '<span class="chip ghost">' + esc(item.part || '') + '</span></div>' +
        '<h2 class="p-qtitle small">' + esc(item.q) + '</h2>' +
        verdict +
        '<div class="p-answer"><span class="tag">정답</span>' +
          '<b>' + (SHAPES[correct] || '') + ' ' + (correct + 1) + '번</b>' +
          '<span>' + esc(correctText) + '</span></div>' +
        '<div class="p-scoreline">내 점수 <b>' + score.score + '</b>점 (' + score.correct + '/' + QN() + ' 정답)</div>' +
        '<p class="p-sub">다음 문제를 기다리는 중…</p>' +
      '</div>';
  }

  function screenEnd(state) {
    var uid = Net.uid();
    var final = (P.snap && P.snap.final) || null;
    var rank = asList(final && final.rank).sort(function (a, b) {
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

    var top = rank.slice(0, 3).map(function (r, i) {
      return '<li class="p-rank-row' + (r.uid === uid ? ' me' : '') + '">' +
          '<span class="rk">' + (medal[i] || i + 1) + '</span>' +
          '<span class="nm">' + esc(r.name) + '</span>' +
          '<span class="pt">' + r.score + '점</span></li>';
    }).join('');

    var mineCard = me
      ? '<div class="p-myrank"><div class="big">' + (idx + 1) + '위</div>' +
          '<div class="sub">' + me.score + '점 · ' + me.correct + '/' + QN() + ' 정답</div></div>'
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

  /* ------------------------------ 이벤트 ------------------------------ */
  function onSnap(snap) {
    P.snap = snap || {};
    render();
  }

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
    P.name = localStorage.getItem('hg.name') || '';

    render();
    renderStatus(Net.getStatus());

    /* 코드 없이 들어온 경우 = 참가자 페이지를 잘못 연 것 → 안내 화면만 보여주고 연결 시도하지 않음 */
    if (!CODE) return;

    Net.connect().then(function () {
      if (P.name && !Net.isBanned(Net.uid())) {
        return Net.join(P.name).then(function () { startHeartbeat(); });
      }
      return null;
    }).catch(function (e) {
      var info = [
        '세션 코드: <b>' + esc(CODE || '없음') + '</b>',
        'DB: <b>' + esc(String(DB || (Net.config().db || '없음')).replace('https://', '')) + '</b>',
        'API 키: <b>' + (KEY || Net.config().key ? '있음' : '없음') + '</b>'
      ].join('<br />');
      $('#pStage').innerHTML = '<div class="p-msg is-error">' +
          '<h2>연결 실패</h2>' +
          '<p class="p-sub">' + esc(e.message) + '</p>' +
          '<p class="p-sub mini">' + info + '</p>' +
          '<p class="p-sub mini">링크를 직접 줄이거나 고치면 안 됩니다. 진행자에게 링크를 다시 받으세요.</p>' +
        '</div>';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

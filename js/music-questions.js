/* =========================================================================
   음악 테스트 = "1초 듣고 노래 맞추기" (주관식)
   -------------------------------------------------------------------------
   { q: '이 곡의 제목은?',
     audio: 'audio/1.mp3',      // ▶ 재생할 파일
     start: 0,                  // 재생 시작 위치(초) — 후렴부터 듣게 하려면 예: 32
     image: 'images/1.jpg',     // 정답 공개 때 보여줄 앨범 커버
     answers: [],               // 정답 후보들 (비워두면 진행자가 공개 화면에서 직접 입력해 채점)
     note: '' }                 // 정답 공개 때 함께 보일 설명 (가수/연도 등)

   · answers 를 채워두면 자동 채점, 비워두면 공개 화면에서
     진행자가 정답을 타이핑하는 순간 그 자리에서 채점됩니다. (추천)
   · 채점은 공백·문장부호 무시, 대소문자 무시, 부분일치 허용
   · answers 는 여러 개 넣을 수 있습니다: ['Dynamite','다이너마이트']
   ========================================================================= */
window.MUSIC = {
  title: '1초 듣고 노래 맞추기',
  seconds: 15,          // 문제당 제한 시간 (설정에서도 변경 가능)
  clipSeconds: 1,       // ★ 한 번에 들려주는 길이(초)
  pointsPerCorrect: 1,  // 정답 1개당 점수
  poster: 'images/bg.png', // 로비에 띄울 포스터 (없으면 빈칸)
  questions: [
    { q: '이 곡의 제목은?', audio: 'audio/1.mp3',  start: 0, image: 'images/1.jpg',  answers: [], note: '' },
    { q: '이 곡의 제목은?', audio: 'audio/2.mp3',  start: 0, image: 'images/2.jpg',  answers: [], note: '' },
    { q: '이 곡의 제목은?', audio: 'audio/3.mp3',  start: 0, image: 'images/3.jpg',  answers: [], note: '' },
    { q: '이 곡의 제목은?', audio: 'audio/4.mp3',  start: 0, image: 'images/4.jpg',  answers: [], note: '' },
    { q: '이 곡의 제목은?', audio: 'audio/5.mp3',  start: 0, image: 'images/5.jpg',  answers: [], note: '' },
    { q: '이 곡의 제목은?', audio: 'audio/6.mp3',  start: 0, image: 'images/6.jpg',  answers: [], note: '' },
    { q: '이 곡의 제목은?', audio: 'audio/7.mp3',  start: 0, image: 'images/7.jpg',  answers: [], note: '' },
    { q: '이 곡의 제목은?', audio: 'audio/8.mp3',  start: 0, image: 'images/8.jpg',  answers: [], note: '' },
    { q: '이 곡의 제목은?', audio: 'audio/9.mp3',  start: 0, image: 'images/9.jpg',  answers: [], note: '' },
    { q: '이 곡의 제목은?', audio: 'audio/10.mp3', start: 0, image: 'images/10.jpg', answers: [], note: '' },
    { q: '이 곡의 제목은?', audio: 'audio/11.mp3', start: 0, image: 'images/11.jpg', answers: [], note: '' },
    { q: '이 곡의 제목은?', audio: 'audio/12.mp3', start: 0, image: 'images/12.jpg', answers: [], note: '' },
    { q: '이 곡의 제목은?', audio: 'audio/13.mp3', start: 0, image: 'images/13.jpg', answers: [], note: '' },
    { q: '이 곡의 제목은?', audio: 'audio/14.mp3', start: 0, image: 'images/14.jpg', answers: [], note: '' },
    { q: '이 곡의 제목은?', audio: 'audio/15.mp3', start: 0, image: 'images/15.jpg', answers: [], note: '' }
  ]
};

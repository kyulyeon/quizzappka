/* =========================================================================
   음악 테스트 = "1초 듣고 노래 맞추기"
   -------------------------------------------------------------------------
   title  : ★ 정답 (이게 자동 채점 기준입니다)
   artist / album / emoji : 정답 공개 화면에 표시
   image  : 정답 공개 때 보여줄 앨범 커버
   audio  : 재생할 음원
   introStart     : '인트로 1초' 시작 위치(초)
   highlightStart : '하이라이트 1초' 시작 위치(초)
   answers: 추가로 인정할 표기 (예: ['eight','에이트']) — title 은 자동 포함
   ========================================================================= */
window.MUSIC = {
  title: '1초 듣고 노래 맞추기',
  q: '이 곡의 제목은?',
  seconds: 15,          // 문제당 제한 시간 (설정에서도 변경)
  clipSeconds: 1,       // 한 번에 들려주는 길이(초)
  pointsPerCorrect: 1,  // 정답 1개당 점수
  poster: 'images/bg.png',

  questions: [
    { title: '멸종위기사랑', artist: '이찬혁', album: 'EROS', emoji: '💥',
      image: 'images/1.jpg', audio: 'audio/1.mp3', introStart: 1, highlightStart: 55, answers: [] },

    { title: '끝사랑', artist: '김범수', album: 'SQLISTA Part 2', emoji: '🔥',
      image: 'images/2.jpg', audio: 'audio/2.mp3', introStart: 1, highlightStart: 55, answers: [] },

    { title: '일과 이분의일', artist: '투투', album: 'TWO TWO', emoji: '🌸',
      image: 'images/3.jpg', audio: 'audio/3.mp3', introStart: 1, highlightStart: 60,
      answers: ['일과이분의1', '일과2분의1'] },

    { title: 'instagram', artist: 'DEAN', album: 'instagram', emoji: '📱',
      image: 'images/4.jpg', audio: 'audio/4.mp3', introStart: 0, highlightStart: 60,
      answers: ['인스타그램', '인스타'] },

    { title: 'All For You', artist: '서인국, 정은지', album: '응답하라 1997 Love Story Part.1', emoji: '💖',
      image: 'images/5.jpg', audio: 'audio/5.mp3', introStart: 0, highlightStart: 60,
      answers: ['올포유'] },

    { title: '영원한 사랑', artist: '핑클', album: 'White', emoji: '💌',
      image: 'images/6.jpg', audio: 'audio/6.mp3', introStart: 0, highlightStart: 60, answers: [] },

    { title: '에잇', artist: '아이유', album: '에잇', emoji: '🍊',
      image: 'images/7.jpg', audio: 'audio/7.mp3', introStart: 0, highlightStart: 60,
      answers: ['eight', '에이트'] },

    { title: '사랑인가 봐', artist: '멜로망스', album: '사랑인가 봐 (사내맞선 OST Special Track)', emoji: '🌸',
      image: 'images/8.jpg', audio: 'audio/8.mp3', introStart: 0, highlightStart: 60, answers: [] },

    { title: '넘버나인', artist: '티아라', album: 'AGAIN', emoji: '⚡',
      image: 'images/9.jpg', audio: 'audio/9.mp3', introStart: 0, highlightStart: 60,
      answers: ['numbernine', 'number9', '넘버9'] },

    { title: '백야', artist: '짙은', album: '백야', emoji: '🌙',
      image: 'images/10.jpg', audio: 'audio/10.mp3', introStart: 0, highlightStart: 60, answers: [] },

    { title: '그리워하다', artist: '비투비', album: 'Brother Act.', emoji: '🍂',
      image: 'images/11.jpg', audio: 'audio/11.mp3', introStart: 0, highlightStart: 60, answers: [] },

    { title: 'Fiction', artist: '비스트', album: 'Fiction and Fact', emoji: '📖',
      image: 'images/12.jpg', audio: 'audio/12.mp3', introStart: 0, highlightStart: 60,
      answers: ['픽션'] },

    { title: '이렇게 좋아해 본 적이 없어요', artist: 'CHEEZE', album: '이렇게 좋아해 본 적이 없어요 (소녀의 세계 X CHEEZE)', emoji: '🧀',
      image: 'images/13.jpg', audio: 'audio/13.mp3', introStart: 0, highlightStart: 60, answers: [] },

    { title: '광화문에서', artist: '규현', album: '광화문에서 - The 1st Mini Album', emoji: '🍁',
      image: 'images/14.jpg', audio: 'audio/14.mp3', introStart: 0, highlightStart: 60, answers: [] },

    { title: '그때 헤어지면 돼', artist: '로이킴', album: '그때 헤어지면 돼', emoji: '🌧️',
      image: 'images/15.jpg', audio: 'audio/15.mp3', introStart: 0, highlightStart: 60, answers: [] }
  ]
};

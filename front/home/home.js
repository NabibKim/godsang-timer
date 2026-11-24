/* =====================================================================
   홈(타이머) 화면 스크립트  (URL: /home/)
   ---------------------------------------------------------------------
   화면 구성
     1. 오늘 요약 : 총 공부시간 / 순공시간 / 쉬는시간 / 순공 비율 + 비율 막대
     2. 메인 타이머 : 현재 상태(공부 중·쉬는 중·대기)와 경과 시간
     3. 과목 목록 : 추가·수정·삭제, 과목별 ▶시작 / ■정지
     4. 오늘 타이머 기록 표
     5. 세션 공유 확인 패널 (시연용)

   시간 계산 방식
     - 서버에는 "시작·종료 시각"만 저장되어 있다.
     - 화면은 1초마다 (현재 시각 - 시작 시각)을 다시 계산해서 보여 줄 뿐,
       1초마다 서버에 요청하지 않는다.
     - PC 시계가 서버와 달라도 정확하도록, 서버가 알려 준 serverNow 와 PC 시계의
       차이(clockOffsetMs)를 보정해서 계산한다.

   사용 API : gt-timer (/api/timer/...) → timer_pool(3개 컨테이너)로 분산 처리
   ===================================================================== */

/** 화면 상태 (서버에서 받아 온 값) */
const state = {
  subjects: [],     // [{id, name, color, todaySeconds}]
  summary: null,    // {studySeconds, restSeconds, totalSeconds, studyRatio}
  record: null,     // 진행 중인 기록 {type, subjectId, subjectName, startAt} 또는 null
  records: [],      // 오늘 기록 목록
  fetchedAt: 0,     // 위 값들을 받아 온 PC 시각(ms)
  clockOffsetMs: 0, // 서버 시각 - PC 시각
};

$(function () {
  GT.initLayout('home').done(function (user) {
    bindTimerEvents();
    bindSubjectEvents();
    loadAll();

    // 1초마다 화면의 시간 값만 다시 계산 (서버 요청 없음)
    setInterval(tick, 1000);

    // 세션 공유 확인 패널
    $('#auth-user').text(user.name + ' (' + user.loginId + ')');
    requestTimerWhoami();
    requestCommunityWhoami();
    $('#btn-whoami').on('click', requestTimerWhoami);
    $('#btn-whoami-6').on('click', function () { requestTimerRepeatedly(6); });
  });
});

/* =====================================================================
   데이터 불러오기
   ===================================================================== */

/**
 * 과목 목록과 오늘 기록을 동시에 불러와서 화면 전체를 다시 그린다.
 * (두 요청이 서로 다른 timer 컨테이너에서 처리될 수 있지만, 세션 공유 덕분에 결과는 같다)
 */
function loadAll() {
  return $.when(
    GT.api('GET', '/api/timer/subjects'),
    GT.api('GET', '/api/timer/today')
  ).done(function (subjectRes, todayRes) {
    // $.when 의 결과는 [응답 데이터, 상태, xhr] 배열
    const subjects = subjectRes[0];
    const today = todayRes[0];

    state.subjects = subjects.subjects;
    state.summary = today.summary;
    state.record = today.record;
    state.records = today.records;
    state.fetchedAt = Date.now();
    state.clockOffsetMs = parseServerTime(today.serverNow) - Date.now();

    $('#today-date').text(today.date);
    renderSubjects();
    renderRecords();
    renderTimerCard();
    tick();
  }).fail(function (xhr) {
    showTimerMessage(GT.errorMessage(xhr), 'error');
  });
}

/** 서버가 보낸 시각 문자열('2026-11-23T01:42:06')을 ms 로 바꾼다. */
function parseServerTime(text) {
  return new Date(text).getTime();
}

/** 데이터를 받아 온 뒤 흐른 시간(초) */
function secondsSinceFetch() {
  return (Date.now() - state.fetchedAt) / 1000;
}

/** 진행 중인 기록의 경과 시간(초) */
function currentElapsedSeconds() {
  if (!state.record) return 0;
  const serverNowMs = Date.now() + state.clockOffsetMs;
  return (serverNowMs - parseServerTime(state.record.startAt)) / 1000;
}

/* =====================================================================
   1초마다 실행 : 시간 표시 갱신
   ===================================================================== */
function tick() {
  if (!state.summary) return;

  const extra = secondsSinceFetch();
  const isStudy = state.record && state.record.type === 'STUDY';
  const isRest = state.record && state.record.type === 'REST';

  // 1) 오늘 요약 : 서버가 계산한 값 + 받아 온 뒤 흐른 시간
  const study = state.summary.studySeconds + (isStudy ? extra : 0);
  const rest = state.summary.restSeconds + (isRest ? extra : 0);
  renderSummary(study, rest);

  // 2) 메인 타이머
  $('#timer-clock').text(GT.formatClock(currentElapsedSeconds()));

  // 3) 공부 중인 과목의 오늘 누적 시간
  state.subjects.forEach(function (subject) {
    const running = isStudy && state.record.subjectId === subject.id;
    const seconds = subject.todaySeconds + (running ? extra : 0);
    $('.subject-time[data-id="' + subject.id + '"]').text(GT.formatClock(seconds));
  });

  // 4) 기록 표의 "진행 중" 행 소요 시간
  $('#record-body .live-duration').text(GT.formatDuration(currentElapsedSeconds()));
}

/* =====================================================================
   화면 그리기
   ===================================================================== */

/** 오늘 요약 카드와 비율 막대 */
function renderSummary(study, rest) {
  const total = study + rest;
  const studyRatio = total > 0 ? (study / total) * 100 : 0;
  const restRatio = total > 0 ? 100 - studyRatio : 0;

  $('#sum-total').text(GT.formatClock(total));
  $('#sum-study').text(GT.formatClock(study));
  $('#sum-rest').text(GT.formatClock(rest));
  $('#sum-ratio').text(studyRatio.toFixed(1) + '%');

  $('#ratio-study').css('width', studyRatio + '%');
  $('#ratio-rest').css('width', restRatio + '%');
  $('#legend-study').text(studyRatio.toFixed(1) + '%');
  $('#legend-rest').text(restRatio.toFixed(1) + '%');
}

/** 메인 타이머 카드 : 상태 문구, 색상, 버튼 활성화 */
function renderTimerCard() {
  const record = state.record;
  const $card = $('#timer-card').removeClass('is-study is-rest');

  if (record && record.type === 'STUDY') {
    $card.addClass('is-study');
    $('#timer-status').text('공부 중');
    $('#timer-subject').text(record.subjectName || '');
  } else if (record && record.type === 'REST') {
    $card.addClass('is-rest');
    $('#timer-status').text('쉬는 중');
    $('#timer-subject').text('과목의 ▶ 버튼을 누르면 다시 공부가 시작됩니다');
  } else {
    $('#timer-status').text('대기 중');
    $('#timer-subject').text('과목의 ▶ 버튼을 눌러 공부를 시작하세요');
  }

  $('#btn-stop').prop('disabled', !(record && record.type === 'STUDY'));
  $('#btn-finish').prop('disabled', !record);
}

/** 과목 목록 */
function renderSubjects() {
  const $list = $('#subject-list').empty();
  $('#subject-empty').toggleClass('hidden', state.subjects.length > 0);

  state.subjects.forEach(function (subject) {
    const running = state.record && state.record.type === 'STUDY' && state.record.subjectId === subject.id;

    const $item = $('<li class="subject-item">').attr('data-id', subject.id).toggleClass('running', running);
    $('<i class="dot">').css('background', subject.color).appendTo($item);
    $('<span class="subject-name">').text(subject.name).appendTo($item);
    $('<span class="subject-time">').attr('data-id', subject.id).text(GT.formatClock(subject.todaySeconds)).appendTo($item);

    const $actions = $('<span class="subject-actions">').appendTo($item);
    if (running) {
      $('<button type="button" class="btn btn-sm btn-stop-subject">■ 정지</button>').appendTo($actions);
    } else {
      $('<button type="button" class="btn btn-sm btn-primary btn-start">▶ 시작</button>').appendTo($actions);
    }
    $('<button type="button" class="btn btn-sm btn-edit">수정</button>').appendTo($actions);
    $('<button type="button" class="btn btn-sm btn-danger btn-delete">삭제</button>').appendTo($actions);

    $list.append($item);
  });
}

/** 오늘 타이머 기록 표 */
function renderRecords() {
  const $body = $('#record-body').empty();
  $('#record-empty').toggleClass('hidden', state.records.length > 0);

  state.records.forEach(function (record) {
    const isStudy = record.type === 'STUDY';
    const $tr = $('<tr>');

    $('<td>').append($('<span class="badge">').toggleClass('rest', !isStudy).text(isStudy ? '공부' : '휴식')).appendTo($tr);

    const $subject = $('<td>');
    if (isStudy) {
      $('<i class="dot">').css('background', record.subjectColor || '#9ca3af').appendTo($subject);
      $subject.append(document.createTextNode(record.subjectDeleted ? '(삭제된 과목) ' + record.subjectName : record.subjectName));
    } else {
      $subject.text('-');
    }
    $tr.append($subject);

    $('<td>').text(record.startAt.substring(11, 19)).appendTo($tr);
    $('<td>').text(record.endAt ? record.endAt.substring(11, 19) : '진행 중').appendTo($tr);

    const $duration = $('<td>').text(GT.formatDuration(record.seconds));
    if (!record.endAt) $duration.addClass('live-duration');
    $tr.append($duration);

    $body.append($tr);
  });
}

function showTimerMessage(text, type) {
  $('#timer-msg').text(text).removeClass('ok error').addClass(type || '');
}

/* =====================================================================
   타이머 동작 (시작 / 정지 / 오늘 종료)
   ===================================================================== */
function bindTimerEvents() {
  // 과목의 ▶ 시작 (목록이 다시 그려져도 동작하도록 이벤트 위임 사용)
  $('#subject-list').on('click', '.btn-start', function () {
    const subjectId = Number($(this).closest('.subject-item').data('id'));
    timerAction('/api/timer/start', { subjectId: subjectId });
  });

  // 과목의 ■ 정지 / 메인 타이머의 ■ 정지 → 휴식 자동 시작
  $('#subject-list').on('click', '.btn-stop-subject', function () {
    timerAction('/api/timer/stop');
  });
  $('#btn-stop').on('click', function () {
    timerAction('/api/timer/stop');
  });

  // 오늘 공부 종료 → 진행 중인 공부·휴식을 모두 닫음
  $('#btn-finish').on('click', function () {
    if (confirm('오늘 공부를 종료할까요? 진행 중인 공부·휴식 시간 측정이 멈춥니다.')) {
      timerAction('/api/timer/finish');
    }
  });
}

/**
 * 타이머 API 를 호출하고 화면을 새로 고친다.
 *
 * @param {string} url
 * @param {object} [body]
 */
function timerAction(url, body) {
  GT.api('POST', url, body || {})
    .done(function (res) {
      showTimerMessage(res.message, 'ok');
      loadAll();
    })
    .fail(function (xhr) {
      showTimerMessage(GT.errorMessage(xhr), 'error');
    });
}

/* =====================================================================
   과목 추가 / 수정 / 삭제
   ===================================================================== */
function bindSubjectEvents() {
  // 추가 폼 열기·닫기
  $('#btn-show-add').on('click', function () {
    $('#subject-add-form').removeClass('hidden');
    $('#add-name').val('').focus();
  });
  $('#btn-cancel-add').on('click', function () {
    $('#subject-add-form').addClass('hidden');
  });

  // 과목 추가
  $('#subject-add-form').on('submit', function (event) {
    event.preventDefault();
    const body = { name: $('#add-name').val().trim(), color: $('#add-color').val() };
    if (!body.name) return showTimerMessage('과목 이름을 입력해 주세요.', 'error');

    GT.api('POST', '/api/timer/subjects', body)
      .done(function (res) {
        $('#subject-add-form').addClass('hidden');
        showTimerMessage(res.message, 'ok');
        loadAll();
      })
      .fail(function (xhr) { showTimerMessage(GT.errorMessage(xhr), 'error'); });
  });

  // 수정 : 해당 줄을 입력 폼으로 바꾼다.
  $('#subject-list').on('click', '.btn-edit', function () {
    const $item = $(this).closest('.subject-item');
    const subject = findSubject(Number($item.data('id')));
    if (!subject) return;

    const $form = $('<form class="subject-form subject-edit-form">').attr('data-id', subject.id);
    $('<input type="color" class="color-input edit-color">').val(subject.color).appendTo($form);
    $('<input type="text" class="input edit-name" maxlength="30">').val(subject.name).appendTo($form);
    $('<button type="submit" class="btn btn-sm btn-primary">저장</button>').appendTo($form);
    $('<button type="button" class="btn btn-sm btn-cancel-edit">취소</button>').appendTo($form);
    $item.empty().append($form);
    $form.find('.edit-name').focus();
  });

  $('#subject-list').on('click', '.btn-cancel-edit', renderSubjects);

  $('#subject-list').on('submit', '.subject-edit-form', function (event) {
    event.preventDefault();
    const $form = $(this);
    const body = { name: $form.find('.edit-name').val().trim(), color: $form.find('.edit-color').val() };

    GT.api('PUT', '/api/timer/subjects/' + $form.data('id'), body)
      .done(function (res) {
        showTimerMessage(res.message, 'ok');
        loadAll();
      })
      .fail(function (xhr) { showTimerMessage(GT.errorMessage(xhr), 'error'); });
  });

  // 삭제 (과거 기록은 서버에서 보존)
  $('#subject-list').on('click', '.btn-delete', function () {
    const subject = findSubject(Number($(this).closest('.subject-item').data('id')));
    if (!subject) return;
    if (!confirm('"' + subject.name + '" 과목을 삭제할까요?\n지금까지의 공부 기록은 통계에 그대로 남습니다.')) return;

    GT.api('DELETE', '/api/timer/subjects/' + subject.id)
      .done(function (res) {
        showTimerMessage(res.message, 'ok');
        loadAll();
      })
      .fail(function (xhr) { showTimerMessage(GT.errorMessage(xhr), 'error'); });
  });
}

function findSubject(id) {
  return state.subjects.find(function (subject) { return subject.id === id; });
}

/* =====================================================================
   세션 공유 / 로드밸런싱 확인 패널 (시연용)
   ===================================================================== */

/** timer 서버에 "나 누구야?"를 물어본다. server 값 = 처리한 컨테이너 ID */
function requestTimerWhoami() {
  return GT.api('GET', '/api/timer/whoami')
    .done(function (res) {
      $('#timer-user').text(res.user.name + ' (' + res.user.loginId + ')');
      $('#timer-server').text(res.server);
      $('<span class="badge">').text(res.server).appendTo('#server-log');
    })
    .fail(function (xhr) {
      $('#timer-user').text('실패: ' + GT.errorMessage(xhr));
    });
}

/** community 서버가 같은 세션을 읽는지 확인한다. */
function requestCommunityWhoami() {
  GT.api('GET', '/api/community/whoami')
    .done(function (res) {
      $('#community-user').text(res.user.name + ' (' + res.user.loginId + ')');
    })
    .fail(function (xhr) {
      $('#community-user').text('실패: ' + GT.errorMessage(xhr));
    });
}

/** timer 서버에 n 번 순서대로 요청 → 라운드로빈으로 컨테이너 ID 가 번갈아 기록된다. */
function requestTimerRepeatedly(count) {
  $('#server-log').empty();
  let chain = $.Deferred().resolve();
  for (let i = 0; i < count; i++) {
    chain = chain.then(requestTimerWhoami);
  }
}

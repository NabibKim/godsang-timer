/* =====================================================================
   통계 화면 스크립트  (URL: /stats/)
   ---------------------------------------------------------------------
   - 기간 버튼 : 최근 7일(기본) / 이번 주(월~일) / 지난 주
   - 요약 카드, 일별 누적 막대(순공+휴식), 순공:휴식 도넛, 과목별 가로 막대, 일별 표
   - 사용 API : GET /api/timer/stats?from=YYYY-MM-DD&to=YYYY-MM-DD  (gt-timer)
   - 차트 : Chart.js (CDN)
   ===================================================================== */

/** 차트 색상 : 순공 = 남색, 휴식 = 주황 (홈 화면과 동일한 의미의 색) */
const COLORS = {
  study: '#4f46e5',
  rest: '#f59e0b',
  grid: '#eef0f3',
  text: '#6b7280',
};

/** 만들어 둔 차트 객체 (기간을 바꾸면 지우고 다시 그림) */
const charts = {};

$(function () {
  GT.initLayout('stats').done(function () {
    applyChartDefaults();

    $('.range-buttons .btn').on('click', function () {
      $('.range-buttons .btn').removeClass('active');
      $(this).addClass('active');
      loadStats($(this).data('range'));
    });

    loadStats('recent7');
  });
});

/** Chart.js 공통 설정 : 글꼴·색상·툴팁 */
function applyChartDefaults() {
  Chart.defaults.font.family = '"Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';
  Chart.defaults.color = COLORS.text;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.tooltip.padding = 10;
}

/* =====================================================================
   기간 계산
   ===================================================================== */

/** Date → 'YYYY-MM-DD' (PC 의 현지 날짜 기준) */
function toDateString(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

/**
 * 기간 버튼 값을 시작·끝 날짜로 바꾼다.
 *
 * @param {'recent7'|'thisWeek'|'lastWeek'} range
 * @returns {{from: string, to: string}}
 */
function getRange(range) {
  const today = new Date();
  const mondayOffset = (today.getDay() + 6) % 7;   // 월요일=0 ... 일요일=6
  const monday = new Date(today);
  monday.setDate(today.getDate() - mondayOffset);

  if (range === 'thisWeek') {
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { from: toDateString(monday), to: toDateString(sunday) };
  }
  if (range === 'lastWeek') {
    const lastMonday = new Date(monday);
    lastMonday.setDate(monday.getDate() - 7);
    const lastSunday = new Date(monday);
    lastSunday.setDate(monday.getDate() - 1);
    return { from: toDateString(lastMonday), to: toDateString(lastSunday) };
  }
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 6);
  return { from: toDateString(weekAgo), to: toDateString(today) };
}

/* =====================================================================
   데이터 불러오기 / 그리기
   ===================================================================== */
function loadStats(range) {
  const period = getRange(range);
  $('#range-label').text(period.from + ' ~ ' + period.to);

  GT.api('GET', '/api/timer/stats?from=' + period.from + '&to=' + period.to)
    .done(function (data) {
      $('#stats-msg').text('');
      renderSummary(data.total);
      renderDailyChart(data.days);
      renderRatioChart(data.total);
      renderSubjectChart(data.subjects);
      renderDailyTable(data.days);
    })
    .fail(function (xhr) {
      $('#stats-msg').text(GT.errorMessage(xhr)).addClass('error');
    });
}

/** 초 → 시간(소수점 1자리). 차트 축 단위로 사용 */
function toHours(seconds) {
  return Math.round((seconds / 3600) * 10) / 10;
}

/** 'YYYY-MM-DD' → '11/23(월)' */
function formatDayLabel(dateText) {
  const date = new Date(dateText + 'T00:00:00');
  const week = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
  return (date.getMonth() + 1) + '/' + date.getDate() + '(' + week + ')';
}

/** 툴팁에 "1시간 25분" 형식으로 표시 (막대 값은 시간 단위라 초로 되돌림) */
function tooltipDuration(context) {
  // 가로 막대(indexAxis 'y')는 값이 x 축, 세로 막대는 y 축에 있다.
  const hours = context.chart.options.indexAxis === 'y' ? context.parsed.x : context.parsed.y;
  return ' ' + context.dataset.label + ': ' + GT.formatDuration(hours * 3600);
}

/** 기존 차트를 지우고 새로 만든다. (같은 canvas 에 두 번 그리면 오류) */
function drawChart(key, canvasId, config) {
  if (charts[key]) charts[key].destroy();
  charts[key] = new Chart(document.getElementById(canvasId), config);
}

function renderSummary(total) {
  $('#st-total').text(GT.formatDuration(total.totalSeconds));
  $('#st-study').text(GT.formatDuration(total.studySeconds));
  $('#st-rest').text(GT.formatDuration(total.restSeconds));
  $('#st-ratio').text(total.studyRatio + '%');
  $('#st-avg').text(GT.formatDuration(total.dailyAverageStudySeconds));
}

/** 차트 1 : 일별 누적 막대 (아래 순공, 위 휴식) */
function renderDailyChart(days) {
  const barStyle = {
    borderRadius: 4,
    borderSkipped: false,
    borderColor: '#ffffff',   // 쌓인 두 구간 사이 2px 흰 간격
    borderWidth: 1,
    maxBarThickness: 36,
  };

  drawChart('daily', 'chart-daily', {
    type: 'bar',
    data: {
      labels: days.map((d) => formatDayLabel(d.date)),
      datasets: [
        Object.assign({ label: '순공시간', data: days.map((d) => toHours(d.studySeconds)), backgroundColor: COLORS.study }, barStyle),
        Object.assign({ label: '쉬는시간', data: days.map((d) => toHours(d.restSeconds)), backgroundColor: COLORS.rest }, barStyle),
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },   // 막대 근처에만 가도 그날 값 전체 표시
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, grid: { color: COLORS.grid }, title: { display: true, text: '시간' } },
      },
      plugins: { tooltip: { callbacks: { label: tooltipDuration } } },
    },
  });
}

/** 차트 2 : 기간 전체 순공 : 휴식 도넛 */
function renderRatioChart(total) {
  const empty = total.totalSeconds === 0;

  drawChart('ratio', 'chart-ratio', {
    type: 'doughnut',
    data: {
      labels: ['순공시간', '쉬는시간'],
      datasets: [{
        label: '비율',
        data: empty ? [1, 0] : [total.studySeconds, total.restSeconds],
        backgroundColor: empty ? ['#e5e7eb', '#e5e7eb'] : [COLORS.study, COLORS.rest],
        borderColor: '#ffffff',
        borderWidth: 2,
      }],
    },
    options: {
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          enabled: !empty,
          callbacks: {
            label: function (context) {
              const percent = total.totalSeconds ? (context.parsed / total.totalSeconds * 100).toFixed(1) : 0;
              return ' ' + context.label + ': ' + GT.formatDuration(context.parsed) + ' (' + percent + '%)';
            },
          },
        },
      },
    },
  });
}

/** 차트 3 : 과목별 순공시간 가로 막대 (막대 색 = 과목 색, 과목 이름은 축에 표시) */
function renderSubjectChart(subjects) {
  $('#subject-empty').toggleClass('hidden', subjects.length > 0);
  $('#chart-subject').closest('.chart-box').toggleClass('hidden', subjects.length === 0);

  drawChart('subject', 'chart-subject', {
    type: 'bar',
    data: {
      labels: subjects.map((s) => s.name),
      datasets: [{
        label: '순공시간',
        data: subjects.map((s) => toHours(s.seconds)),
        backgroundColor: subjects.map((s) => s.color),
        borderRadius: 4,
        borderSkipped: false,
        maxBarThickness: 28,
      }],
    },
    options: {
      indexAxis: 'y',
      maintainAspectRatio: false,
      scales: {
        x: { beginAtZero: true, grid: { color: COLORS.grid }, title: { display: true, text: '시간' } },
        y: { grid: { display: false } },
      },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: tooltipDuration } } },
    },
  });
}

/** 일별 표 (차트를 읽기 어려운 경우를 위한 표 보기) */
function renderDailyTable(days) {
  const $body = $('#daily-body').empty();
  days.slice().reverse().forEach(function (d) {
    $('<tr>')
      .append($('<td>').text(formatDayLabel(d.date)))
      .append($('<td>').text(GT.formatDuration(d.totalSeconds)))
      .append($('<td>').text(GT.formatDuration(d.studySeconds)))
      .append($('<td>').text(GT.formatDuration(d.restSeconds)))
      .append($('<td>').text(d.totalSeconds ? d.studyRatio + '%' : '-'))
      .appendTo($body);
  });
}

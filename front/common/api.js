/* =====================================================================
   공통 API 호출 모듈 (모든 페이지에서 가장 먼저 불러온다)
   ---------------------------------------------------------------------
   - 모든 요청은 같은 주소(godsang.com)의 /api/... 로 보낸다.
     → gt-proxy 가 경로를 보고 auth / timer / community 서버로 나눠 전달
     → 같은 주소라서 세션 쿠키(GT_SID)가 브라우저에 의해 자동으로 함께 전송됨
   - 전역 객체 GT 하나에 공통 함수를 모아 다른 스크립트와 이름 충돌을 막는다.
   ===================================================================== */

window.GT = window.GT || {};

/** 로그인 없이 볼 수 있는 페이지(로그인 화면)는 true 로 바꾼다. */
GT.isPublicPage = false;

/**
 * 서버 API 를 호출한다.
 *
 * @param {string} method  'GET' | 'POST' | 'PUT' | 'DELETE'
 * @param {string} url     예) '/api/timer/subjects'
 * @param {object} [body]  요청 본문 (JSON 으로 변환해서 전송)
 * @returns {jqXHR}        .done(성공 응답) / .fail(xhr) 로 결과 처리
 */
GT.api = function (method, url, body) {
  const options = { url: url, method: method, dataType: 'json' };

  if (body !== undefined) {
    options.contentType = 'application/json; charset=utf-8';
    options.data = JSON.stringify(body);
  }

  return $.ajax(options).fail(function (xhr) {
    // 세션이 만료되었거나 로그아웃된 상태 → 로그인 화면으로 이동
    if (xhr.status === 401 && !GT.isPublicPage) {
      location.replace('/');
    }
  });
};

/**
 * 실패 응답에서 사용자에게 보여 줄 메시지를 꺼낸다.
 * 서버는 실패 시 항상 {"message": "..."} 형식으로 응답한다.
 */
GT.errorMessage = function (xhr) {
  return (xhr.responseJSON && xhr.responseJSON.message) || '요청 처리 중 오류가 발생했습니다.';
};

/**
 * 초 단위 시간을 "HH:MM:SS" 문자열로 바꾼다.
 * 예) 3725 → "01:02:05"
 */
GT.formatClock = function (totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const pad = (n) => String(n).padStart(2, '0');
  return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor((s % 3600) / 60)) + ':' + pad(s % 60);
};

/**
 * 초 단위 시간을 "1시간 2분" 처럼 읽기 쉬운 문자열로 바꾼다.
 */
GT.formatDuration = function (totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return h + '시간 ' + m + '분';
  if (m > 0) return m + '분';
  return s + '초';
};

/**
 * DB 날짜('2026-11-23 14:05:09')를 목록용 짧은 형식으로 바꾼다.
 * 오늘 작성 → '14:05', 그 외 → '11.21'
 */
GT.formatShortDate = function (dateTime) {
  if (!dateTime) return '';
  const datePart = dateTime.substring(0, 10);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  return datePart === today ? dateTime.substring(11, 16) : datePart.substring(5).replace('-', '.');
};

/** DB 날짜를 '2026.11.23 14:05' 형식으로 바꾼다. (상세 화면용) */
GT.formatFullDate = function (dateTime) {
  if (!dateTime) return '';
  return dateTime.substring(0, 10).replace(/-/g, '.') + ' ' + dateTime.substring(11, 16);
};

/** 주소창의 쿼리 값을 읽는다. 예) /community/post.html?id=3 → GT.getQueryParam('id') === '3' */
GT.getQueryParam = function (name) {
  return new URLSearchParams(location.search).get(name);
};

/* ---------------------------------------------------------------------
   로드밸런싱 시연용 : 응답 헤더의 X-Served-By(처리한 timer 컨테이너 이름)를
   모든 AJAX 요청이 끝날 때마다 화면 하단에 표시한다.
   --------------------------------------------------------------------- */
$(document).ajaxComplete(function (_event, xhr) {
  const server = xhr.getResponseHeader('X-Served-By');
  if (server) {
    $('#gt-server').text(server);
  }
});

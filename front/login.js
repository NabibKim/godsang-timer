/* =====================================================================
   로그인 / 회원가입 화면 스크립트  (URL: /)
   ---------------------------------------------------------------------
   - 이미 로그인된 사용자는 바로 /home/ 으로 이동
   - 회원가입은 아이디·이름 [중복확인]을 통과해야 [가입하기] 버튼이 활성화됨
   - 중복확인 후 값을 고치면 확인 상태가 초기화되어 다시 확인해야 함
   - 사용 API : gt-auth (/api/auth/...)
   ===================================================================== */

// 로그인 화면은 로그인하지 않아도 볼 수 있으므로 401 응답 시 자동 이동하지 않는다.
GT.isPublicPage = true;

/** 입력값 규칙 (서버 auth_controller.php 의 규칙과 동일) */
const RULES = {
  loginId: /^[a-z0-9]{4,20}$/,
  password: /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/,
  name: /^\S{2,10}$/,
};

/**
 * 중복확인을 "통과한 값"을 기억한다.
 * 현재 입력값과 이 값이 같아야만 확인된 것으로 본다.
 */
const verified = { loginId: null, name: null };

$(function () {
  // 1) 이미 로그인 상태면 홈으로 이동
  GT.api('GET', '/api/auth/me').done(function () {
    location.replace('/home/');
  });

  // 2) 탭 전환
  $('.tabs button').on('click', function () {
    switchTab($(this).data('tab'));
  });

  // 3) 로그인
  $('#login-form').on('submit', function (event) {
    event.preventDefault();
    login();
  });

  // 4) 중복확인 버튼
  $('#btn-check-id').on('click', function () { checkDuplicate('loginId'); });
  $('#btn-check-name').on('click', function () { checkDuplicate('name'); });

  // 5) 값이 바뀌면 중복확인 상태 초기화 + 가입 버튼 상태 갱신
  $('#signup-id').on('input', function () { resetVerified('loginId'); });
  $('#signup-name').on('input', function () { resetVerified('name'); });
  $('#signup-pw, #signup-pw2').on('input', updatePasswordHint);
  $('#signup-form input').on('input', updateSignupButton);

  // 6) 회원가입
  $('#signup-form').on('submit', function (event) {
    event.preventDefault();
    signup();
  });
});

/** 로그인 / 회원가입 탭을 전환한다. */
function switchTab(tab) {
  $('.tabs button').removeClass('active');
  $('.tabs button[data-tab="' + tab + '"]').addClass('active');
  $('#login-form').toggleClass('hidden', tab !== 'login');
  $('#signup-form').toggleClass('hidden', tab !== 'signup');
}

/** 메시지 영역에 결과를 표시한다. type: 'ok' | 'error' | '' */
function showMessage(selector, text, type) {
  $(selector).text(text).removeClass('ok error').addClass(type || '');
}

/** POST /api/auth/login → 성공하면 서버가 GT_SID 쿠키를 발급하고 홈으로 이동 */
function login() {
  const body = {
    loginId: $('#login-id').val().trim(),
    password: $('#login-pw').val(),
  };

  if (!body.loginId || !body.password) {
    showMessage('#login-msg', '아이디와 비밀번호를 입력해 주세요.', 'error');
    return;
  }

  GT.api('POST', '/api/auth/login', body)
    .done(function () {
      location.href = '/home/';
    })
    .fail(function (xhr) {
      showMessage('#login-msg', GT.errorMessage(xhr), 'error');
    });
}

/**
 * 아이디 또는 이름 중복확인
 *
 * @param {'loginId'|'name'} field 확인할 항목
 */
function checkDuplicate(field) {
  const isId = field === 'loginId';
  const $input = isId ? $('#signup-id') : $('#signup-name');
  const hint = isId ? '#hint-id' : '#hint-name';
  const value = $input.val().trim();

  // 1) 형식 검사를 먼저 해서 불필요한 서버 요청을 줄인다.
  if (!RULES[field].test(value)) {
    showMessage(hint, isId ? '영문 소문자와 숫자로 4~20자를 입력해 주세요.' : '공백 없이 2~10자를 입력해 주세요.', 'error');
    return;
  }

  // 2) 서버에 사용 가능 여부 질의
  const url = isId
    ? '/api/auth/check-id?loginId=' + encodeURIComponent(value)
    : '/api/auth/check-name?name=' + encodeURIComponent(value);

  GT.api('GET', url)
    .done(function (res) {
      verified[field] = res.available ? value : null;
      showMessage(hint, res.message, res.available ? 'ok' : 'error');
      updateSignupButton();
    })
    .fail(function (xhr) {
      verified[field] = null;
      showMessage(hint, GT.errorMessage(xhr), 'error');
      updateSignupButton();
    });
}

/** 입력값이 바뀌면 이전 중복확인 결과를 무효로 만든다. */
function resetVerified(field) {
  if (verified[field] !== null) {
    verified[field] = null;
    showMessage(field === 'loginId' ? '#hint-id' : '#hint-name', '값이 바뀌었습니다. 다시 중복확인을 해 주세요.', '');
  }
}

/** 비밀번호 규칙 / 일치 여부 안내 */
function updatePasswordHint() {
  const pw = $('#signup-pw').val();
  const pw2 = $('#signup-pw2').val();

  if (!pw) return showMessage('#hint-pw', '', '');
  if (!RULES.password.test(pw)) return showMessage('#hint-pw', '영문과 숫자를 포함해 8자 이상 입력해 주세요.', 'error');
  if (pw2 && pw !== pw2) return showMessage('#hint-pw', '비밀번호가 일치하지 않습니다.', 'error');
  if (pw2) return showMessage('#hint-pw', '비밀번호가 일치합니다.', 'ok');
  showMessage('#hint-pw', '', '');
}

/** 모든 조건을 만족할 때만 [가입하기] 버튼을 활성화한다. */
function updateSignupButton() {
  const loginId = $('#signup-id').val().trim();
  const name = $('#signup-name').val().trim();
  const pw = $('#signup-pw').val();
  const pw2 = $('#signup-pw2').val();

  const ready =
    verified.loginId === loginId &&
    verified.name === name &&
    RULES.password.test(pw) &&
    pw === pw2;

  $('#btn-signup').prop('disabled', !ready);
}

/** POST /api/auth/signup → 성공하면 로그인 탭으로 이동하고 아이디를 미리 채워 준다. */
function signup() {
  const body = {
    loginId: $('#signup-id').val().trim(),
    password: $('#signup-pw').val(),
    name: $('#signup-name').val().trim(),
  };

  GT.api('POST', '/api/auth/signup', body)
    .done(function (res) {
      $('#signup-form')[0].reset();
      verified.loginId = verified.name = null;
      $('#hint-id, #hint-name, #hint-pw').text('');
      updateSignupButton();

      switchTab('login');
      $('#login-id').val(body.loginId);
      $('#login-pw').val('').focus();
      showMessage('#login-msg', res.message, 'ok');
    })
    .fail(function (xhr) {
      showMessage('#signup-msg', GT.errorMessage(xhr), 'error');
    });
}

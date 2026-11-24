/* =====================================================================
   마이페이지 스크립트  (URL: /mypage/)
   ---------------------------------------------------------------------
   0. 비밀번호 재확인 : 확인 후 10분 동안은 다시 묻지 않음 (서버 세션에 기록)
   1. 개인정보 수정 : 아이디·이름 (바꾼 항목은 중복확인 필수)
   2. 비밀번호 변경
   3. 내 활동 : 내가 쓴 글 / 내가 쓴 댓글 (gt-community)

   사용 API
     gt-auth      : /api/auth/verify-password, /profile, /password, /check-id, /check-name
     gt-community : /api/community/my/posts, /my/comments
   ===================================================================== */

/** 입력값 규칙 (회원가입·서버와 동일) */
const RULES = {
  loginId: /^[a-z0-9]{4,20}$/,
  password: /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/,
  name: /^\S{2,10}$/,
};

/** 현재 저장된 내 정보 (바뀌지 않은 항목은 중복확인 불필요) */
const original = { loginId: '', name: '', createdAt: '' };

/** 중복확인을 통과한 값 */
const verified = { loginId: null, name: null };

$(function () {
  GT.initLayout('mypage').done(function () {
    bindVerifyEvents();
    bindProfileEvents();
    bindPasswordEvents();
    bindActivityEvents();

    // 10분 안에 이미 비밀번호를 확인했다면 바로 열리고, 아니면 403 → 비밀번호 확인 화면
    openMypage();
  });
});

/* =====================================================================
   0. 비밀번호 재확인
   ===================================================================== */

/** 개인정보를 불러와 마이페이지를 연다. 재확인이 필요하면 확인 화면을 보여 준다. */
function openMypage() {
  GT.api('GET', '/api/auth/profile')
    .done(function (profile) {
      $('#verify-section').addClass('hidden');
      $('#mypage-section').removeClass('hidden');
      fillProfile(profile);
      loadActivity();
    })
    .fail(function (xhr) {
      if (xhr.status === 403) showVerify('');
    });
}

function showVerify(message) {
  $('#mypage-section').addClass('hidden');
  $('#verify-section').removeClass('hidden');
  $('#verify-msg').text(message).addClass('error');
  $('#verify-pw').val('').focus();
}

function bindVerifyEvents() {
  $('#verify-form').on('submit', function (event) {
    event.preventDefault();
    GT.api('POST', '/api/auth/verify-password', { password: $('#verify-pw').val() })
      .done(openMypage)
      .fail(function (xhr) {
        $('#verify-msg').text(GT.errorMessage(xhr)).addClass('error');
      });
  });
}

/** 마이페이지 API 가 403(확인 시간 10분 초과)을 주면 다시 비밀번호를 묻는다. */
function handleMypageError(xhr, messageSelector) {
  if (xhr.status === 403) {
    showVerify('확인 시간이 지났습니다. 비밀번호를 다시 입력해 주세요.');
  } else {
    showMessage(messageSelector, GT.errorMessage(xhr), 'error');
  }
}

/* =====================================================================
   1. 개인정보 수정
   ===================================================================== */
function fillProfile(profile) {
  original.loginId = profile.loginId;
  original.name = profile.name;
  original.createdAt = profile.createdAt;
  verified.loginId = verified.name = null;

  $('#profile-id').val(profile.loginId);
  $('#profile-name').val(profile.name);
  $('#profile-created').text(GT.formatFullDate(profile.createdAt));
  $('#hint-id, #hint-name').text('');
}

/** 값이 원래 값과 같거나, 중복확인을 통과했으면 true */
function isFieldReady(field, value) {
  return value === original[field] || verified[field] === value;
}

function bindProfileEvents() {
  $('#btn-check-id').on('click', function () { checkDuplicate('loginId'); });
  $('#btn-check-name').on('click', function () { checkDuplicate('name'); });

  // 값을 바꾸면 중복확인 다시 필요
  $('#profile-id').on('input', function () { verified.loginId = null; $('#hint-id').text(''); });
  $('#profile-name').on('input', function () { verified.name = null; $('#hint-name').text(''); });

  $('#profile-form').on('submit', function (event) {
    event.preventDefault();
    const loginId = $('#profile-id').val().trim();
    const name = $('#profile-name').val().trim();

    if (loginId === original.loginId && name === original.name) {
      return showMessage('#profile-msg', '변경된 내용이 없습니다.', '');
    }
    if (!isFieldReady('loginId', loginId)) return showMessage('#profile-msg', '아이디 중복확인을 해 주세요.', 'error');
    if (!isFieldReady('name', name)) return showMessage('#profile-msg', '이름 중복확인을 해 주세요.', 'error');

    GT.api('PUT', '/api/auth/profile', { loginId: loginId, name: name })
      .done(function (res) {
        fillProfile({ loginId: res.loginId, name: res.name, createdAt: original.createdAt });
        $('#gt-username').text(res.name + '님');   // 상단바 이름 즉시 변경 (세션도 서버에서 갱신됨)
        showMessage('#profile-msg', res.message, 'ok');
      })
      .fail(function (xhr) { handleMypageError(xhr, '#profile-msg'); });
  });
}

/**
 * 아이디·이름 중복확인 (내 현재 값은 서버가 "사용 가능"으로 처리)
 *
 * @param {'loginId'|'name'} field
 */
function checkDuplicate(field) {
  const isId = field === 'loginId';
  const value = (isId ? $('#profile-id') : $('#profile-name')).val().trim();
  const hint = isId ? '#hint-id' : '#hint-name';

  if (!RULES[field].test(value)) {
    return showMessage(hint, isId ? '영문 소문자와 숫자로 4~20자를 입력해 주세요.' : '공백 없이 2~10자를 입력해 주세요.', 'error');
  }
  if (value === original[field]) {
    return showMessage(hint, '현재 사용 중인 값입니다.', 'ok');
  }

  const url = isId
    ? '/api/auth/check-id?loginId=' + encodeURIComponent(value)
    : '/api/auth/check-name?name=' + encodeURIComponent(value);

  GT.api('GET', url)
    .done(function (res) {
      verified[field] = res.available ? value : null;
      showMessage(hint, res.message, res.available ? 'ok' : 'error');
    })
    .fail(function (xhr) { showMessage(hint, GT.errorMessage(xhr), 'error'); });
}

/* =====================================================================
   2. 비밀번호 변경
   ===================================================================== */
function bindPasswordEvents() {
  $('#password-form').on('submit', function (event) {
    event.preventDefault();
    const current = $('#pw-current').val();
    const next = $('#pw-new').val();
    const confirmValue = $('#pw-new2').val();

    if (!current) return showMessage('#password-msg', '현재 비밀번호를 입력해 주세요.', 'error');
    if (!RULES.password.test(next)) return showMessage('#password-msg', '새 비밀번호는 영문과 숫자를 포함해 8자 이상이어야 합니다.', 'error');
    if (next !== confirmValue) return showMessage('#password-msg', '새 비밀번호가 일치하지 않습니다.', 'error');

    GT.api('PUT', '/api/auth/password', { currentPassword: current, newPassword: next })
      .done(function (res) {
        $('#password-form')[0].reset();
        showMessage('#password-msg', res.message, 'ok');
      })
      .fail(function (xhr) { handleMypageError(xhr, '#password-msg'); });
  });
}

/* =====================================================================
   3. 내 활동 (gt-community)
   ===================================================================== */
function bindActivityEvents() {
  $('.activity-tabs button').on('click', function () {
    const tab = $(this).data('tab');
    $('.activity-tabs button').removeClass('active');
    $(this).addClass('active');
    $('#my-posts-table').toggleClass('hidden', tab !== 'posts');
    $('#my-comments-table').toggleClass('hidden', tab !== 'comments');
  });

  // 행 클릭 → 해당 게시글로 이동
  $('#my-posts-body, #my-comments-body').on('click', 'tr[data-post]', function () {
    location.href = '/community/post.html?id=' + $(this).data('post');
  });
}

function loadActivity() {
  GT.api('GET', '/api/community/my/posts').done(function (data) {
    const $body = $('#my-posts-body').empty();
    $('#my-post-count').text(data.posts.length);
    if (data.posts.length === 0) $body.append(emptyRow(4, '작성한 글이 없습니다.'));

    data.posts.forEach(function (post) {
      $('<tr class="clickable">').attr('data-post', post.id)
        .append($('<td>').text(post.title))
        .append($('<td class="col-date">').text(GT.formatShortDate(post.createdAt)))
        .append($('<td class="col-view">').text(post.commentCount))
        .append($('<td class="col-view">').text(post.viewCount))
        .appendTo($body);
    });
  });

  GT.api('GET', '/api/community/my/comments').done(function (data) {
    const $body = $('#my-comments-body').empty();
    $('#my-comment-count').text(data.comments.length);
    if (data.comments.length === 0) $body.append(emptyRow(3, '작성한 댓글이 없습니다.'));

    data.comments.forEach(function (comment) {
      $('<tr class="clickable">').attr('data-post', comment.postId)
        .append($('<td class="ellipsis">').text(comment.content))
        .append($('<td class="ellipsis muted">').text(comment.postTitle))
        .append($('<td class="col-date">').text(GT.formatShortDate(comment.createdAt)))
        .appendTo($body);
    });
  });
}

function emptyRow(colspan, text) {
  return $('<tr>').append($('<td class="muted" style="text-align:center;padding:24px;">').attr('colspan', colspan).text(text));
}

/* ===================================================================== */
function showMessage(selector, text, type) {
  $(selector).text(text).removeClass('ok error').addClass(type || '');
}

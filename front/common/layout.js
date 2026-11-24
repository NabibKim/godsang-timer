/* =====================================================================
   공통 화면 틀 (상단바 + 하단 푸터)
   ---------------------------------------------------------------------
   로그인 후 모든 페이지(홈, 커뮤니티, 통계, 마이페이지)에서
   GT.initLayout('메뉴키') 를 호출하면
     1) 상단바와 푸터를 그리고
     2) 로그인 여부를 확인한 뒤(미로그인 → 로그인 화면으로 이동)
     3) 상단바에 사용자 이름을 표시한다.
   ===================================================================== */

/** 상단 메뉴 목록 (key 는 initLayout 에 넘기는 값) */
GT.MENUS = [
  { key: 'home',      label: '홈',       href: '/home/' },
  { key: 'community', label: '커뮤니티', href: '/community/' },
  { key: 'stats',     label: '통계',     href: '/stats/' },
];

/**
 * 공통 화면 틀을 그리고 로그인 사용자 정보를 불러온다.
 *
 * @param {string} activeMenu  강조할 메뉴 key ('home' | 'community' | 'stats' | 'mypage')
 * @returns {jqXHR}  .done(function (user) { ... }) 안에서 각 페이지 초기화 코드를 실행
 */
GT.initLayout = function (activeMenu) {
  const navHtml = GT.MENUS.map(function (menu) {
    const activeClass = menu.key === activeMenu ? 'active' : '';
    return '<a href="' + menu.href + '" class="' + activeClass + '">' + menu.label + '</a>';
  }).join('');

  // 1) 상단바 : 로고 | 메뉴 | 사용자 이름(마이페이지 링크) + 로그아웃
  $('body').prepend(
    '<header class="gt-header">' +
      '<div class="gt-header-inner">' +
        '<a class="gt-logo" href="/home/">갓생 타이머</a>' +
        '<nav class="gt-nav">' + navHtml + '</nav>' +
        '<div class="gt-user">' +
          '<a class="gt-username" id="gt-username" href="/mypage/" title="마이페이지"></a>' +
          '<button type="button" class="btn btn-sm" id="gt-logout">로그아웃</button>' +
        '</div>' +
      '</div>' +
    '</header>'
  );

  // 2) 푸터 : 오른쪽에 마지막으로 요청을 처리한 timer 컨테이너 이름 표시 (api.js 가 갱신)
  $('body').append(
    '<footer class="gt-footer">' +
      '<span>© 갓생 타이머 · Cloud Native Project</span>' +
      '<span>timer 처리 서버: <b id="gt-server">-</b></span>' +
    '</footer>'
  );

  // 3) 로그아웃 : 성공·실패와 관계없이 로그인 화면으로 이동
  $('#gt-logout').on('click', function () {
    GT.api('POST', '/api/auth/logout').always(function () {
      location.replace('/');
    });
  });

  // 4) 로그인 사용자 확인 (401 이면 api.js 가 로그인 화면으로 보냄)
  return GT.api('GET', '/api/auth/me').done(function (user) {
    GT.user = user;
    // .text() 는 HTML 태그를 글자로 출력 → 이름에 스크립트가 들어 있어도 실행되지 않음(XSS 방지)
    $('#gt-username').text(user.name + '님');
  });
};

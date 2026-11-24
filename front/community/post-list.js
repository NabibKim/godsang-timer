/* =====================================================================
   게시글 목록 공통 모듈
   ---------------------------------------------------------------------
   커뮤니티 목록 화면(/community/)과 게시글 상세 화면(post.html) 아래쪽에서
   똑같은 목록 + 페이지 번호 + 검색을 재사용한다.

   필요한 HTML id
     #post-count     전체 글 수
     #post-list-body 목록 <tbody>
     #pagination     페이지 번호
     #search-form, #search-type, #search-keyword  검색
   사용 API : GET /api/community/posts?page=&type=&keyword=  (gt-community)
   ===================================================================== */

GT.PostList = {
  /** 현재 목록 조건 */
  page: 1,
  type: 'all',
  keyword: '',
  currentId: null,   // 상세 화면에서 지금 보고 있는 글 (목록에서 강조)

  /**
   * 목록 모듈을 시작한다.
   *
   * @param {number|null} currentId 상세 화면이면 현재 글 id, 목록 화면이면 null
   */
  init: function (currentId) {
    const self = this;
    self.currentId = currentId;

    // 검색 : 조건을 바꾸고 1페이지부터 다시 조회
    $('#search-form').on('submit', function (event) {
      event.preventDefault();
      self.type = $('#search-type').val();
      self.keyword = $('#search-keyword').val().trim();
      self.load(1);
    });

    // 페이지 번호 클릭 (목록이 다시 그려져도 동작하도록 이벤트 위임)
    $('#pagination').on('click', 'button[data-page]', function () {
      self.load(Number($(this).data('page')));
    });

    // 글 클릭 → 상세 화면
    $('#post-list-body').on('click', 'tr[data-id]', function () {
      location.href = '/community/post.html?id=' + $(this).data('id');
    });

    self.load(1);
  },

  /** 지정한 페이지의 목록을 불러와 그린다. */
  load: function (page) {
    const self = this;
    const query = $.param({ page: page, type: self.type, keyword: self.keyword });

    GT.api('GET', '/api/community/posts?' + query).done(function (data) {
      self.page = data.page;
      $('#post-count').text(self.keyword ? '검색 결과 ' + data.total + '건' : '전체 ' + data.total + '건');
      self.renderRows(data.posts);
      self.renderPagination(data.page, data.totalPages);
    });
  },

  /** 목록 행 그리기 (제목·이름은 .text() 로 넣어 XSS 방지) */
  renderRows: function (posts) {
    const self = this;
    const $body = $('#post-list-body').empty();

    if (posts.length === 0) {
      $body.append('<tr><td colspan="5" class="muted" style="text-align:center;padding:28px;">게시글이 없습니다.</td></tr>');
      return;
    }

    posts.forEach(function (post) {
      const $tr = $('<tr class="clickable">').attr('data-id', post.id).toggleClass('current', post.id === self.currentId);
      $('<td class="col-num">').text(post.id).appendTo($tr);

      const $title = $('<td class="col-title">').append($('<span>').text(post.title));
      if (post.commentCount > 0) {
        $('<span class="comment-count">').text('[' + post.commentCount + ']').appendTo($title);
      }
      $tr.append($title);

      $('<td class="col-author">').text(post.authorName).appendTo($tr);
      $('<td class="col-date">').text(GT.formatShortDate(post.createdAt)).appendTo($tr);
      $('<td class="col-view">').text(post.viewCount).appendTo($tr);
      $body.append($tr);
    });
  },

  /** 페이지 번호 (현재 페이지 앞뒤 2개씩 + 이전/다음) */
  renderPagination: function (page, totalPages) {
    const $nav = $('#pagination').empty();
    const start = Math.max(1, page - 2);
    const end = Math.min(totalPages, page + 2);

    $('<button type="button" class="btn btn-sm">‹</button>').attr('data-page', page - 1).prop('disabled', page <= 1).appendTo($nav);
    for (let p = start; p <= end; p++) {
      $('<button type="button" class="btn btn-sm">').text(p).attr('data-page', p).toggleClass('active', p === page).appendTo($nav);
    }
    $('<button type="button" class="btn btn-sm">›</button>').attr('data-page', page + 1).prop('disabled', page >= totalPages).appendTo($nav);
  },
};

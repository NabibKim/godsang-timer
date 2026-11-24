/* =====================================================================
   게시글 상세 화면 스크립트  (URL: /community/post.html?id=3)
   ---------------------------------------------------------------------
   1. 게시글 본문 (본인 글이면 수정·삭제 버튼)
   2. 댓글 + 답글(1단계) 작성·삭제
   3. 아래쪽에 게시글 목록 (현재 글 강조) → 다른 글로 바로 이동
   사용 API : gt-community (/api/community/posts/..., /api/community/comments/...)
   ===================================================================== */

const postId = Number(GT.getQueryParam('id'));

$(function () {
  GT.initLayout('community').done(function () {
    if (!postId) {
      location.replace('/community/');
      return;
    }
    loadPost();
    loadComments();
    bindCommentEvents();
    GT.PostList.init(postId);

    $('#btn-delete-post').on('click', deletePost);
  });
});

/* =====================================================================
   1. 게시글 본문
   ===================================================================== */
function loadPost() {
  GT.api('GET', '/api/community/posts/' + postId)
    .done(function (post) {
      document.title = '갓생 타이머 - ' + post.title;
      $('#post-title').text(post.title);
      $('#post-author').text(post.authorName);
      $('#post-date').text(GT.formatFullDate(post.createdAt) + (post.updatedAt !== post.createdAt ? ' (수정됨)' : ''));
      $('#post-views').text(post.viewCount);
      $('#post-content').text(post.content);   // CSS white-space: pre-wrap 으로 줄바꿈 유지

      // 본인 글일 때만 수정·삭제 버튼 표시 (서버에서도 작성자 검사를 한 번 더 함)
      $('#owner-actions').toggleClass('hidden', !post.isMine);
      $('#btn-edit-post').attr('href', '/community/write.html?id=' + post.id);
    })
    .fail(function (xhr) {
      $('#post-title').text('게시글을 불러올 수 없습니다.');
      $('#post-msg').text(GT.errorMessage(xhr));
    });
}

function deletePost() {
  if (!confirm('이 게시글을 삭제할까요? 댓글도 함께 삭제됩니다.')) return;

  GT.api('DELETE', '/api/community/posts/' + postId)
    .done(function () { location.replace('/community/'); })
    .fail(function (xhr) { $('#post-msg').text(GT.errorMessage(xhr)); });
}

/* =====================================================================
   2. 댓글 / 답글
   ===================================================================== */

/** 댓글을 불러와서 "댓글 → 그 아래 답글" 순서로 그린다. */
function loadComments() {
  GT.api('GET', '/api/community/posts/' + postId + '/comments').done(function (data) {
    const comments = data.comments;
    const $list = $('#comment-list').empty();

    // 삭제되지 않은 댓글·답글 수
    $('#comment-total').text(comments.filter((c) => !c.isDeleted).length);

    const parents = comments.filter((c) => c.parentId === null);
    if (parents.length === 0) {
      $list.append('<li class="muted empty-text">첫 댓글을 남겨 보세요.</li>');
    }

    parents.forEach(function (parent) {
      const $item = renderComment(parent, false);
      const replies = comments.filter((c) => c.parentId === parent.id);

      if (replies.length > 0) {
        const $replies = $('<ul class="reply-list">');
        replies.forEach(function (reply) { $replies.append(renderComment(reply, true)); });
        $item.append($replies);
      }
      $list.append($item);
    });
  });
}

/**
 * 댓글 한 개를 그린다.
 *
 * @param {object}  comment
 * @param {boolean} isReply 답글이면 true (답글에는 [답글] 버튼 없음)
 */
function renderComment(comment, isReply) {
  const $item = $('<li class="comment-item">').attr('data-id', comment.id).toggleClass('deleted', comment.isDeleted);
  const $box = $('<div class="comment-box">').appendTo($item);

  if (!comment.isDeleted) {
    $('<div class="comment-head">')
      .append($('<b>').text(comment.authorName))
      .append($('<span class="muted">').text(GT.formatFullDate(comment.createdAt)))
      .appendTo($box);
  }
  $('<div class="comment-body">').text(comment.content).appendTo($box);

  const $actions = $('<div class="comment-actions">').appendTo($box);
  if (!isReply && !comment.isDeleted) {
    $('<button type="button" class="link-btn btn-reply">답글</button>').appendTo($actions);
  }
  if (comment.isMine) {
    $('<button type="button" class="link-btn btn-delete-comment">삭제</button>').appendTo($actions);
  }
  return $item;
}

function bindCommentEvents() {
  // 댓글 작성
  $('#comment-form').on('submit', function (event) {
    event.preventDefault();
    postComment($('#comment-content').val().trim(), null, function () {
      $('#comment-content').val('');
    });
  });

  // [답글] → 해당 댓글 바로 아래에 답글 입력창 열기 (하나만 열리게)
  $('#comment-list').on('click', '.btn-reply', function () {
    $('.reply-form').remove();
    const $item = $(this).closest('.comment-item');
    const $form = $(
      '<form class="comment-form reply-form">' +
        '<textarea class="input" maxlength="1000" placeholder="답글을 입력하세요"></textarea>' +
        '<button type="submit" class="btn btn-primary btn-sm">등록</button>' +
        '<button type="button" class="btn btn-sm btn-cancel-reply">취소</button>' +
      '</form>'
    ).attr('data-parent', $item.data('id'));
    $item.children('.comment-box').after($form);
    $form.find('textarea').focus();
  });

  $('#comment-list').on('click', '.btn-cancel-reply', function () {
    $(this).closest('.reply-form').remove();
  });

  // 답글 작성
  $('#comment-list').on('submit', '.reply-form', function (event) {
    event.preventDefault();
    const $form = $(this);
    postComment($form.find('textarea').val().trim(), Number($form.data('parent')));
  });

  // 댓글 삭제
  $('#comment-list').on('click', '.btn-delete-comment', function () {
    if (!confirm('댓글을 삭제할까요?')) return;
    const commentId = $(this).closest('.comment-item').data('id');

    GT.api('DELETE', '/api/community/comments/' + commentId)
      .done(loadComments)
      .fail(function (xhr) { showCommentMessage(GT.errorMessage(xhr), 'error'); });
  });
}

/**
 * 댓글 또는 답글을 등록한다.
 *
 * @param {string}      content
 * @param {number|null} parentId  답글이면 원 댓글 id
 * @param {Function}    [onSuccess]
 */
function postComment(content, parentId, onSuccess) {
  if (!content) return showCommentMessage('내용을 입력해 주세요.', 'error');

  const body = { content: content };
  if (parentId) body.parentId = parentId;

  GT.api('POST', '/api/community/posts/' + postId + '/comments', body)
    .done(function (res) {
      showCommentMessage(res.message, 'ok');
      if (onSuccess) onSuccess();
      loadComments();
      GT.PostList.load(GT.PostList.page);   // 목록의 댓글 수 갱신
    })
    .fail(function (xhr) { showCommentMessage(GT.errorMessage(xhr), 'error'); });
}

function showCommentMessage(text, type) {
  $('#comment-msg').text(text).removeClass('ok error').addClass(type);
}

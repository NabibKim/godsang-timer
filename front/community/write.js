/* =====================================================================
   글쓰기 / 글 수정 화면 스크립트
   ---------------------------------------------------------------------
   /community/write.html        → 새 글 작성  (POST /api/community/posts)
   /community/write.html?id=3   → 3번 글 수정 (PUT  /api/community/posts/3, 본인 글만)
   ===================================================================== */

const editId = Number(GT.getQueryParam('id')) || null;

$(function () {
  GT.initLayout('community').done(function () {
    if (editId) {
      loadPostForEdit();
    }

    // 글자 수 표시
    $('#write-title, #write-content').on('input', updateCounts);

    $('#write-form').on('submit', function (event) {
      event.preventDefault();
      submitPost();
    });
  });
});

function updateCounts() {
  $('#title-count').text($('#write-title').val().length + '/100');
  $('#content-count').text($('#write-content').val().length + '/5000');
}

/** 수정 모드 : 기존 글을 불러와 입력창에 채운다. 본인 글이 아니면 상세 화면으로 돌려보낸다. */
function loadPostForEdit() {
  $('#write-heading').text('글 수정');
  $('#btn-submit').text('수정');
  $('#btn-cancel').attr('href', '/community/post.html?id=' + editId);

  GT.api('GET', '/api/community/posts/' + editId)
    .done(function (post) {
      if (!post.isMine) {
        alert('본인이 작성한 글만 수정할 수 있습니다.');
        location.replace('/community/post.html?id=' + editId);
        return;
      }
      $('#write-title').val(post.title);
      $('#write-content').val(post.content);
      updateCounts();
    })
    .fail(function (xhr) {
      $('#write-msg').text(GT.errorMessage(xhr));
    });
}

/** 등록 또는 수정 요청 → 성공하면 해당 글 상세 화면으로 이동 */
function submitPost() {
  const body = {
    title: $('#write-title').val().trim(),
    content: $('#write-content').val().trim(),
  };

  if (!body.title) return $('#write-msg').text('제목을 입력해 주세요.');
  if (!body.content) return $('#write-msg').text('내용을 입력해 주세요.');

  const request = editId
    ? GT.api('PUT', '/api/community/posts/' + editId, body)
    : GT.api('POST', '/api/community/posts', body);

  request
    .done(function (res) {
      location.href = '/community/post.html?id=' + res.id;
    })
    .fail(function (xhr) {
      $('#write-msg').text(GT.errorMessage(xhr));
    });
}

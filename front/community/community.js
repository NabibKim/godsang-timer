/* =====================================================================
   커뮤니티 목록 화면 스크립트  (URL: /community/)
   ---------------------------------------------------------------------
   - 게시글 목록·검색·페이지 번호 : post-list.js (GT.PostList)
   - 순공시간 랭킹 TOP 10 : GET /api/community/ranking?period=today|week
     (gt-community 가 study_records 테이블을 집계)
   ===================================================================== */

$(function () {
  GT.initLayout('community').done(function () {
    GT.PostList.init(null);

    $('.ranking-card .range-buttons .btn').on('click', function () {
      $('.ranking-card .range-buttons .btn').removeClass('active');
      $(this).addClass('active');
      loadRanking($(this).data('period'));
    });
    loadRanking('today');
  });
});

/**
 * 순공시간 랭킹을 불러와 그린다.
 *
 * @param {'today'|'week'} period
 */
function loadRanking(period) {
  GT.api('GET', '/api/community/ranking?period=' + period).done(function (data) {
    const $list = $('#rank-list').empty();
    $('#rank-empty').toggleClass('hidden', data.ranking.length > 0);

    data.ranking.forEach(function (item) {
      const medal = ['🥇', '🥈', '🥉'][item.rank - 1] || item.rank;
      $('<li class="rank-item">')
        .toggleClass('me', item.isMe)
        .append($('<span class="rank-no">').text(medal))
        .append($('<span class="rank-name">').text(item.name + (item.isMe ? ' (나)' : '')))
        .append($('<span class="rank-time">').text(GT.formatDuration(item.seconds)))
        .appendTo($list);
    });
  });
}

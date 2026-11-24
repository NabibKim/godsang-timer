<?php
/**
 * =====================================================================
 * 게시글 API (gt-community)
 * ---------------------------------------------------------------------
 *   GET    /api/community/posts?page=1&type=all|title|content&keyword=   목록 + 검색 (10개씩)
 *   GET    /api/community/posts/{id}                                      상세 (조회수 +1)
 *   POST   /api/community/posts                                           작성
 *   PUT    /api/community/posts/{id}                                      수정 (작성자만)
 *   DELETE /api/community/posts/{id}                                      삭제 (작성자만, 댓글도 함께 삭제)
 *   GET    /api/community/my/posts                                        내가 쓴 글 (마이페이지)
 *   GET    /api/community/ranking?period=today|week                       순공시간 랭킹 TOP 10
 *
 * 작성자 확인은 프론트가 보낸 값이 아니라 Redis 공유 세션의 userId 로 한다.
 * =====================================================================
 */

declare(strict_types=1);

const POSTS_PER_PAGE    = 10;
const TITLE_MAX_LENGTH  = 100;
const CONTENT_MAX_LENGTH = 5000;

/**
 * LIKE 검색어의 특수문자(%, _, \)를 글자 그대로 검색되게 바꾼다.
 * 예) "100%" 를 검색했을 때 모든 글이 나오지 않도록
 */
function escape_like(string $keyword): string
{
    return '%' . addcslashes($keyword, '%_\\') . '%';
}

/**
 * 게시글을 조회하고, 없으면 404 응답 후 종료한다.
 *
 * @return array posts 행
 */
function find_post_or_404(int $postId): array
{
    $stmt = get_db()->prepare('SELECT id, user_id, title, content FROM posts WHERE id = ?');
    $stmt->execute([$postId]);
    $post = $stmt->fetch();

    if ($post === false) {
        error_response('게시글을 찾을 수 없습니다.', 404);
    }
    return $post;
}

/**
 * 제목·내용 입력값을 검사한다. 문제가 있으면 400 응답 후 종료.
 *
 * @return array [제목, 내용]
 */
function validate_post_body(array $body): array
{
    $title   = body_string($body, 'title');
    $content = body_string($body, 'content');

    if (mb_strlen($title) < 1 || mb_strlen($title) > TITLE_MAX_LENGTH) {
        error_response('제목은 1~' . TITLE_MAX_LENGTH . '자로 입력해 주세요.');
    }
    if (mb_strlen($content) < 1 || mb_strlen($content) > CONTENT_MAX_LENGTH) {
        error_response('내용은 1~' . CONTENT_MAX_LENGTH . '자로 입력해 주세요.');
    }
    return [$title, $content];
}

/** DB 행 → 목록용 JSON */
function post_summary_json(array $row): array
{
    return [
        'id'           => (int)$row['id'],
        'title'        => $row['title'],
        'authorName'   => $row['author_name'],
        'commentCount' => (int)$row['comment_count'],
        'viewCount'    => (int)$row['view_count'],
        'createdAt'    => $row['created_at'],
    ];
}

// =====================================================================
// API
// =====================================================================

/**
 * GET /api/community/posts : 게시글 목록 (최신순, 10개씩)
 * 검색 type : all(제목+내용) / title / content
 */
function list_posts(): never
{
    require_login();

    $page    = max(1, (int)($_GET['page'] ?? 1));
    $type    = $_GET['type'] ?? 'all';
    $keyword = trim((string)($_GET['keyword'] ?? ''));

    // 1) 검색 조건 만들기 (값은 모두 ? 자리로 넘겨 SQL 인젝션 방지)
    $where  = '';
    $params = [];
    if ($keyword !== '') {
        $like = escape_like($keyword);
        if ($type === 'title') {
            $where = 'WHERE p.title LIKE ?';
            $params = [$like];
        } elseif ($type === 'content') {
            $where = 'WHERE p.content LIKE ?';
            $params = [$like];
        } else {
            $where = 'WHERE (p.title LIKE ? OR p.content LIKE ?)';
            $params = [$like, $like];
        }
    }

    // 2) 전체 개수 → 전체 페이지 수
    $countStmt = get_db()->prepare("SELECT COUNT(*) FROM posts p $where");
    $countStmt->execute($params);
    $total      = (int)$countStmt->fetchColumn();
    $totalPages = max(1, (int)ceil($total / POSTS_PER_PAGE));
    $page       = min($page, $totalPages);
    $offset     = ($page - 1) * POSTS_PER_PAGE;

    // 3) 현재 페이지 목록 (LIMIT/OFFSET 은 위에서 정수로 계산한 값만 사용)
    $sql = "
        SELECT p.id, p.title, p.view_count, p.created_at, u.name AS author_name,
               (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.is_deleted = 0) AS comment_count
          FROM posts p
          JOIN users u ON u.id = p.user_id
          $where
         ORDER BY p.id DESC
         LIMIT " . POSTS_PER_PAGE . " OFFSET $offset";
    $stmt = get_db()->prepare($sql);
    $stmt->execute($params);

    json_response([
        'posts'      => array_map('post_summary_json', $stmt->fetchAll()),
        'page'       => $page,
        'totalPages' => $totalPages,
        'total'      => $total,
    ]);
}

/** GET /api/community/posts/{id} : 상세 (들어올 때마다 조회수 +1) */
function get_post(string $id): never
{
    $session = require_login();
    $postId  = (int)$id;

    $update = get_db()->prepare('UPDATE posts SET view_count = view_count + 1 WHERE id = ?');
    $update->execute([$postId]);

    $stmt = get_db()->prepare(
        'SELECT p.id, p.user_id, p.title, p.content, p.view_count, p.created_at, p.updated_at, u.name AS author_name
           FROM posts p JOIN users u ON u.id = p.user_id
          WHERE p.id = ?'
    );
    $stmt->execute([$postId]);
    $post = $stmt->fetch();

    if ($post === false) {
        error_response('게시글을 찾을 수 없습니다.', 404);
    }

    json_response([
        'id'         => (int)$post['id'],
        'title'      => $post['title'],
        'content'    => $post['content'],
        'authorName' => $post['author_name'],
        'viewCount'  => (int)$post['view_count'],
        'createdAt'  => $post['created_at'],
        'updatedAt'  => $post['updated_at'],
        'isMine'     => (int)$post['user_id'] === (int)$session['userId'],  // 수정·삭제 버튼 표시 여부
    ]);
}

/** POST /api/community/posts : 글 작성  {"title": "...", "content": "..."} */
function create_post(): never
{
    $session = require_login();
    [$title, $content] = validate_post_body(get_json_body());

    $stmt = get_db()->prepare('INSERT INTO posts (user_id, title, content) VALUES (?, ?, ?)');
    $stmt->execute([$session['userId'], $title, $content]);

    json_response(['message' => '게시글이 등록되었습니다.', 'id' => (int)get_db()->lastInsertId()], 201);
}

/** PUT /api/community/posts/{id} : 글 수정 (작성자 본인만) */
function update_post(string $id): never
{
    $session = require_login();
    $post    = find_post_or_404((int)$id);

    if ((int)$post['user_id'] !== (int)$session['userId']) {
        error_response('본인이 작성한 글만 수정할 수 있습니다.', 403);
    }

    [$title, $content] = validate_post_body(get_json_body());
    $stmt = get_db()->prepare('UPDATE posts SET title = ?, content = ? WHERE id = ?');
    $stmt->execute([$title, $content, $post['id']]);

    json_response(['message' => '게시글이 수정되었습니다.', 'id' => (int)$post['id']]);
}

/** DELETE /api/community/posts/{id} : 글 삭제 (작성자 본인만, 댓글은 FK ON DELETE CASCADE 로 함께 삭제) */
function delete_post(string $id): never
{
    $session = require_login();
    $post    = find_post_or_404((int)$id);

    if ((int)$post['user_id'] !== (int)$session['userId']) {
        error_response('본인이 작성한 글만 삭제할 수 있습니다.', 403);
    }

    $stmt = get_db()->prepare('DELETE FROM posts WHERE id = ?');
    $stmt->execute([$post['id']]);

    json_response(['message' => '게시글이 삭제되었습니다.']);
}

/** GET /api/community/my/posts : 내가 쓴 글 (마이페이지) */
function my_posts(): never
{
    $session = require_login();

    $stmt = get_db()->prepare(
        'SELECT p.id, p.title, p.view_count, p.created_at, u.name AS author_name,
                (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.is_deleted = 0) AS comment_count
           FROM posts p JOIN users u ON u.id = p.user_id
          WHERE p.user_id = ?
          ORDER BY p.id DESC'
    );
    $stmt->execute([$session['userId']]);

    json_response(['posts' => array_map('post_summary_json', $stmt->fetchAll())]);
}

/**
 * GET /api/community/ranking?period=today|week
 * 순공시간(STUDY 기록 합) 상위 10명. 진행 중인 공부는 현재 시각까지 계산한다.
 * week : 이번 주 월요일 00:00 부터
 */
function ranking(): never
{
    $session = require_login();
    $period  = ($_GET['period'] ?? 'today') === 'week' ? 'week' : 'today';

    $now   = new DateTimeImmutable('now');
    $start = $period === 'week'
        ? $now->modify('monday this week')->setTime(0, 0)
        : $now->setTime(0, 0);

    $stmt = get_db()->prepare(
        "SELECT u.id, u.name,
                SUM(TIMESTAMPDIFF(SECOND, r.start_at, IFNULL(r.end_at, ?))) AS seconds
           FROM study_records r
           JOIN users u ON u.id = r.user_id
          WHERE r.type = 'STUDY' AND r.start_at >= ?
          GROUP BY u.id, u.name
          ORDER BY seconds DESC
          LIMIT 10"
    );
    $stmt->execute([$now->format('Y-m-d H:i:s'), $start->format('Y-m-d H:i:s')]);

    $rank = 0;
    $list = array_map(function (array $row) use (&$rank, $session) {
        $rank++;
        return [
            'rank'    => $rank,
            'name'    => $row['name'],
            'seconds' => (int)$row['seconds'],
            'isMe'    => (int)$row['id'] === (int)$session['userId'],
        ];
    }, $stmt->fetchAll());

    json_response(['period' => $period, 'since' => $start->format('Y-m-d H:i:s'), 'ranking' => $list]);
}

<?php
/**
 * =====================================================================
 * 댓글 / 답글 API (gt-community)
 * ---------------------------------------------------------------------
 *   GET    /api/community/posts/{id}/comments   댓글·답글 목록 (작성 순)
 *   POST   /api/community/posts/{id}/comments   작성  {"content": "...", "parentId": 답글이면 원 댓글 id}
 *   DELETE /api/community/comments/{id}         삭제 (작성자만)
 *   GET    /api/community/my/comments           내가 쓴 댓글 (마이페이지)
 *
 * 답글 규칙
 *   - parent_id 가 NULL 이면 댓글, 값이 있으면 그 댓글의 답글
 *   - 답글에는 다시 답글을 달 수 없다. (1단계만 허용)
 *   - 답글이 달린 댓글을 지우면 "삭제된 댓글입니다."로 표시만 바꾸고 답글은 유지한다.
 * =====================================================================
 */

declare(strict_types=1);

const COMMENT_MAX_LENGTH = 1000;

/** GET /api/community/posts/{id}/comments */
function list_comments(string $id): never
{
    $session = require_login();
    find_post_or_404((int)$id);

    $stmt = get_db()->prepare(
        'SELECT c.id, c.parent_id, c.user_id, c.content, c.is_deleted, c.created_at, u.name AS author_name
           FROM comments c JOIN users u ON u.id = c.user_id
          WHERE c.post_id = ?
          ORDER BY c.id ASC'
    );
    $stmt->execute([(int)$id]);

    // 프론트는 parentId 를 보고 답글을 원 댓글 아래에 들여쓰기로 배치한다.
    $comments = array_map(function (array $row) use ($session) {
        $deleted = (int)$row['is_deleted'] === 1;
        return [
            'id'         => (int)$row['id'],
            'parentId'   => $row['parent_id'] === null ? null : (int)$row['parent_id'],
            'authorName' => $deleted ? '' : $row['author_name'],
            'content'    => $deleted ? '삭제된 댓글입니다.' : $row['content'],   // 삭제된 내용은 서버에서 가린다
            'isDeleted'  => $deleted,
            'isMine'     => !$deleted && (int)$row['user_id'] === (int)$session['userId'],
            'createdAt'  => $row['created_at'],
        ];
    }, $stmt->fetchAll());

    json_response(['comments' => $comments]);
}

/** POST /api/community/posts/{id}/comments : 댓글 또는 답글 작성 */
function create_comment(string $id): never
{
    $session = require_login();
    $post    = find_post_or_404((int)$id);
    $body    = get_json_body();
    $content = body_string($body, 'content');
    $parentId = isset($body['parentId']) && is_int($body['parentId']) ? $body['parentId'] : null;

    if (mb_strlen($content) < 1 || mb_strlen($content) > COMMENT_MAX_LENGTH) {
        error_response('댓글은 1~' . COMMENT_MAX_LENGTH . '자로 입력해 주세요.');
    }

    // 답글이면 : 같은 게시글의, 삭제되지 않은 "댓글"(답글이 아닌 것)에만 달 수 있다.
    if ($parentId !== null) {
        $stmt = get_db()->prepare('SELECT post_id, parent_id, is_deleted FROM comments WHERE id = ?');
        $stmt->execute([$parentId]);
        $parent = $stmt->fetch();

        if ($parent === false || (int)$parent['post_id'] !== (int)$post['id'] || (int)$parent['is_deleted'] === 1) {
            error_response('답글을 달 댓글을 찾을 수 없습니다.', 404);
        }
        if ($parent['parent_id'] !== null) {
            error_response('답글에는 다시 답글을 달 수 없습니다.');
        }
    }

    $stmt = get_db()->prepare('INSERT INTO comments (post_id, user_id, parent_id, content) VALUES (?, ?, ?, ?)');
    $stmt->execute([$post['id'], $session['userId'], $parentId, $content]);

    json_response(['message' => $parentId === null ? '댓글이 등록되었습니다.' : '답글이 등록되었습니다.'], 201);
}

/** DELETE /api/community/comments/{id} : 댓글 삭제 (작성자만) */
function delete_comment(string $id): never
{
    $session = require_login();

    $stmt = get_db()->prepare('SELECT id, user_id, is_deleted FROM comments WHERE id = ?');
    $stmt->execute([(int)$id]);
    $comment = $stmt->fetch();

    if ($comment === false || (int)$comment['is_deleted'] === 1) {
        error_response('댓글을 찾을 수 없습니다.', 404);
    }
    if ((int)$comment['user_id'] !== (int)$session['userId']) {
        error_response('본인이 작성한 댓글만 삭제할 수 있습니다.', 403);
    }

    // 답글이 달려 있으면 표시만 "삭제됨"으로 (답글 보존), 없으면 실제로 삭제
    $replyStmt = get_db()->prepare('SELECT COUNT(*) FROM comments WHERE parent_id = ?');
    $replyStmt->execute([$comment['id']]);

    if ((int)$replyStmt->fetchColumn() > 0) {
        $stmt = get_db()->prepare('UPDATE comments SET is_deleted = 1 WHERE id = ?');
    } else {
        $stmt = get_db()->prepare('DELETE FROM comments WHERE id = ?');
    }
    $stmt->execute([$comment['id']]);

    json_response(['message' => '댓글이 삭제되었습니다.']);
}

/** GET /api/community/my/comments : 내가 쓴 댓글 + 원 게시글 제목 */
function my_comments(): never
{
    $session = require_login();

    $stmt = get_db()->prepare(
        'SELECT c.id, c.post_id, c.content, c.created_at, p.title AS post_title
           FROM comments c JOIN posts p ON p.id = c.post_id
          WHERE c.user_id = ? AND c.is_deleted = 0
          ORDER BY c.id DESC'
    );
    $stmt->execute([$session['userId']]);

    $comments = array_map(fn(array $row) => [
        'id'        => (int)$row['id'],
        'postId'    => (int)$row['post_id'],
        'postTitle' => $row['post_title'],
        'content'   => $row['content'],
        'createdAt' => $row['created_at'],
    ], $stmt->fetchAll());

    json_response(['comments' => $comments]);
}

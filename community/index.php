<?php
/**
 * =====================================================================
 * gt-community 진입점 (라우터)
 * ---------------------------------------------------------------------
 * .htaccess 가 모든 요청을 이 파일로 보낸다.
 * gt-proxy 가 전달한 /api/community/... 경로에서 접두어를 떼고 $routes 표와 비교한다.
 *   예) GET /api/community/posts/3  →  GET /posts/3  →  get_post('3')
 * =====================================================================
 */

declare(strict_types=1);

require_once __DIR__ . '/lib/response.php';
require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/session.php';
require_once __DIR__ . '/controllers/system_controller.php';
require_once __DIR__ . '/controllers/post_controller.php';
require_once __DIR__ . '/controllers/comment_controller.php';

const API_PREFIX = '/api/community';

// ---------------------------------------------------------------------
// 라우팅 표 : [HTTP 메서드, 경로(정규식), 처리 함수 이름]
// 괄호로 묶은 부분(예: (\d+))은 처리 함수의 인자로 전달된다.
// ---------------------------------------------------------------------
$routes = [
    // 상태 확인 / 세션 공유 확인
    ['GET',    '/health',                 'health'],
    ['GET',    '/whoami',                 'whoami'],

    // 게시글
    ['GET',    '/posts',                  'list_posts'],
    ['POST',   '/posts',                  'create_post'],
    ['GET',    '/posts/(\d+)',            'get_post'],
    ['PUT',    '/posts/(\d+)',            'update_post'],
    ['DELETE', '/posts/(\d+)',            'delete_post'],

    // 댓글 / 답글
    ['GET',    '/posts/(\d+)/comments',   'list_comments'],
    ['POST',   '/posts/(\d+)/comments',   'create_comment'],
    ['DELETE', '/comments/(\d+)',         'delete_comment'],

    // 마이페이지 / 랭킹
    ['GET',    '/my/posts',               'my_posts'],
    ['GET',    '/my/comments',            'my_comments'],
    ['GET',    '/ranking',                'ranking'],
];

$method = $_SERVER['REQUEST_METHOD'];
$path   = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';
if (str_starts_with($path, API_PREFIX)) {
    $path = substr($path, strlen(API_PREFIX));
}
$path = rtrim($path, '/') ?: '/';

try {
    foreach ($routes as [$routeMethod, $pattern, $handler]) {
        if ($routeMethod === $method && preg_match('#^' . $pattern . '$#', $path, $matches)) {
            array_shift($matches);
            $handler(...$matches);
        }
    }
    error_response('요청한 API를 찾을 수 없습니다.', 404);
} catch (PDOException $e) {
    error_log('[gt-community][DB] ' . $e->getMessage());
    error_response('데이터베이스 처리 중 오류가 발생했습니다.', 500);
} catch (RedisException $e) {
    error_log('[gt-community][Redis] ' . $e->getMessage());
    error_response('세션 서버에 연결할 수 없습니다.', 500);
} catch (Throwable $e) {
    error_log('[gt-community] ' . $e->getMessage());
    error_response('서버 오류가 발생했습니다.', 500);
}

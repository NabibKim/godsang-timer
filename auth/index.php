<?php
/**
 * =====================================================================
 * gt-auth 진입점 (라우터)
 * ---------------------------------------------------------------------
 * .htaccess 가 모든 요청을 이 파일로 보낸다.
 * "HTTP 메서드 + 경로"를 아래 $routes 표와 비교해서 맞는 처리 함수를 호출한다.
 *
 * gt-proxy 는 /api/auth/... 경로를 그대로 전달하므로 앞부분(/api/auth)을 떼고 비교한다.
 *   예) POST /api/auth/login  →  POST /login  →  login()
 * =====================================================================
 */

declare(strict_types=1);

require_once __DIR__ . '/lib/response.php';
require_once __DIR__ . '/lib/db.php';
require_once __DIR__ . '/lib/session.php';
require_once __DIR__ . '/controllers/auth_controller.php';

const API_PREFIX = '/api/auth';

// ---------------------------------------------------------------------
// 라우팅 표 : [HTTP 메서드, 경로(정규식), 처리 함수 이름]
// ---------------------------------------------------------------------
$routes = [
    ['GET',  '/health',          'health'],
    ['GET',  '/check-id',        'check_login_id'],
    ['GET',  '/check-name',      'check_name'],
    ['POST', '/signup',          'signup'],
    ['POST', '/login',           'login'],
    ['POST', '/logout',          'logout'],
    ['GET',  '/me',              'me'],
    ['POST', '/verify-password', 'verify_password'],
    ['GET',  '/profile',         'get_profile'],
    ['PUT',  '/profile',         'update_profile'],
    ['PUT',  '/password',        'change_password'],
];

// 요청 경로에서 쿼리스트링(?...)을 떼고 /api/auth 접두어를 제거
$method = $_SERVER['REQUEST_METHOD'];
$path   = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';
if (str_starts_with($path, API_PREFIX)) {
    $path = substr($path, strlen(API_PREFIX));
}
$path = rtrim($path, '/') ?: '/';

try {
    foreach ($routes as [$routeMethod, $pattern, $handler]) {
        // #^...$# : 경로 전체가 정확히 일치해야 함, 괄호 (\d+) 부분은 함수 인자로 전달
        if ($routeMethod === $method && preg_match('#^' . $pattern . '$#', $path, $matches)) {
            array_shift($matches);
            $handler(...$matches);
        }
    }
    error_response('요청한 API를 찾을 수 없습니다.', 404);
} catch (PDOException $e) {
    // DB 오류의 상세 내용은 사용자에게 보여 주지 않고 컨테이너 로그(docker logs gt-auth)에만 남긴다.
    error_log('[gt-auth][DB] ' . $e->getMessage());
    error_response('데이터베이스 처리 중 오류가 발생했습니다.', 500);
} catch (RedisException $e) {
    error_log('[gt-auth][Redis] ' . $e->getMessage());
    error_response('세션 서버에 연결할 수 없습니다.', 500);
} catch (Throwable $e) {
    error_log('[gt-auth] ' . $e->getMessage());
    error_response('서버 오류가 발생했습니다.', 500);
}

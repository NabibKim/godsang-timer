<?php
/**
 * =====================================================================
 * Redis 공유 세션 모듈  ★ 컨테이너 간 세션 공유의 핵심 ★
 * ---------------------------------------------------------------------
 * PHP 기본 세션(session_start / $_SESSION)은 사용하지 않는다.
 *  - 기본 세션은 각 컨테이너의 파일에 저장되어 다른 서버가 읽을 수 없고,
 *  - PHP 전용 직렬화 형식이라 파이썬(gt-timer)이 해석할 수 없기 때문이다.
 *
 * 대신 모든 서버(PHP auth/community, Python timer)가 아래 "세션 규약"을 똑같이 따른다.
 *   쿠키 이름 : GT_SID  (HttpOnly, Path=/, SameSite=Lax)
 *   Redis 키  : session:<GT_SID>
 *   Redis 값  : {"userId":1,"loginId":"hong","name":"홍길동","loginAt":"...","mypageVerifiedUntil":null}
 *   만료 시간 : 7200초(2시간), 요청이 올 때마다 다시 2시간으로 연장 (슬라이딩 만료)
 *
 * 세션 "생성·삭제"는 gt-auth 만 하고, 나머지 서버는 "조회"만 한다.
 * =====================================================================
 */

declare(strict_types=1);

const SESSION_COOKIE = 'GT_SID';
const SESSION_PREFIX = 'session:';
const SESSION_TTL    = 7200;

/**
 * Redis(gt-redis) 연결 객체를 반환한다. (phpredis 확장 사용)
 *
 * @return Redis
 */
function get_redis(): Redis
{
    static $redis = null;

    if ($redis === null) {
        $redis = new Redis();
        // 세 번째 인자 2.0 = 연결 타임아웃(초)
        $redis->connect(getenv('REDIS_HOST') ?: 'gt-redis', (int)(getenv('REDIS_PORT') ?: 6379), 2.0);
    }

    return $redis;
}

/**
 * 추측할 수 없는 랜덤 세션 ID(UUID v4 형식)를 만든다.
 *
 * @return string 예: 3f2b8c1e-9a4d-4e6f-8b21-0c7d5e9a1f34
 */
function generate_session_id(): string
{
    $bytes    = random_bytes(16);                              // 암호학적으로 안전한 난수 16바이트
    $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);           // UUID 버전 4 표시
    $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);           // UUID variant 표시
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
}

/**
 * 쿠키에 담긴 세션 ID를 꺼낸다. 형식이 이상하면 null.
 *
 * @return string|null
 */
function current_session_id(): ?string
{
    $sid = $_COOKIE[SESSION_COOKIE] ?? null;
    return (is_string($sid) && preg_match('/^[0-9a-f-]{36}$/', $sid)) ? $sid : null;
}

/**
 * 세션 쿠키를 브라우저에 설정한다.
 *
 * @param string $value   세션 ID (삭제 시 빈 문자열)
 * @param int    $expires 0 = 브라우저를 닫으면 삭제되는 쿠키
 */
function set_session_cookie(string $value, int $expires = 0): void
{
    setcookie(SESSION_COOKIE, $value, [
        'expires'  => $expires,
        'path'     => '/',      // 모든 경로(/api/auth, /api/timer, /api/community)에서 전송
        'httponly' => true,     // JS에서 document.cookie 로 읽을 수 없음 → XSS로 세션 탈취 방지
        'samesite' => 'Lax',    // 다른 사이트에서 오는 요청에는 쿠키를 보내지 않음 → CSRF 완화
    ]);
}

/**
 * 로그인 성공 시 새 세션을 만든다. (gt-auth 전용)
 *
 * @param array $user users 테이블 행 (id, login_id, name)
 * @return string 생성된 세션 ID
 */
function create_session(array $user): string
{
    $sid  = generate_session_id();
    $data = [
        'userId'              => (int)$user['id'],
        'loginId'             => $user['login_id'],
        'name'                => $user['name'],
        'loginAt'             => date('c'),
        'mypageVerifiedUntil' => null,   // 마이페이지 비밀번호 재확인 유효 시각(유닉스 시간)
    ];

    // SETEX : 값 저장과 만료 시간 설정을 한 번에
    get_redis()->setex(SESSION_PREFIX . $sid, SESSION_TTL, json_encode($data, JSON_UNESCAPED_UNICODE));
    set_session_cookie($sid);

    return $sid;
}

/**
 * 현재 요청의 세션 정보를 조회한다. 조회될 때마다 만료 시간을 2시간으로 연장한다.
 *
 * @return array|null 로그인 상태면 세션 배열, 아니면 null
 */
function get_session(): ?array
{
    $sid = current_session_id();
    if ($sid === null) {
        return null;
    }

    $key = SESSION_PREFIX . $sid;
    $raw = get_redis()->get($key);
    if ($raw === false) {
        return null;    // 만료되었거나 로그아웃된 세션
    }

    get_redis()->expire($key, SESSION_TTL);

    $data = json_decode($raw, true);
    return is_array($data) ? $data : null;
}

/**
 * 변경된 세션 정보를 Redis에 다시 저장한다. (예: 이름 변경, 마이페이지 재확인)
 *
 * @param array $data 저장할 세션 배열 전체
 */
function save_session(array $data): void
{
    $sid = current_session_id();
    if ($sid !== null) {
        get_redis()->setex(SESSION_PREFIX . $sid, SESSION_TTL, json_encode($data, JSON_UNESCAPED_UNICODE));
    }
}

/**
 * 로그아웃 : Redis 세션을 지우고 브라우저 쿠키도 만료시킨다. (gt-auth 전용)
 */
function destroy_session(): void
{
    $sid = current_session_id();
    if ($sid !== null) {
        get_redis()->del(SESSION_PREFIX . $sid);
    }
    set_session_cookie('', time() - 3600);
}

/**
 * 로그인이 필요한 API 맨 앞에서 호출한다.
 * 로그인하지 않았으면 401 응답 후 종료, 로그인했으면 세션 배열을 돌려준다.
 *
 * @return array 세션 배열 (userId, loginId, name ...)
 */
function require_login(): array
{
    $session = get_session();
    if ($session === null) {
        error_response('로그인이 필요합니다.', 401);
    }
    return $session;
}

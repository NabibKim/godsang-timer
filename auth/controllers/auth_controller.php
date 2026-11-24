<?php
/**
 * =====================================================================
 * 회원 / 로그인 / 마이페이지 API 처리 함수 (gt-auth)
 * ---------------------------------------------------------------------
 * 각 함수는 index.php 의 라우터가 "메서드 + 경로"에 맞춰 호출한다.
 * 모든 함수는 json_response() 또는 error_response() 로 응답하고 종료한다.
 * =====================================================================
 */

declare(strict_types=1);

// ---------------------------------------------------------------------
// 입력값 규칙 (프론트 login.js / mypage.js 의 규칙과 동일하게 유지)
// ---------------------------------------------------------------------
const LOGIN_ID_PATTERN     = '/^[a-z0-9]{4,20}$/';               // 영문 소문자+숫자 4~20자
const PASSWORD_PATTERN     = '/^(?=.*[A-Za-z])(?=.*\d).{8,64}$/'; // 8~64자, 영문과 숫자를 각각 1개 이상
const NAME_MIN_LENGTH      = 2;
const NAME_MAX_LENGTH      = 10;
const MYPAGE_VERIFY_SECOND = 600;                                 // 마이페이지 비밀번호 재확인 유효 시간(10분)

/** 아이디 형식 검사 */
function is_valid_login_id(string $loginId): bool
{
    return (bool)preg_match(LOGIN_ID_PATTERN, $loginId);
}

/** 비밀번호 형식 검사 */
function is_valid_password(string $password): bool
{
    return (bool)preg_match(PASSWORD_PATTERN, $password);
}

/** 이름 형식 검사 (한글도 1글자로 세기 위해 mb_strlen 사용, 공백 금지) */
function is_valid_name(string $name): bool
{
    $length = mb_strlen($name);
    return $length >= NAME_MIN_LENGTH && $length <= NAME_MAX_LENGTH && !preg_match('/\s/u', $name);
}

/**
 * 아이디가 이미 사용 중인지 확인한다.
 *
 * @param string   $loginId       확인할 아이디
 * @param int|null $excludeUserId 마이페이지 수정처럼 "내 아이디는 제외"하고 검사할 때 내 userId
 */
function is_login_id_taken(string $loginId, ?int $excludeUserId = null): bool
{
    $stmt = get_db()->prepare('SELECT id FROM users WHERE login_id = ? AND id <> ?');
    $stmt->execute([$loginId, $excludeUserId ?? 0]);
    return $stmt->fetch() !== false;
}

/**
 * 이름이 이미 사용 중인지 확인한다. (매개변수는 is_login_id_taken 과 동일)
 */
function is_name_taken(string $name, ?int $excludeUserId = null): bool
{
    $stmt = get_db()->prepare('SELECT id FROM users WHERE name = ? AND id <> ?');
    $stmt->execute([$name, $excludeUserId ?? 0]);
    return $stmt->fetch() !== false;
}

/**
 * MySQL UNIQUE 제약 위반(동시에 같은 아이디로 가입하는 경우 등)인지 판별한다.
 */
function is_duplicate_error(PDOException $e): bool
{
    return $e->getCode() === '23000';
}

// =====================================================================
// 상태 확인
// =====================================================================

/** GET /api/auth/health : 서버 동작 확인용 */
function health(): never
{
    json_response(['server' => 'gt-auth', 'status' => 'ok']);
}

// =====================================================================
// 중복확인
// =====================================================================

/**
 * GET /api/auth/check-id?loginId=
 * 로그인 상태(마이페이지)에서 호출하면 내 아이디는 "사용 가능"으로 본다.
 * 응답 : {"available": true|false, "message": "..."}
 */
function check_login_id(): never
{
    $loginId = trim((string)($_GET['loginId'] ?? ''));
    if (!is_valid_login_id($loginId)) {
        error_response('아이디는 영문 소문자와 숫자로 4~20자여야 합니다.');
    }

    $session = get_session();
    $taken   = is_login_id_taken($loginId, $session['userId'] ?? null);

    json_response([
        'available' => !$taken,
        'message'   => $taken ? '이미 사용 중인 아이디입니다.' : '사용할 수 있는 아이디입니다.',
    ]);
}

/**
 * GET /api/auth/check-name?name=
 * 응답 형식은 check_login_id 와 동일
 */
function check_name(): never
{
    $name = trim((string)($_GET['name'] ?? ''));
    if (!is_valid_name($name)) {
        error_response('이름은 공백 없이 2~10자여야 합니다.');
    }

    $session = get_session();
    $taken   = is_name_taken($name, $session['userId'] ?? null);

    json_response([
        'available' => !$taken,
        'message'   => $taken ? '이미 사용 중인 이름입니다.' : '사용할 수 있는 이름입니다.',
    ]);
}

// =====================================================================
// 회원가입 / 로그인 / 로그아웃
// =====================================================================

/**
 * POST /api/auth/signup
 * 요청 : {"loginId": "hong", "password": "abcd1234", "name": "홍길동"}
 * 프론트에서 중복확인을 했더라도, 그 사이 다른 사람이 가입했을 수 있으므로 서버에서 한 번 더 검사한다.
 */
function signup(): never
{
    $body     = get_json_body();
    $loginId  = body_string($body, 'loginId');
    $password = isset($body['password']) && is_string($body['password']) ? $body['password'] : '';
    $name     = body_string($body, 'name');

    // 1) 형식 검사
    if (!is_valid_login_id($loginId)) {
        error_response('아이디는 영문 소문자와 숫자로 4~20자여야 합니다.');
    }
    if (!is_valid_password($password)) {
        error_response('비밀번호는 영문과 숫자를 포함해 8자 이상이어야 합니다.');
    }
    if (!is_valid_name($name)) {
        error_response('이름은 공백 없이 2~10자여야 합니다.');
    }

    // 2) 중복 검사 (409 Conflict)
    if (is_login_id_taken($loginId)) {
        error_response('이미 사용 중인 아이디입니다.', 409);
    }
    if (is_name_taken($name)) {
        error_response('이미 사용 중인 이름입니다.', 409);
    }

    // 3) 비밀번호는 bcrypt 해시로만 저장 (같은 비밀번호라도 매번 다른 해시가 생성됨)
    $hash = password_hash($password, PASSWORD_BCRYPT);

    try {
        $stmt = get_db()->prepare('INSERT INTO users (login_id, password_hash, name) VALUES (?, ?, ?)');
        $stmt->execute([$loginId, $hash, $name]);
    } catch (PDOException $e) {
        if (is_duplicate_error($e)) {
            error_response('이미 사용 중인 아이디 또는 이름입니다.', 409);
        }
        throw $e;
    }

    json_response(['message' => '회원가입이 완료되었습니다. 로그인해 주세요.'], 201);
}

/**
 * POST /api/auth/login
 * 요청 : {"loginId": "hong", "password": "abcd1234"}
 * 성공 시 Redis에 세션을 만들고 GT_SID 쿠키를 발급한다.
 */
function login(): never
{
    $body     = get_json_body();
    $loginId  = body_string($body, 'loginId');
    $password = isset($body['password']) && is_string($body['password']) ? $body['password'] : '';

    $stmt = get_db()->prepare('SELECT id, login_id, name, password_hash FROM users WHERE login_id = ?');
    $stmt->execute([$loginId]);
    $user = $stmt->fetch();

    // 아이디가 없는 경우와 비밀번호가 틀린 경우를 같은 메시지로 응답
    // → 어떤 아이디가 가입되어 있는지 외부에서 알아낼 수 없게 한다.
    if ($user === false || !password_verify($password, $user['password_hash'])) {
        error_response('아이디 또는 비밀번호가 올바르지 않습니다.', 401);
    }

    create_session($user);

    json_response([
        'message' => '로그인되었습니다.',
        'user'    => ['userId' => (int)$user['id'], 'loginId' => $user['login_id'], 'name' => $user['name']],
    ]);
}

/** POST /api/auth/logout : Redis 세션 삭제 + 쿠키 만료 */
function logout(): never
{
    destroy_session();
    json_response(['message' => '로그아웃되었습니다.']);
}

/**
 * GET /api/auth/me : 현재 로그인한 사용자 정보
 * 모든 화면이 처음 열릴 때 호출해서 로그인 여부를 확인하고 상단바에 이름을 표시한다.
 */
function me(): never
{
    $session = require_login();
    json_response([
        'userId'  => $session['userId'],
        'loginId' => $session['loginId'],
        'name'    => $session['name'],
    ]);
}

// =====================================================================
// 마이페이지 (비밀번호 재확인 후 개인정보 조회·수정)
// =====================================================================

/**
 * 마이페이지 API 맨 앞에서 호출한다.
 * 비밀번호 재확인 후 10분이 지나지 않았는지 "서버에서" 확인한다. (프론트만 막으면 우회 가능)
 *
 * @return array 세션 배열
 */
function require_mypage_verified(): array
{
    $session = require_login();
    $until   = (int)($session['mypageVerifiedUntil'] ?? 0);

    if ($until < time()) {
        error_response('비밀번호 확인이 필요합니다.', 403);
    }
    return $session;
}

/**
 * POST /api/auth/verify-password
 * 요청 : {"password": "abcd1234"}
 * 맞으면 세션에 mypageVerifiedUntil = 현재 시각 + 10분 을 기록한다.
 */
function verify_password(): never
{
    $session  = require_login();
    $body     = get_json_body();
    $password = isset($body['password']) && is_string($body['password']) ? $body['password'] : '';

    $stmt = get_db()->prepare('SELECT password_hash FROM users WHERE id = ?');
    $stmt->execute([$session['userId']]);
    $hash = $stmt->fetchColumn();

    if ($hash === false || !password_verify($password, $hash)) {
        error_response('비밀번호가 올바르지 않습니다.', 401);
    }

    $session['mypageVerifiedUntil'] = time() + MYPAGE_VERIFY_SECOND;
    save_session($session);

    json_response(['message' => '확인되었습니다.', 'verifiedUntil' => $session['mypageVerifiedUntil']]);
}

/** GET /api/auth/profile : 내 정보 조회 (비밀번호는 절대 응답하지 않음) */
function get_profile(): never
{
    $session = require_mypage_verified();

    $stmt = get_db()->prepare('SELECT id, login_id, name, created_at FROM users WHERE id = ?');
    $stmt->execute([$session['userId']]);
    $user = $stmt->fetch();

    if ($user === false) {
        error_response('사용자를 찾을 수 없습니다.', 404);
    }

    json_response([
        'userId'    => (int)$user['id'],
        'loginId'   => $user['login_id'],
        'name'      => $user['name'],
        'createdAt' => $user['created_at'],
    ]);
}

/**
 * PUT /api/auth/profile
 * 요청 : {"loginId": "newid", "name": "새이름"}
 * 성공하면 Redis 세션의 loginId, name 도 바꿔서 모든 서버에 즉시 반영되게 한다.
 */
function update_profile(): never
{
    $session = require_mypage_verified();
    $userId  = (int)$session['userId'];
    $body    = get_json_body();
    $loginId = body_string($body, 'loginId');
    $name    = body_string($body, 'name');

    if (!is_valid_login_id($loginId)) {
        error_response('아이디는 영문 소문자와 숫자로 4~20자여야 합니다.');
    }
    if (!is_valid_name($name)) {
        error_response('이름은 공백 없이 2~10자여야 합니다.');
    }
    if (is_login_id_taken($loginId, $userId)) {
        error_response('이미 사용 중인 아이디입니다.', 409);
    }
    if (is_name_taken($name, $userId)) {
        error_response('이미 사용 중인 이름입니다.', 409);
    }

    try {
        $stmt = get_db()->prepare('UPDATE users SET login_id = ?, name = ? WHERE id = ?');
        $stmt->execute([$loginId, $name, $userId]);
    } catch (PDOException $e) {
        if (is_duplicate_error($e)) {
            error_response('이미 사용 중인 아이디 또는 이름입니다.', 409);
        }
        throw $e;
    }

    // 공유 세션 갱신 → timer, community 서버도 바뀐 이름을 바로 사용
    $session['loginId'] = $loginId;
    $session['name']    = $name;
    save_session($session);

    json_response(['message' => '개인정보가 수정되었습니다.', 'loginId' => $loginId, 'name' => $name]);
}

/**
 * PUT /api/auth/password
 * 요청 : {"currentPassword": "...", "newPassword": "..."}
 */
function change_password(): never
{
    $session         = require_mypage_verified();
    $body            = get_json_body();
    $currentPassword = isset($body['currentPassword']) && is_string($body['currentPassword']) ? $body['currentPassword'] : '';
    $newPassword     = isset($body['newPassword']) && is_string($body['newPassword']) ? $body['newPassword'] : '';

    $stmt = get_db()->prepare('SELECT password_hash FROM users WHERE id = ?');
    $stmt->execute([$session['userId']]);
    $hash = $stmt->fetchColumn();

    if ($hash === false || !password_verify($currentPassword, $hash)) {
        error_response('현재 비밀번호가 올바르지 않습니다.', 401);
    }
    if (!is_valid_password($newPassword)) {
        error_response('새 비밀번호는 영문과 숫자를 포함해 8자 이상이어야 합니다.');
    }
    if ($currentPassword === $newPassword) {
        error_response('현재 비밀번호와 다른 비밀번호를 입력해 주세요.');
    }

    $stmt = get_db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
    $stmt->execute([password_hash($newPassword, PASSWORD_BCRYPT), $session['userId']]);

    json_response(['message' => '비밀번호가 변경되었습니다.']);
}

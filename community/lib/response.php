<?php
/**
 * =====================================================================
 * JSON 응답 / 요청 처리 공통 함수
 * ---------------------------------------------------------------------
 * 모든 API는 JSON으로만 주고받는다.
 * 실패 응답 형식은 항상 {"message": "사용자에게 보여 줄 한글 메시지"} 로 통일한다.
 * =====================================================================
 */

declare(strict_types=1);

/**
 * JSON 응답을 보내고 스크립트를 종료한다.
 *
 * @param mixed $data   응답 본문으로 보낼 배열/값
 * @param int   $status HTTP 상태 코드 (기본 200)
 */
function json_response($data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    // JSON_UNESCAPED_UNICODE : 한글을 \uXXXX 로 바꾸지 않고 그대로 출력
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/**
 * 실패 응답을 보낸다. (프론트는 message 값을 그대로 화면에 표시)
 *
 * @param string $message 사용자에게 보여 줄 메시지
 * @param int    $status  HTTP 상태 코드 (400 잘못된 요청, 401 미로그인, 403 권한 없음, 404 없음, 409 중복)
 */
function error_response(string $message, int $status = 400): never
{
    json_response(['message' => $message], $status);
}

/**
 * 요청 본문(JSON)을 연관 배열로 읽는다.
 * 프론트는 Content-Type: application/json 으로 보내므로 $_POST 가 아니라 php://input 을 읽어야 한다.
 *
 * @return array 본문이 없거나 JSON이 아니면 빈 배열
 */
function get_json_body(): array
{
    $raw  = file_get_contents('php://input');
    $data = json_decode($raw ?: '[]', true);
    return is_array($data) ? $data : [];
}

/**
 * 요청 본문에서 문자열 값을 꺼내 앞뒤 공백을 제거한다.
 *
 * @param array  $body 요청 본문
 * @param string $key  꺼낼 키
 * @return string 값이 없거나 문자열이 아니면 빈 문자열
 */
function body_string(array $body, string $key): string
{
    return isset($body[$key]) && is_string($body[$key]) ? trim($body[$key]) : '';
}

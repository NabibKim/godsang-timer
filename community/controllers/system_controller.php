<?php
/**
 * =====================================================================
 * 상태 확인 / 세션 공유 확인 API (gt-community)
 * ---------------------------------------------------------------------
 * 게시판 기능은 post_controller.php, 댓글 기능은 comment_controller.php 에 있다.
 * =====================================================================
 */

declare(strict_types=1);

/** GET /api/community/health : 서버 동작 확인용 (로그인 불필요) */
function health(): never
{
    json_response(['server' => 'gt-community', 'status' => 'ok']);
}

/**
 * GET /api/community/whoami
 * gt-auth 가 만든 세션을 gt-community 도 Redis에서 읽을 수 있는지 확인한다.
 * → 이 응답에 로그인한 사용자 이름이 나오면 "PHP 서버 간 세션 공유" 성공
 */
function whoami(): never
{
    $session = require_login();
    json_response([
        'server' => 'gt-community',
        'user'   => [
            'userId'  => $session['userId'],
            'loginId' => $session['loginId'],
            'name'    => $session['name'],
        ],
    ]);
}

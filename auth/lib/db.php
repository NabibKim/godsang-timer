<?php
/**
 * =====================================================================
 * MySQL(gt-db) 연결 모듈
 * ---------------------------------------------------------------------
 * 접속 정보는 코드에 적지 않고 docker run -e 로 넣은 환경변수에서 읽는다.
 *   DB_HOST(gt-db), DB_PORT(3306), DB_NAME(godsang), DB_USER(godsang), DB_PASSWORD
 * 컨테이너 이름(gt-db)이 곧 호스트명 → 도커 네트워크(gt-back-net)의 내장 DNS가 IP로 변환
 * =====================================================================
 */

declare(strict_types=1);

/**
 * PDO 연결 객체를 반환한다. (한 요청 안에서는 같은 연결을 재사용)
 *
 * @return PDO
 */
function get_db(): PDO
{
    static $pdo = null;

    if ($pdo === null) {
        $dsn = sprintf(
            'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
            getenv('DB_HOST') ?: 'gt-db',
            getenv('DB_PORT') ?: '3306',
            getenv('DB_NAME') ?: 'godsang'
        );

        $pdo = new PDO($dsn, getenv('DB_USER') ?: 'godsang', getenv('DB_PASSWORD') ?: '', [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION, // 오류 시 예외 발생 → index.php 에서 일괄 처리
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,       // 결과를 ['컬럼명' => 값] 배열로 받기
            PDO::ATTR_EMULATE_PREPARES   => false,                  // 진짜 prepared statement 사용 (SQL 인젝션 방지)
        ]);

        // DB 세션 시간대를 한국 시간으로 고정 (NOW(), CURRENT_TIMESTAMP 기준)
        $pdo->exec("SET time_zone = '+09:00'");
    }

    return $pdo;
}

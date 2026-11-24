-- =====================================================================
-- 갓생 타이머 DB 초기화 스크립트 (gt-db)
-- ---------------------------------------------------------------------
-- * MySQL 공식 이미지는 데이터 폴더(/var/lib/mysql)가 "비어 있을 때"만
--   /docker-entrypoint-initdb.d/ 안의 .sql 파일을 실행한다.
--   → 볼륨(gt-db-data)에 이미 데이터가 있으면 이 파일은 다시 실행되지 않는다.
--   → 그래서 앞으로 쓸 테이블(선택 기능 포함)을 처음부터 모두 만들어 둔다.
-- * 데이터베이스(godsang)와 접속 계정(godsang)은 docker run 의
--   MYSQL_DATABASE / MYSQL_USER 환경변수로 자동 생성된다.
-- =====================================================================

SET NAMES utf8mb4;
USE godsang;

-- ---------------------------------------------------------------------
-- 1. 회원 (gt-auth 사용)
--    login_id, name 은 UNIQUE → 서버 중복확인 + DB 제약으로 이중 보호
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  login_id      VARCHAR(20)  NOT NULL UNIQUE COMMENT '로그인 아이디 (영문 소문자+숫자 4~20자)',
  password_hash VARCHAR(100) NOT NULL        COMMENT 'bcrypt 해시 (평문 저장 금지)',
  name          VARCHAR(10)  NOT NULL UNIQUE COMMENT '화면에 표시되는 이름 (2~10자)',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 2. 과목 (gt-timer 사용)
--    삭제 시 행을 지우지 않고 is_deleted=1 (과거 기록 보존용 소프트 삭제)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subjects (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT          NOT NULL,
  name       VARCHAR(30)  NOT NULL,
  color      VARCHAR(7)   NOT NULL DEFAULT '#4F46E5' COMMENT 'HEX 색상 코드',
  is_deleted TINYINT(1)   NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_subjects_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_subjects_user (user_id, is_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 3. 공부/휴식 기록 (gt-timer 사용)
--    시간은 "시작·종료 시각"으로만 저장하고, 경과 시간은 조회 시 계산한다.
--    end_at 이 NULL 이면 현재 진행 중인 기록 (사용자당 최대 1개)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS study_records (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT                   NOT NULL,
  subject_id INT                   NULL COMMENT 'REST 기록은 NULL',
  type       ENUM('STUDY','REST')  NOT NULL,
  start_at   DATETIME              NOT NULL,
  end_at     DATETIME              NULL COMMENT 'NULL = 진행 중',
  CONSTRAINT fk_records_user    FOREIGN KEY (user_id)    REFERENCES users(id),
  CONSTRAINT fk_records_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  INDEX idx_records_user_start (user_id, start_at),
  INDEX idx_records_user_open  (user_id, end_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 4. 게시글 (gt-community 사용)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS posts (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT          NOT NULL,
  title      VARCHAR(100) NOT NULL,
  content    TEXT         NOT NULL,
  view_count INT          NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_posts_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_posts_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 5. 댓글 / 답글 (gt-community 사용)
--    parent_id 가 NULL 이면 댓글, 값이 있으면 그 댓글에 단 답글 (1단계만 허용)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comments (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  post_id    INT           NOT NULL,
  user_id    INT           NOT NULL,
  parent_id  INT           NULL,
  content    VARCHAR(1000) NOT NULL,
  is_deleted TINYINT(1)    NOT NULL DEFAULT 0,
  created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_comments_post   FOREIGN KEY (post_id)   REFERENCES posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_user   FOREIGN KEY (user_id)   REFERENCES users(id),
  CONSTRAINT fk_comments_parent FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE,
  INDEX idx_comments_post (post_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 6. (선택 기능) 오늘의 목표 순공시간
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_goals (
  user_id        INT  NOT NULL,
  goal_date      DATE NOT NULL,
  target_seconds INT  NOT NULL,
  PRIMARY KEY (user_id, goal_date),
  CONSTRAINT fk_goals_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 7. (선택 기능) 할 일 목록
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS todos (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT          NOT NULL,
  subject_id INT          NULL,
  content    VARCHAR(200) NOT NULL,
  is_done    TINYINT(1)   NOT NULL DEFAULT 0,
  todo_date  DATE         NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_todos_user    FOREIGN KEY (user_id)    REFERENCES users(id),
  CONSTRAINT fk_todos_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  INDEX idx_todos_user_date (user_id, todo_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

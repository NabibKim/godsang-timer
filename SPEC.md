# 갓생 타이머 (GodSang Timer) 구현 명세서

> 클라우드 네이티브 기말 대체 과제. 이 문서는 구현 기준서이며, 여기 적힌 이름(컨테이너, 네트워크, 경로, 테이블)을 그대로 사용한다.

---

## 0. 과제 제약 사항 (반드시 지킬 것)

- **도커 컴포즈 사용 금지.** 모든 컨테이너는 `docker network create` / `docker build` / `docker run` 명령어로만 구성한다.
- 프론트엔드는 **순수 HTML + CSS + JavaScript(jQuery 허용)** 만 사용한다. React, Vue 등 빌드가 필요한 프레임워크 금지.
  - 차트는 Chart.js를 **CDN `<script>` 태그로** 불러와 사용한다 (빌드 불필요).
- **모든 서버 코드와 프론트 핵심 코드에 한글 주석을 상세히** 단다 (함수 역할, 파라미터, 반환값, 주요 분기 이유).
- 도커 이미지는 **linux/amd64** 로 빌드해 개인 Docker Hub에 업로드한다.
  - `docker build --platform linux/amd64 -t <도커허브ID>/gt-auth:1.0 .`
- 사용한 모든 `docker build`, `docker push`, `docker run`, `docker network` 명령어를 실행 순서대로 `commands.sh`에 기록한다 (보고서에 그대로 들어감).
- 비밀번호는 반드시 **bcrypt 해시**로 저장한다. 평문 저장·평문 응답 금지.

---

## 1. 서비스 개요

| 항목 | 값 |
|---|---|
| 서비스명 | 갓생 타이머 |
| 접속 주소 | `http://godsang.com` (로컬 시연용, 아래 참고) |
| 외부 공개 포트 | `gt-proxy`의 80번만 공개 |

**도메인 처리:** `godsang.com`은 실제로 소유한 도메인이 아니므로 **브라우저를 실행하는 PC**의 hosts 파일에 아래 한 줄을 추가해 사용한다. 브라우저가 VM 밖(호스트 PC)에 있으면 `127.0.0.1` 대신 **VM의 IP**(`hostname -I`로 확인)를 적는다. nginx에는 `server_name godsang.com localhost;`로 설정해 `http://localhost`로도 접속되게 한다.

```
<VM IP 또는 127.0.0.1>   godsang.com
```
- Windows: `C:\Windows\System32\drivers\etc\hosts` / macOS·Linux: `/etc/hosts`

---

## 2. 컨테이너 구성

| 컨테이너명 | 역할 | 기술 | 내부 포트 | 이미지 |
|---|---|---|---|---|
| `gt-proxy` | 역방향 프록시, timer 로드밸런서 | nginx | 80 (외부 80:80) | `<ID>/gt-proxy:1.0` |
| `gt-front` | 정적 HTML/CSS/JS 제공 | nginx | 80 | `<ID>/gt-front:1.0` |
| `gt-auth` | 회원가입, 로그인, 로그아웃, 세션 발급, 마이페이지 | PHP 8.2 + Apache | 80 | `<ID>/gt-auth:1.0` |
| `gt-timer_1`, `gt-timer_2`, `gt-timer_3` | 과목, 타이머 기록, 통계 (**같은 이미지 3개 실행, 별칭 `timer_pool`**) | Python Flask | 5000 | `<ID>/gt-timer:1.0` |
| `gt-community` | 게시글, 댓글, 검색 | PHP 8.2 + Apache | 80 | `<ID>/gt-community:1.0` |
| `gt-redis` | 세션 공유 저장소 | Redis (공식 이미지) | 6379 | `redis:7` |
| `gt-db` | 데이터베이스 (init.sql 포함) | MySQL 8.0 | 3306 | `<ID>/gt-db:1.0` |

**베이스 이미지 (Dockerfile의 `FROM`)**

| 이미지 | 베이스 | 비고 |
|---|---|---|
| gt-proxy | `nginx:1.28` | `nginx.conf`만 복사 (upstream `resolve` 기능 사용) |
| gt-front | `nginx:1.28` | 정적 파일만 복사 |
| gt-auth, gt-community | `php:8.2-apache` | `docker-php-ext-install pdo_mysql`, `pecl install redis && docker-php-ext-enable redis`, `a2enmod rewrite` |
| gt-timer | `python:3.12-slim` | `pip install flask pymysql redis bcrypt gunicorn`, gunicorn으로 실행 |
| gt-db | `mysql:8.0` | `init.sql`을 `/docker-entrypoint-initdb.d/`에 COPY → 도커 허브 이미지만으로 테이블 자동 생성 |
| gt-redis | `redis:7` 공식 이미지 그대로 | 직접 빌드하지 않음 |

- 과제 검증에서 `docker exec -it <컨테이너> bash`를 요구하므로 **alpine 계열 이미지는 쓰지 않는다** (bash가 없음).

**PHP 서버 구현 규칙 (gt-auth, gt-community 공통)**

- 프레임워크 없이 순수 PHP로 작성한다. DB는 **PDO + prepared statement**만 사용한다 (SQL 인젝션 방지).
- Apache `mod_rewrite`와 `.htaccess`로 모든 요청을 `index.php`로 보내고, `index.php`에서 `$_SERVER['REQUEST_METHOD']`와 경로(예: `/api/community/posts/3`)를 보고 해당 함수로 분기하는 **간단한 라우터**를 만든다.
- 요청 본문은 `json_decode(file_get_contents('php://input'), true)`로 읽고, 응답은 `header('Content-Type: application/json; charset=utf-8')` + `json_encode($data, JSON_UNESCAPED_UNICODE)`로 보낸다.
- 비밀번호는 `password_hash($pw, PASSWORD_BCRYPT)` / `password_verify()`를 사용한다. Flask 쪽에서 같은 해시를 검증할 일은 없지만, 두 언어 모두 bcrypt 표준 형식(`$2y$`)이라 호환된다.
- 세션은 phpredis 확장(`new Redis()`)으로 5장의 규약대로 직접 읽고 쓴다.

- `gt-db`는 볼륨 `gt-db-data`를 `/var/lib/mysql`에 마운트해 데이터 영속성을 보장한다.
- 초기 테이블 생성 SQL은 `db/init.sql`이며 gt-db 이미지 안에 포함한다. (볼륨이 비어 있을 때만 실행되므로 선택 기능 테이블까지 처음부터 모두 생성)
- 서버의 DB·Redis 접속 정보는 코드에 하드코딩하지 말고 `docker run -e` 환경변수로 주입한다 (`DB_HOST=gt-db`, `REDIS_HOST=gt-redis` 등).
- timer 컨테이너 3개에는 `--network-alias timer_pool` 을 똑같이 붙여 하나의 묶음으로 만든다. 처리한 컨테이너는 hostname(컨테이너 ID)으로 구분한다.

---

## 3. 네트워크 구성

| 컨테이너 | `gt-front-net` | `gt-back-net` |
|---|:---:|:---:|
| gt-proxy | O | |
| gt-front | O | |
| gt-auth | O | O |
| gt-timer_1, 2, 3 | O (별칭 timer_pool) | O |
| gt-community | O | O |
| gt-redis | | O |
| gt-db | | O |

- 목적: 외부와 맞닿은 proxy·front는 DB·Redis에 접근할 수 없도록 계층을 분리한다.
- gt-auth, gt-community 는 `docker run` 에 `--network` 를 두 번 지정한다. gt-timer_1~3 은 `--network gt-front-net --network-alias timer_pool` 로 실행한 뒤 `docker network connect gt-back-net` 으로 두 번째 네트워크에 연결한다. (별칭이 front 네트워크에 붙어야 proxy 가 찾을 수 있음)
- **실행 순서:** 네트워크 생성 → `gt-db`, `gt-redis` → `gt-auth`, `gt-timer_1~3`, `gt-community` → `gt-front` → **`gt-proxy`는 마지막** (nginx는 기동 시 upstream 호스트를 찾지 못하면 종료됨).

---

## 4. 요청 흐름과 프록시 라우팅

브라우저는 모든 요청을 `godsang.com`(gt-proxy) 한 곳으로 보낸다. 화면(HTML/JS)은 gt-front에서, 데이터(JSON)는 각 API 서버에서 받아 **브라우저의 JS가 화면에 합친다.** gt-front와 API 서버는 서로 통신하지 않는다.

| 요청 경로 | 전달 대상 | 응답 |
|---|---|---|
| `/api/auth/*` | `gt-auth:80` | JSON |
| `/api/timer/*` | `timer_backend` → `timer_pool` (gt-timer_1~3, 라운드로빈) | JSON |
| `/api/community/*` | `gt-community:80` | JSON |
| 그 외 모든 경로 (`/`, `/home/`, `/community/` …) | `gt-front:80` | HTML/CSS/JS |

```nginx
upstream timer_backend {
    zone timer_backend 64k;
    server timer_pool:5000 resolve;   # 별칭 하나로 3개 컨테이너를 모두 찾음
}
```

---

## 5. 세션 공유 규약 (모든 서버가 동일하게 따름)

PHP와 Flask의 기본 세션 형식이 서로 다르므로 **언어 기본 세션(PHP `session_start()`/`$_SESSION`, Flask session)을 쓰지 않고** 아래 규약을 직접 구현한다.

| 항목 | 값 |
|---|---|
| 쿠키 이름 | `GT_SID` |
| 쿠키 옵션 | `HttpOnly`, `Path=/`, `SameSite=Lax` |
| 세션 ID | 로그인 시 gt-auth가 생성하는 랜덤 UUID |
| `mypageVerifiedUntil` | 마이페이지 재확인 만료 시각 (유닉스 타임스탬프, 초) |
| Redis 키 | `session:<GT_SID>` |
| Redis 값 (JSON 문자열) | `{"userId": 1, "loginId": "hong", "name": "홍길동", "loginAt": "2026-11-22T17:00:00+09:00", "mypageVerifiedUntil": null}` |
| 만료 시간 | 2시간 (`EX 7200`), 요청이 올 때마다 만료 시간 연장 |

- **세션 생성·삭제는 gt-auth만** 한다 (로그인 / 로그아웃 / 개인정보 수정 시 갱신).
- gt-timer, gt-community는 매 요청마다 쿠키의 `GT_SID`로 Redis를 조회한다. 세션이 없으면 `401 {"message": "로그인이 필요합니다."}`를 반환한다.
- 각 서버에 인증 공통 함수(PHP 공통 함수 `require_login()`을 `lib/session.php`에 작성, Flask 데코레이터 `@login_required`)를 만들어 사용한다.
- **로드밸런싱·세션 공유 시연용:** gt-timer의 모든 응답에 `X-Served-By: <컨테이너 hostname(ID)>` 헤더를 넣는다. 프론트 화면 하단(푸터)과 홈의 세션 공유 확인 패널에 표시한다. 새로고침할 때마다 서버 이름은 바뀌지만 로그인은 유지되는 것을 영상으로 보여 주기 위함이다.

---

## 6. 페이지 구성 (프론트 URL)

| URL | 화면 | 로그인 필요 |
|---|---|:---:|
| `/` | 로그인 / 회원가입 | X |
| `/home/` | 홈 (타이머) | O |
| `/community/` | 게시글 목록 | O |
| `/community/post.html?id={postId}` | 게시글 상세 | O |
| `/community/write.html` | 글쓰기 (`?id=` 있으면 수정 모드) | O |
| `/stats/` | 통계 | O |
| `/mypage/` | 마이페이지 | O (+ 비밀번호 재확인) |

- 로그인이 필요한 페이지는 로드 시 `GET /api/auth/me`를 호출해 401이면 `/`로 이동시킨다.
- 이미 로그인된 상태로 `/`에 접속하면 `/home/`으로 이동시킨다.
- 공통 상단바·푸터는 `common/layout.js`(`GT.initLayout`)로 만들어 모든 페이지에서 재사용한다. 공통 API 함수는 `common/api.js`.

### 공통 상단바 (로그인 후 모든 페이지에 표시)

- 왼쪽: 로고 "갓생 타이머" (클릭 시 `/home/`)
- 가운데: 메뉴 **홈 / 커뮤니티 / 통계** (현재 페이지 메뉴 강조)
- 오른쪽: **`{사용자 이름}`님** (클릭 시 마이페이지) | **로그아웃** 버튼

---

## 7. 기능 명세

### 7-1. 로그인 / 회원가입 (`/`, gt-auth)

**회원가입 입력 항목:** 아이디, 비밀번호, 비밀번호 확인, 이름

| 항목 | 규칙 | 중복 확인 |
|---|---|---|
| 아이디 (`login_id`) | 영문 소문자·숫자 4~20자 | **필수.** [중복확인] 버튼 |
| 비밀번호 | 8자 이상, 영문+숫자 포함 | 하지 않음 (아래 참고) |
| 이름 (`name`) | 2~10자, 화면에 표시되는 이름 | **필수.** [중복확인] 버튼 |

- **비밀번호는 중복 검사 대상이 아니다.** 다른 사람과 비밀번호가 같은지 알려 주면 그 자체가 보안 문제가 된다.
- 중복확인을 통과한 뒤 값을 수정하면 다시 중복확인을 해야 한다. 프론트에서 확인 상태를 초기화한다.
- 중복확인을 하지 않았으면 [가입하기] 버튼을 비활성화한다. 서버에서도 가입 시점에 한 번 더 중복을 검사한다 (DB `UNIQUE` 제약).
- 로그인 성공 → `GT_SID` 쿠키 발급 → `/home/`으로 이동
- 로그인 실패 시 "아이디 또는 비밀번호가 올바르지 않습니다." (어느 쪽이 틀렸는지 구분하지 않음)

### 7-2. 홈 / 타이머 (`/home/`, gt-timer)

**용어 정의 (코드·화면·보고서에서 동일하게 사용)**

| 용어 | 정의 |
|---|---|
| 순공시간 | 오늘 기록 중 `type = STUDY`의 시간 합 |
| 쉬는시간 | 오늘 기록 중 `type = REST`의 시간 합 |
| 총 공부시간 | 순공시간 + 쉬는시간 |
| 순공 비율 | 순공시간 ÷ 총 공부시간 × 100 (%) |

**화면 구성 (위에서 아래 순서)**

1. **오늘 요약 카드:** 총 공부시간 / 순공시간 / 쉬는시간 / 순공 비율. 순공·휴식 비율은 가로 막대로 함께 표시한다.
2. **메인 타이머:** 현재 진행 중인 상태(공부 중 - 과목명 / 쉬는 중 / 대기)와 경과 시간을 `HH:MM:SS`로 크게 표시한다.
3. **과목 목록:** 과목마다 [이름, 색상, 오늘 누적 순공시간, ▶시작 / ■정지 버튼, 수정, 삭제]를 보여 준다. [+ 과목 추가] 버튼이 있다.
4. **[오늘 공부 종료]** 버튼
5. **오늘의 기록 표:** 유형(공부/휴식), 과목, 시작 시각, 종료 시각, 소요 시간. 최신순으로 정렬한다.

**타이머 동작 규칙**

- **동시에 진행되는 기록은 하나뿐이다.** 공부와 휴식, 서로 다른 과목이 동시에 진행되지 않는다.
- 과목 A의 ▶시작 → STUDY 기록이 시작된다. 진행 중인 REST 기록이 있으면 먼저 종료한다.
- 과목 A 공부 중 과목 B의 ▶시작 → A의 STUDY를 종료하고 곧바로 B의 STUDY를 시작한다 (휴식 없음).
- ■정지 → 진행 중인 STUDY를 종료하고 **REST 기록이 자동으로 시작**된다 (쉬는시간 타이머 작동).
- **[오늘 공부 종료]** → 진행 중인 STUDY 또는 REST를 종료하고 대기 상태가 된다. 이 버튼이 없으면 자리를 비운 밤새 쉬는시간이 계속 쌓인다.
- **시간은 서버에 시작·종료 시각으로 저장한다.** 프론트는 1초마다 `현재 시각 - start_at`을 계산해 화면에만 표시한다. 1초 단위로 서버에 값을 보내지 않는다.
- 새로고침하거나 브라우저를 껐다 켜도, `end_at`이 비어 있는 진행 중 기록을 불러와 이어서 표시한다.
- 날짜 기준은 **시작 시각의 날짜(자정 기준, Asia/Seoul)** 로 한다. 자정을 넘긴 기록은 시작한 날짜에 포함한다.
- 과목을 삭제해도 과거 기록은 남긴다 (`subjects.is_deleted = 1`로 처리하는 소프트 삭제). 기록 표에는 "(삭제된 과목)"으로 표시한다.
- 같은 사용자 안에서 과목 이름은 중복될 수 없다.

### 7-3. 커뮤니티 (`/community/`, gt-community)

**목록 화면 (`/community/`)**

- 게시글 목록: 번호, 제목 (댓글 수 `[3]`), 작성자 이름, 작성일, 조회수. **최신순, 한 페이지 10개, 하단에 페이지 번호**를 표시한다.
- 목록 아래에 **검색창** [제목 / 내용 / 제목+내용 선택] + [검색] 버튼, 그 오른쪽에 **[글쓰기]** 버튼을 둔다.

**상세 화면 (`/community/post.html?id=`)**

1. 제목, 작성자, 작성일, 조회수, 본문을 보여 준다. 본인 글이면 [수정] [삭제] 버튼을 표시한다.
   - 상세 화면에 들어올 때마다 조회수를 1 올린다.
2. **댓글 영역:** 댓글 목록과 댓글 작성창
   - 각 댓글에 [답글] 버튼 → 바로 아래에 답글 작성창이 열린다.
   - **답글(대댓글)은 1단계까지만** 허용한다. 답글에는 다시 답글을 달 수 없다. 답글은 원 댓글 아래에 들여쓰기로 표시한다.
   - 본인 댓글은 삭제할 수 있다. 답글이 달린 댓글을 삭제하면 "삭제된 댓글입니다."로 표시하고 답글은 유지한다.
3. **그 아래에 게시글 목록**을 목록 화면과 동일하게 다시 표시한다. 현재 보고 있는 글은 강조하고, 다른 글을 클릭하면 해당 상세로 이동한다.

**글쓰기 화면 (`/community/write.html`)**

- 입력: 제목 (1~100자), 내용 (1~5000자). [등록] [취소] 버튼
- `?id=`가 있으면 기존 글을 불러와 **수정 모드**로 동작한다 (본인 글만 가능).
- 서버는 수정·삭제 요청 시 **작성자 본인인지 세션으로 검증**한다 (아니면 403).
- 게시글·댓글은 화면에 출력할 때 HTML 이스케이프 처리한다 (XSS 방지, jQuery `.text()` 사용).

### 7-4. 통계 (`/stats/`, gt-timer)

- 기간 선택: **[이번 주] [지난 주] [최근 7일]** 버튼. 기본값은 최근 7일
- **요약 카드:** 기간 총 공부시간 / 순공시간 / 쉬는시간 / 평균 순공 비율 / 일평균 순공시간
- **차트 1 (일별 누적 막대):** x축은 날짜, 막대 하나에 순공(아래)과 쉬는시간(위)을 누적한다. 공부하지 않은 날은 0으로 표시한다.
- **차트 2 (도넛):** 기간 전체의 순공 : 쉬는시간 비율
- **차트 3 (과목별 가로 막대):** 기간 동안 과목별 순공시간
- **일별 표:** 날짜, 총 공부시간, 순공시간, 쉬는시간, 순공 비율

### 7-5. 마이페이지 (`/mypage/`, gt-auth + gt-community)

**진입 절차**

1. 상단바의 사용자 이름을 클릭하면 `/mypage/`로 이동하고, 먼저 **비밀번호 확인 화면**을 보여 준다.
2. `POST /api/auth/verify-password`로 서버에서 확인한다. 맞으면 세션의 `mypageVerifiedUntil`을 현재 시각 + 10분으로 저장한다.
3. 개인정보 조회·수정 API는 `mypageVerifiedUntil`이 유효할 때만 동작한다 (아니면 403). **프론트에서만 막지 않는다.**

**개인정보 수정**

- 아이디 변경: 중복확인 필수
- 이름 변경: 중복확인 필수
- 비밀번호 변경: [현재 비밀번호, 새 비밀번호, 새 비밀번호 확인]. 기존 비밀번호는 **화면에 절대 표시하지 않는다.**
- 수정에 성공하면 Redis 세션의 `loginId`, `name`도 갱신해서, 상단바 이름이 바로 바뀌게 한다.

**내 활동**

- **내가 쓴 글** 탭: 제목, 작성일, 댓글 수. 클릭하면 상세로 이동한다.
- **내가 쓴 댓글** 탭: 댓글 내용, 원 게시글 제목, 작성일. 클릭하면 해당 게시글로 이동한다.
- 이 목록 API는 gt-community가 제공한다.

---

## 8. API 목록

모든 요청·응답은 JSON이다. 실패 시 `{"message": "사용자에게 보여 줄 한글 메시지"}`를 반환한다.

### gt-auth (`/api/auth`)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/check-id?loginId=` | 아이디 중복 확인 → `{available: true/false}` |
| GET | `/check-name?name=` | 이름 중복 확인 |
| POST | `/signup` | 회원가입 `{loginId, password, name}` |
| POST | `/login` | 로그인, `GT_SID` 쿠키 발급 |
| POST | `/logout` | Redis 세션 삭제, 쿠키 만료 |
| GET | `/me` | 현재 로그인 사용자 `{userId, loginId, name}` |
| POST | `/verify-password` | 마이페이지 진입용 비밀번호 확인 |
| GET | `/profile` | 내 정보 조회 (재확인 필요) |
| PUT | `/profile` | 아이디·이름 수정 (재확인 필요) |
| PUT | `/password` | 비밀번호 변경 (재확인 필요) |

### gt-timer (`/api/timer`)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/subjects` | 내 과목 목록 + 과목별 오늘 순공시간 |
| POST | `/subjects` | 과목 추가 `{name, color}` |
| PUT | `/subjects/{id}` | 과목 수정 |
| DELETE | `/subjects/{id}` | 과목 삭제 (소프트 삭제) |
| GET | `/status` | 현재 진행 중인 기록 (없으면 `null`) |
| POST | `/start` | 공부 시작 `{subjectId}` (진행 중 기록 자동 종료) |
| POST | `/stop` | 공부 정지 → 휴식 자동 시작 |
| POST | `/finish` | 오늘 공부 종료 (진행 중 기록 종료) |
| GET | `/today` | 오늘 요약 + 오늘 기록 목록 |
| GET | `/stats?from=YYYY-MM-DD&to=YYYY-MM-DD` | 기간 통계 (일별, 과목별, 합계) |

### gt-community (`/api/community`)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/posts?page=&type=title\|content\|all&keyword=` | 목록 + 검색 |
| GET | `/posts/{id}` | 상세 (조회수 +1) |
| POST | `/posts` | 글 작성 |
| PUT | `/posts/{id}` | 글 수정 (본인만) |
| DELETE | `/posts/{id}` | 글 삭제 (본인만) |
| GET | `/posts/{id}/comments` | 댓글·답글 목록 |
| POST | `/posts/{id}/comments` | 댓글 작성 `{content, parentId(답글이면)}` |
| DELETE | `/comments/{id}` | 댓글 삭제 (본인만) |
| GET | `/my/posts` | 내가 쓴 글 |
| GET | `/my/comments` | 내가 쓴 댓글 |

---

## 9. DB 스키마 (`gt-db`, 데이터베이스명 `godsang`)

```sql
CREATE TABLE users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  login_id      VARCHAR(20)  NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  name          VARCHAR(10)  NOT NULL UNIQUE,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE subjects (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  name       VARCHAR(30) NOT NULL,
  color      VARCHAR(7)  NOT NULL DEFAULT '#4F46E5',
  is_deleted TINYINT(1)  NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE study_records (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  subject_id INT NULL,                       -- REST 기록은 NULL
  type       ENUM('STUDY','REST') NOT NULL,
  start_at   DATETIME NOT NULL,
  end_at     DATETIME NULL,                  -- NULL이면 진행 중
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (subject_id) REFERENCES subjects(id),
  INDEX idx_user_start (user_id, start_at)
);

CREATE TABLE posts (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  title      VARCHAR(100) NOT NULL,
  content    TEXT NOT NULL,
  view_count INT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE comments (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  post_id    INT NOT NULL,
  user_id    INT NOT NULL,
  parent_id  INT NULL,                       -- 답글이면 원 댓글 id (1단계만)
  content    VARCHAR(1000) NOT NULL,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (parent_id) REFERENCES comments(id)
);
```

- DB 서버와 컨테이너의 타임존은 `Asia/Seoul`로 맞춘다 (`-e TZ=Asia/Seoul`, MySQL `--default-time-zone=+09:00`).
- 문자셋은 `utf8mb4`를 사용한다.

---

## 10. 폴더 구조

```
godsang-timer/
├── proxy/      (Dockerfile, nginx.conf)
├── front/      (Dockerfile, index.html, home/, community/, stats/, mypage/, common/)
├── auth/       (Dockerfile, .htaccess, index.php(라우터), lib/db.php, lib/session.php, controllers/ ...)
├── timer/      (Dockerfile, requirements.txt, app.py, ...)
├── community/  (Dockerfile, .htaccess, index.php(라우터), lib/db.php, lib/session.php, controllers/ ...)
├── db/         (init.sql)
├── commands.sh (실행 순서대로 정리한 전체 docker 명령어)
└── README.md
```

---

## 11. 구현 우선순위

1. 9개 컨테이너 기동 + 네트워크 분리 + 회원가입·로그인 + Redis 세션 공유 + 처리 서버 표시
2. 과목 CRUD + 타이머(시작·정지·휴식·종료) + 오늘 요약·기록
3. 커뮤니티 목록·상세·글쓰기·수정·삭제·검색 + 댓글·답글
4. 통계 페이지 (차트 3종)
5. 마이페이지 (비밀번호 재확인, 정보 수정, 내 활동)
6. **선택 (시간이 남으면):** 공부 랭킹(오늘·이번 주 순공 TOP 10, 커뮤니티 화면), 캘린더, 할 일 목록, 오늘의 목표 순공시간과 달성률

---

## 12. 시연·검증 체크리스트 (보고서 별첨용)

- [ ] `commands.sh`의 명령어를 순서대로 실행해 컨테이너 기동
- [ ] `docker ps`에 9개 컨테이너 표시
- [ ] `docker network inspect gt-front-net`, `docker network inspect gt-back-net` 캡처
- [ ] `docker exec -it gt-auth bash` 캡처 (모든 직접 만든 이미지는 bash가 있는 Debian 계열 베이스 사용)
- [ ] `gt-proxy` 안에서 `ping gt-db` 실패 → 네트워크 격리 증명
- [ ] 로그인 후 새로고침 시 `처리 서버`가 timer-1/2/3으로 바뀌는데 로그인 유지 → 세션 공유 증명
- [ ] `docker exec -it gt-redis redis-cli KEYS "session:*"` 로 세션 저장 확인
- [ ] `docker stop gt-db` → 같은 `docker run` 명령으로 재실행 → 기존 회원·기록 유지 → 영속성 증명

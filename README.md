# 갓생 타이머 (GodSang Timer)

과목별 공부 시간을 측정하고, 공부를 멈추면 쉬는 시간을 자동으로 측정해 순공시간 비율과 주간 통계를 보여 주는 웹 서비스.
도커 컨테이너 9개(timer 3대 포함)로 구성한 마이크로서비스 구조이며, 도커 컴포즈 없이 `docker network / build / run` 명령어만으로 구축한다.

## 구성

| 컨테이너 | 역할 | 기술 | 네트워크 |
|---|---|---|---|
| gt-proxy | 역방향 프록시, timer 로드밸런서 (외부 80 포트) | nginx 1.28 | front |
| gt-front | 정적 화면 | nginx 1.28 + HTML / jQuery | front |
| gt-auth | 회원가입·로그인·세션 발급·마이페이지 | PHP 8.2 + Apache | front + back |
| gt-timer_1~3 | 과목·타이머·통계 (별칭 `timer_pool`) | Python 3.12 Flask | front + back |
| gt-community | 게시판·댓글·랭킹 | PHP 8.2 + Apache | front + back |
| gt-redis | 세션 공유 저장소 | Redis | back |
| gt-db | 데이터베이스 (볼륨 `gt-db-data`) | MySQL 8.0 | back |

- 설계 상세 : `SPEC.md`
- 전체 명령어 : `commands.sh`
- 도커 허브 : `kny02/gt-db`, `gt-proxy`, `gt-front`, `gt-auth`, `gt-timer`, `gt-community` (태그 `1.0`)

## 기능

- 회원가입(아이디·이름 중복확인), 로그인, 로그아웃
- 과목 추가·수정·삭제, 과목별 공부 타이머, 정지 시 쉬는시간 자동 측정, 오늘 공부 종료
- 오늘 요약(총 공부·순공·쉬는시간·순공 비율), 오늘 기록 표
- 통계 : 최근 7일 / 이번 주 / 지난 주 일별 누적 막대, 순공:휴식 도넛, 과목별 차트 (Chart.js)
- 커뮤니티 : 게시글 목록·검색·페이지, 글쓰기·수정·삭제, 댓글·답글, 순공 랭킹 TOP 10
- 마이페이지 : 비밀번호 재확인 후 아이디·이름·비밀번호 수정, 내가 쓴 글·댓글
- 세션 공유 확인 패널 : 세 서버(PHP·Python)가 같은 사용자를 인식하는지, timer 요청이 3대에 분산되는지 확인

## 실행

```bash
cd ~/godsang-timer
cp .env.example .env   # 비밀번호 설정
# commands.sh 의 1(네트워크·볼륨) → 2(빌드) → 4(컨테이너 생성) 순서로 실행
```

개발 중에는 코드 폴더를 컨테이너에 연결(`-v`)하면 빌드 없이 바로 반영된다.

| 컨테이너 | 개발용 추가 옵션 | 코드 수정 후 |
|---|---|---|
| gt-auth | `-v ~/godsang-timer/auth:/var/www/html` | 새로고침 |
| gt-community | `-v ~/godsang-timer/community:/var/www/html` | 새로고침 |
| gt-timer_1~3 | `-v ~/godsang-timer/timer:/app` | `docker restart gt-timer_1 gt-timer_2 gt-timer_3` |
| gt-front | `-v ~/godsang-timer/front:/usr/share/nginx/html` | 강력 새로고침 (Ctrl+Shift+R) |

`Dockerfile`, `requirements.txt`, `proxy/nginx.conf` 를 바꿨을 때와 도커 허브에 올리기 전에는 이미지를 다시 빌드한다.

## 접속

- `http://localhost` 또는 서버 IP
- 도메인 : hosts 파일에 `서버IP  godsang.com` 추가 후 `http://godsang.com`

## DB 백업 · 복원

```bash
docker exec gt-db mysqldump -uroot -p"$DB_ROOT_PASSWORD" godsang > godsang_backup.sql
docker exec -i gt-db mysql -uroot -p"$DB_ROOT_PASSWORD" godsang < godsang_backup.sql
```

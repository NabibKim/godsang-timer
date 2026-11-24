#!/bin/bash
# =====================================================================
# 갓생 타이머 (GodSang Timer) - docker 명령어 (실행 순서)
# ---------------------------------------------------------------------
# 구성 : 컨테이너 9개 (proxy, front, auth, timer x3, community, redis, db)
# 네트워크 : gt-front-net (요청 처리 계층), gt-back-net (데이터 계층)
# 도커 허브 : kny02/gt-*:1.0
# =====================================================================


# =====================================================================
# 0. 비밀번호 불러오기
#    .env.example 을 .env 로 복사해 비밀번호를 정한 뒤 실행한다. (.env 는 git 에 올리지 않음)
# =====================================================================
cd ~/godsang-timer
set -a; source .env; set +a


# =====================================================================
# 1. 네트워크 · 볼륨 생성
# =====================================================================
docker network create gt-front-net
docker network create gt-back-net
docker volume create gt-db-data


# =====================================================================
# 2. 이미지 빌드 (Dockerfile, amd64)
# =====================================================================
cd ~/godsang-timer
docker build -t kny02/gt-db:1.0 ./db
docker build -t kny02/gt-proxy:1.0 ./proxy
docker build -t kny02/gt-front:1.0 ./front
docker build -t kny02/gt-auth:1.0 ./auth
docker build -t kny02/gt-timer:1.0 ./timer
docker build -t kny02/gt-community:1.0 ./community


# =====================================================================
# 3. 도커 허브 업로드
# =====================================================================
docker login -u kny02
docker push kny02/gt-db:1.0
docker push kny02/gt-proxy:1.0
docker push kny02/gt-front:1.0
docker push kny02/gt-auth:1.0
docker push kny02/gt-timer:1.0
docker push kny02/gt-community:1.0


# =====================================================================
# 4. 컨테이너 생성
#    순서 : DB · Redis → API 서버 → 프론트 → 프록시(마지막)
# =====================================================================

# 4-1. DB (MySQL) : gt-back-net, 데이터는 볼륨 gt-db-data 에 저장
docker run -d --name gt-db --network gt-back-net -e MYSQL_ROOT_PASSWORD="$DB_ROOT_PASSWORD" -e MYSQL_DATABASE=godsang -e MYSQL_USER=godsang -e MYSQL_PASSWORD="$DB_PASSWORD" -v gt-db-data:/var/lib/mysql kny02/gt-db:1.0

# 4-2. 세션 공유 서버 (Redis) : gt-back-net
docker run -d --name gt-redis --network gt-back-net redis

# 4-3. 회원 · 로그인 서버 (PHP) : back + front 네트워크
docker run -d --name gt-auth --network gt-back-net --network gt-front-net -e DB_HOST=gt-db -e DB_NAME=godsang -e DB_USER=godsang -e DB_PASSWORD="$DB_PASSWORD" -e REDIS_HOST=gt-redis kny02/gt-auth:1.0

# 4-4. 타이머 서버 (Flask) 3대 : 별칭 timer_pool 로 묶어 로드밸런싱
#      네트워크 2개와 별칭을 함께 지정하면 별칭이 붙을 네트워크가 모호하므로
#      front 네트워크로 실행하며 별칭 부여 → back 네트워크는 추가 연결
docker run -d --name gt-timer_1 --network gt-front-net --network-alias timer_pool -e DB_HOST=gt-db -e DB_NAME=godsang -e DB_USER=godsang -e DB_PASSWORD="$DB_PASSWORD" -e REDIS_HOST=gt-redis kny02/gt-timer:1.0
docker network connect gt-back-net gt-timer_1

docker run -d --name gt-timer_2 --network gt-front-net --network-alias timer_pool -e DB_HOST=gt-db -e DB_NAME=godsang -e DB_USER=godsang -e DB_PASSWORD="$DB_PASSWORD" -e REDIS_HOST=gt-redis kny02/gt-timer:1.0
docker network connect gt-back-net gt-timer_2

docker run -d --name gt-timer_3 --network gt-front-net --network-alias timer_pool -e DB_HOST=gt-db -e DB_NAME=godsang -e DB_USER=godsang -e DB_PASSWORD="$DB_PASSWORD" -e REDIS_HOST=gt-redis kny02/gt-timer:1.0
docker network connect gt-back-net gt-timer_3

# 4-5. 커뮤니티 서버 (PHP) : back + front 네트워크
docker run -d --name gt-community --network gt-back-net --network gt-front-net -e DB_HOST=gt-db -e DB_NAME=godsang -e DB_USER=godsang -e DB_PASSWORD="$DB_PASSWORD" -e REDIS_HOST=gt-redis kny02/gt-community:1.0

# 4-6. 프론트 (nginx 정적 파일) : gt-front-net
docker run -d --name gt-front --network gt-front-net kny02/gt-front:1.0

# 4-7. 역방향 프록시 (nginx) : gt-front-net, 외부 80 포트 공개
docker run -d --name gt-proxy --network gt-front-net -p 80:80 kny02/gt-proxy:1.0


# =====================================================================
# 5. 동작 확인
# =====================================================================
docker ps
docker network inspect gt-front-net
docker network inspect gt-back-net
docker exec -it gt-auth bash

# 로드밸런싱 : 별칭 timer_pool 이 컨테이너 3개의 IP 로 조회되는지 확인
docker exec gt-proxy getent hosts timer_pool

# 네트워크 격리 : front 네트워크의 proxy 에서 DB 이름이 조회되지 않음
docker exec gt-proxy bash -c "getent hosts gt-db || echo 'gt-db 접근 불가 (네트워크 격리)'"

# 세션 공유 : Redis 에 저장된 로그인 세션 확인
docker exec -it gt-redis redis-cli KEYS "session:*"

# DB 데이터 영속성 : gt-db 를 삭제 후 4-1 명령으로 다시 생성해도 데이터 유지
docker exec -it gt-db mysql -ugodsang -p"$DB_PASSWORD" godsang -e "SELECT id, login_id, name FROM users;"
docker rm -f gt-db
docker run -d --name gt-db --network gt-back-net -e MYSQL_ROOT_PASSWORD="$DB_ROOT_PASSWORD" -e MYSQL_DATABASE=godsang -e MYSQL_USER=godsang -e MYSQL_PASSWORD="$DB_PASSWORD" -v gt-db-data:/var/lib/mysql kny02/gt-db:1.0
docker exec -it gt-db mysql -ugodsang -p"$DB_PASSWORD" godsang -e "SELECT id, login_id, name FROM users;"

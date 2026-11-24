# =====================================================================
# gt-db : MySQL 8.0 + 갓생 타이머 테이블 초기화 스크립트를 포함한 이미지
# ---------------------------------------------------------------------
# init.sql 을 이미지 안에 COPY 해 두었기 때문에, 도커 허브에서 이 이미지만
# 받아도(소스 폴더 없이) 테이블이 자동으로 생성된다.
# 실제 데이터는 docker run 시 볼륨(gt-db-data)에 저장되어 영속성이 유지된다.
# =====================================================================
FROM mysql:8.0

# 컨테이너 OS 시간대를 한국 시간으로 설정
ENV TZ=Asia/Seoul

# 데이터 폴더가 비어 있는 최초 기동 시 자동 실행되는 초기화 스크립트
COPY init.sql /docker-entrypoint-initdb.d/01-init.sql

# 한글(utf8mb4), 한국 시간대(+09:00), PHP/파이썬 호환 인증 방식으로 MySQL 실행
CMD ["mysqld", \
     "--character-set-server=utf8mb4", \
     "--collation-server=utf8mb4_unicode_ci", \
     "--default-time-zone=+09:00", \
     "--default-authentication-plugin=mysql_native_password"]

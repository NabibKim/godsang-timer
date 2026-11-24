"""
=====================================================================
gt-timer 설정값
---------------------------------------------------------------------
접속 정보는 코드에 적지 않고 docker run -e 로 넣은 환경변수에서 읽는다.
같은 이미지로 gt-timer_1, 2, 3 을 띄우고, 별칭 timer_pool 로 묶는다.
=====================================================================
"""
import os
import socket
from zoneinfo import ZoneInfo

# 이 요청을 처리한 컨테이너를 구분하는 값 (응답 헤더 X-Served-By 에 실린다)
# 도커는 컨테이너의 hostname 을 "컨테이너 ID 앞 12자리"로 자동 설정한다.
# → 화면에 표시된 값과 docker ps 의 CONTAINER ID 를 비교하면 어느 컨테이너가 처리했는지 알 수 있다.
SERVER_NAME = os.getenv("SERVER_NAME") or socket.gethostname()

# MySQL(gt-db) 접속 정보
DB_HOST = os.getenv("DB_HOST", "gt-db")
DB_PORT = int(os.getenv("DB_PORT", "3306"))
DB_NAME = os.getenv("DB_NAME", "godsang")
DB_USER = os.getenv("DB_USER", "godsang")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")

# Redis(gt-redis) 접속 정보
REDIS_HOST = os.getenv("REDIS_HOST", "gt-redis")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))

# 세션 규약 (gt-auth 의 lib/session.php 와 반드시 동일해야 함)
SESSION_COOKIE = "GT_SID"
SESSION_PREFIX = "session:"
SESSION_TTL = 7200

# 날짜·시간 계산 기준 시간대 (컨테이너 OS 설정과 무관하게 한국 시간 사용)
KST = ZoneInfo("Asia/Seoul")

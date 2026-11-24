# =====================================================================
# gt-timer : 과목 / 타이머 기록 / 통계 API (Python 3.12 + Flask + gunicorn)
# ---------------------------------------------------------------------
# 이 이미지 하나로 gt-timer_1, 2, 3 세 컨테이너를 실행한다.
# (docker run --network-alias timer_pool 로 세 컨테이너를 하나의 별칭으로 묶음)
# =====================================================================
FROM python:3.12-slim

ENV TZ=Asia/Seoul \
    PYTHONUNBUFFERED=1

WORKDIR /app

# 라이브러리 먼저 설치 (코드만 바뀌면 이 단계는 캐시 재사용 → 빌드가 빨라짐)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 소스 코드 복사
COPY . .

EXPOSE 5000

# gunicorn : 실서비스용 WSGI 서버, 워커 프로세스 2개로 동시 요청 처리
CMD ["gunicorn", "--workers", "2", "--bind", "0.0.0.0:5000", "--access-logfile", "-", "app:app"]

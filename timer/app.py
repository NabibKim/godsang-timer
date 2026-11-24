"""
=====================================================================
gt-timer : 과목 / 공부·휴식 기록 / 통계 API (Python Flask)
---------------------------------------------------------------------
같은 이미지로 gt-timer_1, gt-timer_2, gt-timer_3 세 컨테이너를 띄우고 (별칭 timer_pool),
gt-proxy(nginx)가 라운드로빈으로 요청을 나눠 보낸다.

어느 컨테이너가 요청을 받아도 Redis 공유 세션으로 같은 사용자를 인식한다.
→ 모든 응답 헤더에 X-Served-By(처리한 컨테이너 이름)를 실어 이를 눈으로 확인할 수 있게 한다.

API 구성
  app.py             : 공통 처리(X-Served-By 헤더, 오류 응답) + 상태·세션 공유 확인(/whoami)
  routes/subjects.py : 과목 CRUD
  routes/records.py  : 공부 시작·정지·휴식·종료, 오늘 기록
  routes/stats.py    : 기간 통계
=====================================================================
"""
import pymysql
import redis
from flask import Flask, g, jsonify
from werkzeug.exceptions import HTTPException

import config
from db import close_db
from routes.records import records_bp
from routes.stats import stats_bp
from routes.subjects import subjects_bp
from session_store import login_required

app = Flask(__name__)
app.json.ensure_ascii = False  # JSON 응답에서 한글을 \uXXXX 로 바꾸지 않음
app.teardown_appcontext(close_db)

# 기능별 API(Blueprint) 등록
app.register_blueprint(subjects_bp)
app.register_blueprint(records_bp)
app.register_blueprint(stats_bp)


# ---------------------------------------------------------------------
# 공통 처리
# ---------------------------------------------------------------------
@app.after_request
def add_served_by_header(response):
    """모든 응답에 이 요청을 처리한 컨테이너 이름을 헤더로 추가한다. (로드밸런싱 시연용)"""
    response.headers["X-Served-By"] = config.SERVER_NAME
    return response


@app.errorhandler(HTTPException)
def handle_http_error(error):
    """404, 405 같은 HTTP 오류도 HTML 이 아닌 JSON 으로 응답한다."""
    messages = {404: "요청한 API를 찾을 수 없습니다.", 405: "허용되지 않은 요청 방식입니다."}
    return jsonify(message=messages.get(error.code, error.description)), error.code


@app.errorhandler(pymysql.MySQLError)
def handle_db_error(error):
    """DB 오류 상세는 사용자에게 숨기고 컨테이너 로그(docker logs gt-timer_1)에만 남긴다."""
    app.logger.error("[DB] %s", error)
    return jsonify(message="데이터베이스 처리 중 오류가 발생했습니다."), 500


@app.errorhandler(redis.RedisError)
def handle_redis_error(error):
    app.logger.error("[Redis] %s", error)
    return jsonify(message="세션 서버에 연결할 수 없습니다."), 500


# ---------------------------------------------------------------------
# 상태 확인 / 세션 공유 확인
# ---------------------------------------------------------------------
@app.get("/api/timer/health")
def health():
    """서버 동작 확인용 (로그인 불필요)"""
    return jsonify(server=config.SERVER_NAME, status="ok")


@app.get("/api/timer/whoami")
@login_required
def whoami():
    """
    gt-auth(PHP)가 만든 세션을 gt-timer(Python)가 읽을 수 있는지 확인한다.
    새로고침할 때마다 server 값(컨테이너 ID)은 세 가지가 번갈아 바뀌지만 user 는 같아야 한다.
    → "서버 분산 + 이기종 서버 간 세션 공유" 동시 증명
    """
    return jsonify(
        server=config.SERVER_NAME,
        user={
            "userId": g.user.get("userId"),
            "loginId": g.user.get("loginId"),
            "name": g.user.get("name"),
        },
    )


if __name__ == "__main__":
    # 로컬 테스트용 (컨테이너에서는 gunicorn 으로 실행)
    app.run(host="0.0.0.0", port=5000, debug=True)

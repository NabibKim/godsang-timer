"""
=====================================================================
Redis 공유 세션 조회 모듈  ★ 컨테이너 간 세션 공유의 핵심 ★
---------------------------------------------------------------------
세션은 gt-auth(PHP)가 로그인할 때 만들어 Redis에 JSON으로 저장한다.
gt-timer(Python)는 브라우저가 보낸 GT_SID 쿠키로 같은 Redis 키를 조회만 한다.
  쿠키 : GT_SID
  키   : session:<GT_SID>
  값   : {"userId":1,"loginId":"hong","name":"홍길동", ...}
Flask 기본 세션은 사용하지 않는다. (PHP와 형식이 달라 서로 읽을 수 없기 때문)
=====================================================================
"""
import json
import re
from functools import wraps

import redis
from flask import g, jsonify, request

import config

# decode_responses=True : Redis 값을 bytes 가 아닌 str 로 받기
redis_client = redis.Redis(
    host=config.REDIS_HOST,
    port=config.REDIS_PORT,
    decode_responses=True,
    socket_timeout=2,
    socket_connect_timeout=2,
)

# gt-auth 가 만드는 세션 ID 형식(UUID)만 허용
SESSION_ID_PATTERN = re.compile(r"^[0-9a-f-]{36}$")


def get_session():
    """
    현재 요청의 로그인 세션을 조회한다.
    조회될 때마다 만료 시간을 2시간으로 연장한다. (gt-auth 와 동일한 슬라이딩 만료)

    :return: 세션 딕셔너리, 로그인하지 않았으면 None
    """
    session_id = request.cookies.get(config.SESSION_COOKIE, "")
    if not SESSION_ID_PATTERN.match(session_id):
        return None

    key = config.SESSION_PREFIX + session_id
    raw = redis_client.get(key)
    if raw is None:
        return None  # 만료되었거나 로그아웃된 세션

    redis_client.expire(key, config.SESSION_TTL)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def login_required(view_func):
    """
    로그인이 필요한 API 에 붙이는 데코레이터.
    로그인하지 않았으면 401 을 응답하고, 로그인했으면 g.user 에 세션을 넣고 원래 함수를 실행한다.

    사용 예)
        @app.get("/api/timer/subjects")
        @login_required
        def list_subjects():
            user_id = g.user["userId"]
    """
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        session = get_session()
        if session is None:
            return jsonify(message="로그인이 필요합니다."), 401
        g.user = session
        return view_func(*args, **kwargs)

    return wrapper

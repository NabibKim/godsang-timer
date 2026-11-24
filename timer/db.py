"""
=====================================================================
MySQL(gt-db) 연결 모듈
---------------------------------------------------------------------
요청 하나마다 연결을 하나 열고, 요청이 끝나면 닫는다. (Flask 의 g 객체에 보관)
컨테이너 이름 gt-db 가 곧 호스트명 → 도커 네트워크(gt-back-net)의 내장 DNS가 IP로 변환
=====================================================================
"""
import pymysql
from flask import g

import config


def get_db():
    """현재 요청에서 사용할 DB 연결을 반환한다. 처음 호출될 때만 새로 연결한다."""
    if "db" not in g:
        g.db = pymysql.connect(
            host=config.DB_HOST,
            port=config.DB_PORT,
            user=config.DB_USER,
            password=config.DB_PASSWORD,
            database=config.DB_NAME,
            charset="utf8mb4",
            cursorclass=pymysql.cursors.DictCursor,  # 결과를 {'컬럼명': 값} 딕셔너리로 받기
            autocommit=True,                         # 여러 쿼리를 묶어야 할 때만 직접 트랜잭션 사용
            init_command="SET time_zone = '+09:00'", # DB 세션 시간대를 한국 시간으로 고정
            connect_timeout=3,
        )
    return g.db


def close_db(_exception=None):
    """요청 처리가 끝나면 DB 연결을 닫는다. (app.teardown_appcontext 에 등록)"""
    db = g.pop("db", None)
    if db is not None:
        db.close()

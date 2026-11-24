"""
=====================================================================
공부·휴식 기록 API  (/api/timer/...)
---------------------------------------------------------------------
  GET  /api/timer/status   지금 진행 중인 기록 (없으면 null)
  POST /api/timer/start    공부 시작   {"subjectId": 3}
  POST /api/timer/stop     공부 정지 → 휴식(REST) 자동 시작
  POST /api/timer/finish   오늘 공부 종료 (진행 중인 기록을 닫고 대기 상태)
  GET  /api/timer/today    오늘 요약(총 공부·순공·휴식·순공 비율) + 오늘 기록 목록

타이머 규칙
  * 사용자당 진행 중인 기록(end_at IS NULL)은 항상 최대 1개
  * 시간은 1초마다 저장하지 않고 "시작·종료 시각"만 저장 → 경과 시간은 조회할 때 계산
  * 그래서 새로고침하거나 브라우저를 꺼도 시간이 끊기지 않는다.
=====================================================================
"""
from flask import Blueprint, g, jsonify, request

from db import get_db
from routes.subjects import find_my_subject
from session_store import login_required
from time_utils import day_range, now_kst, to_iso

records_bp = Blueprint("records", __name__, url_prefix="/api/timer")


# ---------------------------------------------------------------------
# 내부 도우미 함수
# ---------------------------------------------------------------------
def get_open_record(cur, user_id, lock=False):
    """
    진행 중인 기록 1개를 조회한다. (과목 이름·색상 포함)

    :param lock: True 면 SELECT ... FOR UPDATE 로 잠가서
                 같은 사용자의 요청이 서로 다른 timer 컨테이너에서 동시에 처리돼도
                 진행 중인 기록이 2개가 되지 않게 한다.
    """
    sql = """
        SELECT r.id, r.type, r.subject_id, r.start_at, s.name AS subject_name, s.color AS subject_color
          FROM study_records r
          LEFT JOIN subjects s ON s.id = r.subject_id
         WHERE r.user_id = %s AND r.end_at IS NULL
         ORDER BY r.id DESC
         LIMIT 1
    """
    cur.execute(sql + (" FOR UPDATE" if lock else ""), (user_id,))
    return cur.fetchone()


def close_open_records(cur, user_id, now):
    """진행 중인 기록을 모두 현재 시각으로 종료한다."""
    cur.execute(
        "UPDATE study_records SET end_at = %s WHERE user_id = %s AND end_at IS NULL",
        (now, user_id),
    )


def insert_record(cur, user_id, record_type, subject_id, now):
    """새 기록(STUDY 또는 REST)을 시작한다."""
    cur.execute(
        "INSERT INTO study_records (user_id, subject_id, type, start_at) VALUES (%s, %s, %s, %s)",
        (user_id, subject_id, record_type, now),
    )


def open_record_to_json(row):
    """진행 중인 기록을 프론트용 JSON 으로 바꾼다. 없으면 None."""
    if row is None:
        return None
    return {
        "id": row["id"],
        "type": row["type"],
        "subjectId": row["subject_id"],
        "subjectName": row["subject_name"],
        "subjectColor": row["subject_color"],
        "startAt": to_iso(row["start_at"]),
    }


def run_in_transaction(work):
    """
    work(cur) 를 하나의 트랜잭션으로 실행한다.
    "기존 기록 종료 + 새 기록 시작"처럼 함께 성공하거나 함께 취소돼야 하는 작업에 사용한다.
    """
    db = get_db()
    db.begin()
    try:
        with db.cursor() as cur:
            result = work(cur)
        db.commit()
        return result
    except Exception:
        db.rollback()
        raise


def current_state_response(message):
    """작업 후 현재 진행 상태를 함께 응답한다. (프론트는 이 값으로 바로 화면 갱신)"""
    with get_db().cursor() as cur:
        record = get_open_record(cur, g.user["userId"])
    return jsonify(message=message, record=open_record_to_json(record), serverNow=to_iso(now_kst()))


# ---------------------------------------------------------------------
# API
# ---------------------------------------------------------------------
@records_bp.get("/status")
@login_required
def status():
    """
    지금 진행 중인 기록과 서버 현재 시각을 반환한다.
    프론트는 (serverNow - startAt) 으로 경과 시간을 계산하므로 PC 시계가 틀려도 정확하다.
    """
    with get_db().cursor() as cur:
        record = get_open_record(cur, g.user["userId"])
    return jsonify(record=open_record_to_json(record), serverNow=to_iso(now_kst()))


@records_bp.post("/start")
@login_required
def start_study():
    """
    과목 공부를 시작한다.
      - 휴식 중이었다면  → 휴식 종료 후 공부 시작
      - 다른 과목 공부 중 → 그 과목 종료 후 바로 이 과목 시작 (휴식 없음)
      - 같은 과목 공부 중 → 아무것도 바꾸지 않음
    """
    user_id = g.user["userId"]
    body = request.get_json(silent=True) or {}
    subject_id = body.get("subjectId")

    if not isinstance(subject_id, int) or find_my_subject(subject_id, user_id) is None:
        return jsonify(message="과목을 찾을 수 없습니다."), 404

    def work(cur):
        now = now_kst()
        current = get_open_record(cur, user_id, lock=True)
        if current and current["type"] == "STUDY" and current["subject_id"] == subject_id:
            return "이미 공부 중인 과목입니다."
        close_open_records(cur, user_id, now)
        insert_record(cur, user_id, "STUDY", subject_id, now)
        return "공부를 시작했습니다."

    return current_state_response(run_in_transaction(work))


@records_bp.post("/stop")
@login_required
def stop_study():
    """공부를 정지한다. 정지하는 순간 휴식(REST) 기록이 자동으로 시작된다."""
    user_id = g.user["userId"]

    def work(cur):
        now = now_kst()
        current = get_open_record(cur, user_id, lock=True)
        if current is None or current["type"] != "STUDY":
            return None
        close_open_records(cur, user_id, now)
        insert_record(cur, user_id, "REST", None, now)
        return "공부를 정지했습니다. 휴식 시간을 측정합니다."

    message = run_in_transaction(work)
    if message is None:
        return jsonify(message="진행 중인 공부가 없습니다."), 400
    return current_state_response(message)


@records_bp.post("/finish")
@login_required
def finish_today():
    """
    오늘 공부를 종료한다. 진행 중인 공부 또는 휴식을 닫고 대기 상태가 된다.
    → 이 버튼이 없으면 자리를 비운 밤새 휴식 시간이 계속 쌓이게 된다.
    """
    user_id = g.user["userId"]
    run_in_transaction(lambda cur: close_open_records(cur, user_id, now_kst()))
    return current_state_response("오늘 공부를 종료했습니다. 수고했어요!")


@records_bp.get("/today")
@login_required
def today():
    """
    오늘 요약과 오늘 기록 목록(최신순)을 반환한다.
      순공시간   = STUDY 기록 합
      쉬는시간   = REST 기록 합
      총 공부시간 = 순공시간 + 쉬는시간
      순공 비율   = 순공시간 / 총 공부시간 × 100
    """
    user_id = g.user["userId"]
    now = now_kst()
    start, end = day_range(now.date())

    with get_db().cursor() as cur:
        cur.execute(
            """
            SELECT r.id, r.type, r.start_at, r.end_at,
                   TIMESTAMPDIFF(SECOND, r.start_at, IFNULL(r.end_at, %s)) AS seconds,
                   s.name AS subject_name, s.color AS subject_color, s.is_deleted AS subject_deleted
              FROM study_records r
              LEFT JOIN subjects s ON s.id = r.subject_id
             WHERE r.user_id = %s AND r.start_at >= %s AND r.start_at < %s
             ORDER BY r.start_at DESC, r.id DESC
            """,
            (now, user_id, start, end),
        )
        rows = cur.fetchall()
        current = get_open_record(cur, user_id)

    study_seconds = sum(int(r["seconds"]) for r in rows if r["type"] == "STUDY")
    rest_seconds = sum(int(r["seconds"]) for r in rows if r["type"] == "REST")
    total_seconds = study_seconds + rest_seconds

    records = [
        {
            "id": r["id"],
            "type": r["type"],
            "subjectName": r["subject_name"],
            "subjectColor": r["subject_color"],
            "subjectDeleted": bool(r["subject_deleted"]),
            "startAt": to_iso(r["start_at"]),
            "endAt": to_iso(r["end_at"]),
            "seconds": int(r["seconds"]),
        }
        for r in rows
    ]

    return jsonify(
        date=now.date().isoformat(),
        serverNow=to_iso(now),
        summary={
            "studySeconds": study_seconds,
            "restSeconds": rest_seconds,
            "totalSeconds": total_seconds,
            "studyRatio": round(study_seconds / total_seconds * 100, 1) if total_seconds else 0,
        },
        record=open_record_to_json(current),
        records=records,
    )

"""
=====================================================================
과목 API  (/api/timer/subjects)
---------------------------------------------------------------------
  GET    /api/timer/subjects        내 과목 목록 + 과목별 오늘 순공시간
  POST   /api/timer/subjects        과목 추가   {"name": "자료구조", "color": "#4F46E5"}
  PUT    /api/timer/subjects/<id>   과목 수정   (본인 과목만)
  DELETE /api/timer/subjects/<id>   과목 삭제   (소프트 삭제, 과거 기록은 보존)
=====================================================================
"""
import re

from flask import Blueprint, g, jsonify, request

from db import get_db
from session_store import login_required
from time_utils import day_range, now_kst

subjects_bp = Blueprint("subjects", __name__, url_prefix="/api/timer/subjects")

COLOR_PATTERN = re.compile(r"^#[0-9A-Fa-f]{6}$")
NAME_MAX_LENGTH = 30


def find_my_subject(subject_id, user_id):
    """
    내 과목(삭제되지 않은 것)을 조회한다. 다른 사람 과목이면 None.
    → 남의 과목 id 를 넣어 수정·삭제하는 요청을 막는다.
    """
    with get_db().cursor() as cur:
        cur.execute(
            "SELECT id, name, color FROM subjects WHERE id = %s AND user_id = %s AND is_deleted = 0",
            (subject_id, user_id),
        )
        return cur.fetchone()


def validate_subject_body(body):
    """
    과목 입력값을 검사한다.

    :return: (name, color, 오류메시지)  오류가 없으면 오류메시지는 None
    """
    name = str(body.get("name", "")).strip()
    color = str(body.get("color", "#4F46E5")).strip()

    if not 1 <= len(name) <= NAME_MAX_LENGTH:
        return name, color, f"과목 이름은 1~{NAME_MAX_LENGTH}자로 입력해 주세요."
    if not COLOR_PATTERN.match(color):
        return name, color, "색상 형식이 올바르지 않습니다."
    return name, color.upper(), None


def is_subject_name_taken(user_id, name, exclude_id=0):
    """같은 사용자 안에서 과목 이름이 겹치는지 확인한다. (삭제된 과목은 제외)"""
    with get_db().cursor() as cur:
        cur.execute(
            "SELECT id FROM subjects WHERE user_id = %s AND name = %s AND is_deleted = 0 AND id <> %s",
            (user_id, name, exclude_id),
        )
        return cur.fetchone() is not None


@subjects_bp.get("")
@login_required
def list_subjects():
    """
    내 과목 목록과 과목별 "오늘" 순공시간(초)을 반환한다.
    진행 중인 기록(end_at 이 NULL)은 현재 시각까지의 시간으로 계산한다.
    """
    user_id = g.user["userId"]
    now = now_kst()
    start, end = day_range(now.date())

    with get_db().cursor() as cur:
        cur.execute(
            """
            SELECT s.id, s.name, s.color,
                   COALESCE(SUM(TIMESTAMPDIFF(SECOND, r.start_at, IFNULL(r.end_at, %s))), 0) AS today_seconds
              FROM subjects s
              LEFT JOIN study_records r
                     ON r.subject_id = s.id AND r.type = 'STUDY'
                    AND r.start_at >= %s AND r.start_at < %s
             WHERE s.user_id = %s AND s.is_deleted = 0
             GROUP BY s.id, s.name, s.color
             ORDER BY s.created_at, s.id
            """,
            (now, start, end, user_id),
        )
        rows = cur.fetchall()

    subjects = [
        {"id": r["id"], "name": r["name"], "color": r["color"], "todaySeconds": int(r["today_seconds"])}
        for r in rows
    ]
    return jsonify(subjects=subjects)


@subjects_bp.post("")
@login_required
def create_subject():
    """과목을 추가한다."""
    user_id = g.user["userId"]
    name, color, error = validate_subject_body(request.get_json(silent=True) or {})
    if error:
        return jsonify(message=error), 400
    if is_subject_name_taken(user_id, name):
        return jsonify(message="이미 같은 이름의 과목이 있습니다."), 409

    with get_db().cursor() as cur:
        cur.execute(
            "INSERT INTO subjects (user_id, name, color) VALUES (%s, %s, %s)",
            (user_id, name, color),
        )
        new_id = cur.lastrowid

    return jsonify(message="과목이 추가되었습니다.", subject={"id": new_id, "name": name, "color": color}), 201


@subjects_bp.put("/<int:subject_id>")
@login_required
def update_subject(subject_id):
    """과목 이름·색상을 수정한다. (본인 과목만)"""
    user_id = g.user["userId"]
    if find_my_subject(subject_id, user_id) is None:
        return jsonify(message="과목을 찾을 수 없습니다."), 404

    name, color, error = validate_subject_body(request.get_json(silent=True) or {})
    if error:
        return jsonify(message=error), 400
    if is_subject_name_taken(user_id, name, subject_id):
        return jsonify(message="이미 같은 이름의 과목이 있습니다."), 409

    with get_db().cursor() as cur:
        cur.execute("UPDATE subjects SET name = %s, color = %s WHERE id = %s", (name, color, subject_id))

    return jsonify(message="과목이 수정되었습니다.")


@subjects_bp.delete("/<int:subject_id>")
@login_required
def delete_subject(subject_id):
    """
    과목을 삭제한다. 실제로 지우지 않고 is_deleted = 1 로 표시한다. (소프트 삭제)
    → 이 과목으로 공부한 과거 기록과 통계는 그대로 남는다.
    지금 공부 중인 과목은 먼저 정지해야 삭제할 수 있다.
    """
    user_id = g.user["userId"]
    if find_my_subject(subject_id, user_id) is None:
        return jsonify(message="과목을 찾을 수 없습니다."), 404

    with get_db().cursor() as cur:
        cur.execute(
            "SELECT id FROM study_records WHERE user_id = %s AND subject_id = %s AND end_at IS NULL",
            (user_id, subject_id),
        )
        if cur.fetchone():
            return jsonify(message="공부 중인 과목은 삭제할 수 없습니다. 먼저 정지해 주세요."), 409

        cur.execute("UPDATE subjects SET is_deleted = 1 WHERE id = %s", (subject_id,))

    return jsonify(message="과목이 삭제되었습니다.")

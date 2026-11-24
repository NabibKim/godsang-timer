"""
=====================================================================
통계 API  (/api/timer/stats)
---------------------------------------------------------------------
  GET /api/timer/stats?from=2026-11-17&to=2026-11-23

  응답
    days     : 기간 안의 모든 날짜 (공부하지 않은 날은 0) → 일별 누적 막대 차트·표
    subjects : 과목별 순공시간 (많은 순)                 → 과목별 가로 막대 차트
    total    : 기간 합계·평균                             → 요약 카드·도넛 차트
=====================================================================
"""
from datetime import timedelta

from flask import Blueprint, g, jsonify, request

from db import get_db
from session_store import login_required
from time_utils import day_range, now_kst, parse_date

stats_bp = Blueprint("stats", __name__, url_prefix="/api/timer")

MAX_RANGE_DAYS = 31


@stats_bp.get("/stats")
@login_required
def stats():
    user_id = g.user["userId"]
    now = now_kst()

    # 1) 기간 검사 (기본값 : 최근 7일)
    date_to = parse_date(request.args.get("to")) or now.date()
    date_from = parse_date(request.args.get("from")) or (date_to - timedelta(days=6))
    if date_from > date_to:
        return jsonify(message="시작 날짜가 종료 날짜보다 늦습니다."), 400
    if (date_to - date_from).days + 1 > MAX_RANGE_DAYS:
        return jsonify(message=f"기간은 최대 {MAX_RANGE_DAYS}일까지 조회할 수 있습니다."), 400

    range_start, _ = day_range(date_from)
    _, range_end = day_range(date_to)

    with get_db().cursor() as cur:
        # 2) 날짜별·유형별 합계
        cur.execute(
            """
            SELECT DATE(start_at) AS day, type,
                   SUM(TIMESTAMPDIFF(SECOND, start_at, IFNULL(end_at, %s))) AS seconds
              FROM study_records
             WHERE user_id = %s AND start_at >= %s AND start_at < %s
             GROUP BY DATE(start_at), type
            """,
            (now, user_id, range_start, range_end),
        )
        daily_rows = cur.fetchall()

        # 3) 과목별 순공시간
        cur.execute(
            """
            SELECT s.id, s.name, s.color, s.is_deleted,
                   SUM(TIMESTAMPDIFF(SECOND, r.start_at, IFNULL(r.end_at, %s))) AS seconds
              FROM study_records r
              JOIN subjects s ON s.id = r.subject_id
             WHERE r.user_id = %s AND r.type = 'STUDY' AND r.start_at >= %s AND r.start_at < %s
             GROUP BY s.id, s.name, s.color, s.is_deleted
             ORDER BY seconds DESC
            """,
            (now, user_id, range_start, range_end),
        )
        subject_rows = cur.fetchall()

    # 4) 기간 안의 모든 날짜를 0 으로 채운 뒤 조회 결과를 더한다. (공부 안 한 날도 차트에 표시)
    day_map = {}
    day = date_from
    while day <= date_to:
        day_map[day] = {"date": day.isoformat(), "studySeconds": 0, "restSeconds": 0}
        day = day + timedelta(days=1)

    for row in daily_rows:
        key = "studySeconds" if row["type"] == "STUDY" else "restSeconds"
        day_map[row["day"]][key] = int(row["seconds"] or 0)

    days = []
    for item in day_map.values():
        total = item["studySeconds"] + item["restSeconds"]
        item["totalSeconds"] = total
        item["studyRatio"] = round(item["studySeconds"] / total * 100, 1) if total else 0
        days.append(item)

    study_sum = sum(d["studySeconds"] for d in days)
    rest_sum = sum(d["restSeconds"] for d in days)
    total_sum = study_sum + rest_sum

    return jsonify(
        **{"from": date_from.isoformat(), "to": date_to.isoformat()},
        days=days,
        subjects=[
            {
                "id": r["id"],
                "name": r["name"] + (" (삭제됨)" if r["is_deleted"] else ""),
                "color": r["color"],
                "seconds": int(r["seconds"] or 0),
            }
            for r in subject_rows
        ],
        total={
            "studySeconds": study_sum,
            "restSeconds": rest_sum,
            "totalSeconds": total_sum,
            "studyRatio": round(study_sum / total_sum * 100, 1) if total_sum else 0,
            "dailyAverageStudySeconds": study_sum // len(days),
            "studyDays": sum(1 for d in days if d["studySeconds"] > 0),
        },
    )

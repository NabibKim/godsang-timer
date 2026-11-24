"""
=====================================================================
날짜·시간 계산 도우미
---------------------------------------------------------------------
* DB 에는 한국 시간(KST) 기준 DATETIME 이 시간대 정보 없이 저장된다.
* "오늘"은 자정(00:00) 기준이며, 기록은 "시작 시각"이 속한 날짜에 포함한다.
  (예: 23:30 에 시작해 01:00 에 끝난 공부는 시작한 날의 기록)
=====================================================================
"""
from datetime import date, datetime, time, timedelta

import config


def now_kst():
    """현재 한국 시간을 시간대 정보 없는 datetime 으로 반환한다. (DB 저장 형식과 동일)"""
    return datetime.now(config.KST).replace(tzinfo=None, microsecond=0)


def today_kst():
    """오늘 날짜(한국 기준)"""
    return now_kst().date()


def day_range(day):
    """
    특정 날짜의 조회 범위 [그날 00:00, 다음날 00:00) 를 반환한다.
    SQL 에서 start_at >= 시작 AND start_at < 끝 으로 사용한다.
    """
    start = datetime.combine(day, time.min)
    return start, start + timedelta(days=1)


def parse_date(text):
    """'YYYY-MM-DD' 문자열을 date 로 바꾼다. 형식이 틀리면 None."""
    try:
        return date.fromisoformat(text)
    except (TypeError, ValueError):
        return None


def to_iso(value):
    """
    datetime / date 를 JS 가 읽을 수 있는 ISO 문자열로 바꾼다.
    (Flask 기본 JSON 변환은 'Mon, 23 Nov 2026 ...' 형식이라 직접 변환)
    """
    if value is None:
        return None
    return value.isoformat()

"""
AI 招聘需求 - 数据抓取脚本
- 数据源：Indeed Hiring Lab 在 GitHub 公开的两个数据仓库（CC BY 4.0，使用时需署名）
  1) ai-tracker：各国“职位描述含 AI 关键词”的岗位占全部岗位的百分比（日度，7 日移动平均）
     https://github.com/hiring-lab/ai-tracker
  2) job_postings_tracker：Indeed 岗位指数（相对 2020-02-01 的季调变化，7 日移动平均），
     取各国整体“总岗位”指数，以及美国分行业中的几个技术类岗位
     https://github.com/hiring-lab/job_postings_tracker
- 源文件均含全部历史，每次全量覆盖写入，不需要自己累积
- 明细写入 data/indeed/（只保留页面用到的国家 / 行业 / “总岗位”口径），前端用 docs/indeed.json
  JSON 中的序列从最新日期向前每 7 天取一个点（源数据本身是 7 日移动平均，周度抽样不损失趋势），完整日度数据在 CSV
- 数据源或校验失败则退出码 1，不写入任何文件；数据无变化时不写入
"""

import csv
import datetime
import io
import json
import os
import sys
import time
import urllib.request

AI_URL = "https://raw.githubusercontent.com/hiring-lab/ai-tracker/main/AI_posting.csv"
TRACKER_URL = "https://raw.githubusercontent.com/hiring-lab/job_postings_tracker/master"
DATA_DIR = "data/indeed"
OUTPUT_AI = f"{DATA_DIR}/ai_share_postings.csv"
OUTPUT_TOTAL = f"{DATA_DIR}/job_postings_index.csv"
OUTPUT_SECTOR = f"{DATA_DIR}/us_sector_postings.csv"
OUTPUT_JSON = "docs/indeed.json"

HEADERS = {"User-Agent": "datatracker/1.0"}

# (国家代码, 前端显示名)；顺序即前端配色顺序，新增国家只能追加到末尾
COUNTRIES = [
    ("US", "美国"), ("GB", "英国"), ("CA", "加拿大"), ("AU", "澳大利亚"), ("DE", "德国"),
    ("FR", "法国"), ("IE", "爱尔兰"), ("IT", "意大利"), ("NL", "荷兰"),
]
# 美国分行业：(源数据中的 display_name, 前端显示名)
SECTORS = [
    ("Software Development", "软件开发"),
    ("Data & Analytics", "数据与分析"),
    ("IT Systems & Solutions", "IT 系统与解决方案"),
]
US_SECTOR_URL = f"{TRACKER_URL}/US/job_postings_by_sector_US.csv"

AI_COLUMNS = ["date", "jobcountry", "AI_share_postings"]
TOTAL_COLUMNS = ["date", "jobcountry", "indeed_job_postings_index_SA", "indeed_job_postings_index_NSA", "variable"]
SECTOR_COLUMNS = ["date", "jobcountry", "indeed_job_postings_index", "variable", "display_name"]
TOTAL_VARIABLE = "total postings"

MAX_AI_SHARE = 50    # 占比（%）超出 (0, 50] 视为异常
MAX_INDEX = 300      # 岗位指数超出 (0, 300] 视为异常
MIN_AI_ROWS = 20000  # 9 国 × 约 2800 天；行数骤减说明源文件被截断


class DataError(Exception):
    pass


def fetch(url, retries=3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.read().decode("utf-8")
        except Exception as e:
            print(f"    尝试 {attempt + 1}/{retries} 失败: {e}")
            if attempt < retries - 1:
                time.sleep(5)
    raise DataError(f"请求失败: {url}")


def read_rows(text, columns, name):
    reader = csv.DictReader(io.StringIO(text))
    missing = [c for c in columns if c not in (reader.fieldnames or [])]
    if missing:
        raise DataError(f"{name} 缺少列 {missing}，数据格式可能已变化")
    return list(reader)


def parse_float(v, what, lo, hi):
    try:
        x = float(v)
    except (TypeError, ValueError):
        raise DataError(f"{what} 不是数字: {v!r}")
    if not lo < x <= hi:
        raise DataError(f"{what} 超出 ({lo}, {hi}]: {v!r}")
    return x


def check_date(d, what):
    try:
        datetime.date.fromisoformat(d)
    except ValueError:
        raise DataError(f"{what} 日期格式异常: {d!r}")


# ── 解析与校验 ──────────────────────────────

def parse_ai(text):
    rows = read_rows(text, AI_COLUMNS, "AI 占比文件")
    codes = {c for c, _ in COUNTRIES}
    rows = [r for r in rows if r["jobcountry"] in codes]
    if len(rows) < MIN_AI_ROWS:
        raise DataError(f"AI 占比文件行数过少（{len(rows)}），源文件可能被截断")
    values = {c: {} for c in codes}
    for r in rows:
        check_date(r["date"], "AI 占比")
        key = (r["jobcountry"], r["date"])
        if r["date"] in values[r["jobcountry"]]:
            raise DataError(f"AI 占比存在重复行: {key}")
        values[r["jobcountry"]][r["date"]] = parse_float(
            r["AI_share_postings"], f"AI 占比 {key}", 0, MAX_AI_SHARE)
    require_same_latest(values, "AI 占比")
    return rows, values


def parse_total(country, text):
    rows = read_rows(text, TOTAL_COLUMNS, f"{country} 岗位指数文件")
    rows = [r for r in rows if r["variable"] == TOTAL_VARIABLE]
    if not rows:
        raise DataError(f"{country} 岗位指数文件中没有“{TOTAL_VARIABLE}”")
    values = {}
    for r in rows:
        check_date(r["date"], f"{country} 岗位指数")
        if r["jobcountry"] != country:
            raise DataError(f"{country} 岗位指数文件中出现其他国家: {r['jobcountry']}")
        if r["date"] in values:
            raise DataError(f"{country} 岗位指数存在重复日期: {r['date']}")
        values[r["date"]] = parse_float(
            r["indeed_job_postings_index_SA"], f"{country} 岗位指数 {r['date']}", 0, MAX_INDEX)
        parse_float(r["indeed_job_postings_index_NSA"], f"{country} 岗位指数(NSA) {r['date']}", 0, MAX_INDEX)
    return rows, values


def parse_sector(text):
    rows = read_rows(text, SECTOR_COLUMNS, "美国分行业文件")
    names = {n for n, _ in SECTORS}
    rows = [r for r in rows if r["display_name"] in names and r["variable"] == TOTAL_VARIABLE]
    values = {n: {} for n in names}
    for r in rows:
        check_date(r["date"], "美国分行业")
        n = r["display_name"]
        if r["date"] in values[n]:
            raise DataError(f"美国分行业存在重复行: {n} {r['date']}")
        values[n][r["date"]] = parse_float(
            r["indeed_job_postings_index"], f"{n} {r['date']}", 0, MAX_INDEX)
    empty = [n for n, v in values.items() if not v]
    if empty:
        raise DataError(f"美国分行业文件中没有这些行业: {empty}")
    require_same_latest(values, "美国分行业")
    return rows, values


def require_same_latest(values, name):
    """各序列的最新日期必须一致，否则前端“最新值”会错位"""
    latest = {k: max(v) for k, v in values.items() if v}
    if len(set(latest.values())) != 1 or len(latest) != len(values):
        raise DataError(f"{name} 各序列最新日期不一致: {latest}")


# ── 输出 ────────────────────────────────────

def weekly_series(values, keys):
    """从最新日期向前每 7 天取一个点；返回 (日期列表, {key: 数值列表})"""
    all_dates = sorted({d for k in keys for d in values[k]})
    latest = datetime.date.fromisoformat(all_dates[-1])
    dates = [d for d in all_dates if (latest - datetime.date.fromisoformat(d)).days % 7 == 0]
    series = {k: [round(values[k][d], 2) if d in values[k] else None for d in dates] for k in keys}
    return dates, series


def build_json(ai_values, total_values, sector_values):
    codes = [c for c, _ in COUNTRIES]
    ai_dates, ai_series = weekly_series(ai_values, codes)
    t_dates, t_series = weekly_series(total_values, codes)
    names = [n for n, _ in SECTORS]
    s_dates, s_series = weekly_series(sector_values, names)
    return {
        "last_updated": None,
        "source": "https://github.com/hiring-lab",
        "license": "CC BY 4.0",
        "countries": dict(COUNTRIES),
        "ai_share": {"dates": ai_dates, "series": ai_series},
        "postings": {"dates": t_dates, "series": t_series},
        "sectors": {"dates": s_dates, "labels": dict(SECTORS), "series": s_series},
    }


def to_csv(columns, rows, sort_key):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=columns, lineterminator="\n", extrasaction="ignore")
    w.writeheader()
    w.writerows(sorted(rows, key=sort_key))
    return buf.getvalue()


def main():
    print("下载 Indeed AI 岗位占比...")
    ai_rows, ai_values = parse_ai(fetch(AI_URL))
    ai_dates = sorted(next(iter(ai_values.values())))
    print(f"  {len(ai_rows)} 行，{ai_dates[0]} ~ {ai_dates[-1]}")

    print("下载 Indeed 各国整体岗位指数...")
    total_rows, total_values = [], {}
    for code, _ in COUNTRIES:
        rows, values = parse_total(code, fetch(f"{TRACKER_URL}/{code}/aggregate_job_postings_{code}.csv"))
        total_rows += rows
        total_values[code] = values
    require_same_latest(total_values, "整体岗位指数")
    t_dates = sorted(next(iter(total_values.values())))
    print(f"  {len(total_rows)} 行，{t_dates[0]} ~ {t_dates[-1]}")

    print("下载 Indeed 美国分行业岗位指数（约 12 MB）...")
    sector_rows, sector_values = parse_sector(fetch(US_SECTOR_URL))
    print(f"  保留 {len(sector_rows)} 行")

    output = build_json(ai_values, total_values, sector_values)
    order = {c: i for i, (c, _) in enumerate(COUNTRIES)}
    sector_order = {n: i for i, (n, _) in enumerate(SECTORS)}
    csvs = {
        OUTPUT_AI: to_csv(AI_COLUMNS, ai_rows, lambda r: (order[r["jobcountry"]], r["date"])),
        OUTPUT_TOTAL: to_csv(TOTAL_COLUMNS, total_rows, lambda r: (order[r["jobcountry"]], r["date"])),
        OUTPUT_SECTOR: to_csv(SECTOR_COLUMNS, sector_rows, lambda r: (sector_order[r["display_name"]], r["date"])),
    }

    # 数据与上次相同则不写文件，last_updated 表示数据最近一次变化的时间
    try:
        with open(OUTPUT_JSON, encoding="utf-8") as f:
            previous = json.load(f)
        previous["last_updated"] = None
        same = previous == output
        for path, text in csvs.items():
            with open(path, encoding="utf-8", newline="") as f:
                same = same and f.read() == text
        if same:
            print("数据无变化，跳过写入")
            return
    except (FileNotFoundError, json.JSONDecodeError):
        pass

    os.makedirs(DATA_DIR, exist_ok=True)
    for path, text in csvs.items():
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(text)
    output["last_updated"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))
    print(f"已写入 {OUTPUT_JSON} 与 {DATA_DIR}/")


if __name__ == "__main__":
    try:
        main()
    except (DataError, KeyError, ValueError) as e:
        print(f"错误: {e}")
        sys.exit(1)

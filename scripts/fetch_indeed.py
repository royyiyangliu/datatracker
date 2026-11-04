"""
AI 招聘需求 - 数据抓取脚本
- 数据源：Indeed Hiring Lab 在 GitHub 公开的两个数据仓库（CC BY 4.0，使用时需署名）
  1) ai-tracker：各国“职位描述含 AI 关键词”的岗位占全部岗位的百分比（日度，7 日移动平均）
     https://github.com/hiring-lab/ai-tracker
  2) job_postings_tracker：Indeed 岗位指数（相对 2020-02-01 的季调变化，7 日移动平均）
     取各国整体岗位指数，以及美国全部分行业；每个指数有两个口径：
     total postings（在线岗位存量）与 new postings（挂网 7 天以内的新增岗位）
     https://github.com/hiring-lab/job_postings_tracker
- 源文件均含全部历史，每次全量覆盖写入，不需要自己累积
- 明细写入 data/indeed/，前端用 docs/indeed.json
  国家级数据：CSV 为完整日度数据；美国分行业：源文件有 23 万行（12 MB），CSV 只存每 7 天一个点的周度数据，日度数据以源仓库为准
  JSON 中的序列从最新日期向前每 7 天取一个点（源数据本身是 7 日移动平均，周度抽样不损失趋势）
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
# 美国分行业：(源数据中的 display_name, 前端显示名)；源数据新增行业时先用英文名，之后在此补中文
SECTORS = [
    ("Accounting", "会计"), ("Administrative Assistance", "行政助理"), ("Architecture", "建筑设计"),
    ("Arts & Entertainment", "艺术与娱乐"), ("Aviation", "航空"), ("Banking & Finance", "银行与金融"),
    ("Childcare", "托育"), ("Civil Engineering", "土木工程"), ("Cleaning & Sanitation", "清洁与环卫"),
    ("Community & Social Service", "社区与社会服务"), ("Construction", "建筑施工"),
    ("Customer Service", "客户服务"), ("Data & Analytics", "数据与分析"), ("Dental", "牙科"),
    ("Driving", "驾驶"), ("Education & Instruction", "教育与培训"), ("Electrical Engineering", "电气工程"),
    ("Food Preparation & Service", "餐饮"), ("Hospitality & Tourism", "酒店与旅游"),
    ("Human Resources", "人力资源"), ("IT Infrastructure, Operations & Support", "IT 基础设施、运维与支持"),
    ("IT Systems & Solutions", "IT 系统与解决方案"), ("Industrial Engineering", "工业工程"),
    ("Installation & Maintenance", "安装与维修"), ("Insurance", "保险"), ("Legal", "法律"),
    ("Loading & Stocking", "装卸与理货"), ("Logistic Support", "物流支持"), ("Management", "管理"),
    ("Marketing", "市场营销"), ("Mechanical Engineering", "机械工程"), ("Media & Communications", "媒体与传播"),
    ("Medical Information", "医疗信息"), ("Medical Technician", "医疗技师"), ("Nursing", "护理"),
    ("Personal Care & Home Health", "个人护理与居家医疗"), ("Pharmacy", "药学"),
    ("Physicians & Surgeons", "医生与外科"), ("Production & Manufacturing", "生产与制造"),
    ("Project Management", "项目管理"), ("Retail", "零售"), ("Sales", "销售"),
    ("Scientific Research & Development", "科研"), ("Security & Public Safety", "安保与公共安全"),
    ("Social Science", "社会科学"), ("Software Development", "软件开发"), ("Therapy", "治疗与康复"),
]
REQUIRED_SECTORS = ["Software Development", "Data & Analytics", "IT Systems & Solutions"]  # 页面默认选中，必须存在
MIN_SECTORS = 40
US_SECTOR_URL = f"{TRACKER_URL}/US/job_postings_by_sector_US.csv"

AI_COLUMNS = ["date", "jobcountry", "AI_share_postings"]
TOTAL_COLUMNS = ["date", "jobcountry", "indeed_job_postings_index_SA", "indeed_job_postings_index_NSA", "variable"]
SECTOR_COLUMNS = ["date", "jobcountry", "indeed_job_postings_index", "variable", "display_name"]
SECTOR_OUT_COLUMNS = ["date", "display_name", "total_postings_index", "new_postings_index"]
VARIABLES = {"total": "total postings", "new": "new postings"}   # JSON 键 -> 源数据 variable

MAX_AI_SHARE = 50    # 占比（%）超出 (0, 50] 视为异常
MAX_INDEX = 1000     # 岗位指数超出 (0, 1000] 视为异常（小行业的新增岗位指数可到 500 以上）
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


def require_same_latest(values, name):
    """各序列的最新日期必须一致，否则前端“最新值”会错位"""
    latest = {k: max(v) for k, v in values.items() if v}
    if len(set(latest.values())) != 1 or len(latest) != len(values):
        raise DataError(f"{name} 各序列最新日期不一致: {latest}")


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
    """各国整体岗位指数：返回 (全部行, {口径: {日期: 季调指数}})"""
    rows = read_rows(text, TOTAL_COLUMNS, f"{country} 岗位指数文件")
    values = {k: {} for k in VARIABLES}
    by_var = {v: k for k, v in VARIABLES.items()}
    rows = [r for r in rows if r["variable"] in by_var]
    for r in rows:
        key = by_var[r["variable"]]
        check_date(r["date"], f"{country} 岗位指数")
        if r["jobcountry"] != country:
            raise DataError(f"{country} 岗位指数文件中出现其他国家: {r['jobcountry']}")
        if r["date"] in values[key]:
            raise DataError(f"{country} {r['variable']} 存在重复日期: {r['date']}")
        values[key][r["date"]] = parse_float(
            r["indeed_job_postings_index_SA"], f"{country} {r['variable']} {r['date']}", 0, MAX_INDEX)
        parse_float(r["indeed_job_postings_index_NSA"], f"{country} {r['variable']}(NSA) {r['date']}", 0, MAX_INDEX)
    empty = [k for k, v in values.items() if not v]
    if empty:
        raise DataError(f"{country} 岗位指数文件缺少口径: {empty}")
    return rows, values


def parse_sector(text):
    """美国分行业：返回 {口径: {行业: {日期: 季调指数}}}"""
    rows = read_rows(text, SECTOR_COLUMNS, "美国分行业文件")
    by_var = {v: k for k, v in VARIABLES.items()}
    values = {k: {} for k in VARIABLES}
    for r in rows:
        key = by_var.get(r["variable"])
        if key is None:
            continue
        check_date(r["date"], "美国分行业")
        series = values[key].setdefault(r["display_name"], {})
        if r["date"] in series:
            raise DataError(f"美国分行业存在重复行: {r['display_name']} {r['variable']} {r['date']}")
        series[r["date"]] = parse_float(
            r["indeed_job_postings_index"], f"{r['display_name']} {r['variable']} {r['date']}", 0, MAX_INDEX)
    names = set(values["total"])
    if names != set(values["new"]):
        raise DataError("美国分行业两个口径的行业清单不一致")
    if len(names) < MIN_SECTORS:
        raise DataError(f"美国分行业只有 {len(names)} 个行业，源文件可能被截断")
    missing = [n for n in REQUIRED_SECTORS if n not in names]
    if missing:
        raise DataError(f"美国分行业缺少必需行业: {missing}")
    unknown = sorted(names - {n for n, _ in SECTORS})
    if unknown:
        print(f"  提示：源数据出现新行业 {unknown}，前端暂以英文名显示，请在 SECTORS 中补充中文名")
    all_series = {(k, n): s for k, d in values.items() for n, s in d.items()}
    require_same_latest(all_series, "美国分行业")
    return values


# ── 输出 ────────────────────────────────────

def weekly_dates(date_sets):
    """从最新日期向前每 7 天取一个点"""
    all_dates = sorted(set().union(*date_sets))
    latest = datetime.date.fromisoformat(all_dates[-1])
    return [d for d in all_dates if (latest - datetime.date.fromisoformat(d)).days % 7 == 0]


def weekly_block(values, keys):
    """values: {口径: {key: {日期: 值}}}；返回 {"dates": [...], "total": {key: [...]}, "new": {key: [...]}}"""
    dates = weekly_dates([set(s) for v in values.values() for s in v.values()])
    block = {"dates": dates}
    for var, by_key in values.items():
        block[var] = {k: [round(by_key[k][d], 2) if d in by_key[k] else None for d in dates] for k in keys}
    return block


def sector_order(names):
    order = {n: i for i, (n, _) in enumerate(SECTORS)}
    return sorted(names, key=lambda n: (order.get(n, len(order)), n))


def build_json(ai_values, total_values, sector_values):
    codes = [c for c, _ in COUNTRIES]
    ai_dates = weekly_dates([set(v) for v in ai_values.values()])
    ai_block = {"dates": ai_dates,
                "series": {c: [round(ai_values[c][d], 2) if d in ai_values[c] else None for d in ai_dates] for c in codes}}
    postings = weekly_block({var: {c: total_values[c][var] for c in codes} for var in VARIABLES}, codes)
    names = sector_order(sector_values["total"])
    sectors = weekly_block(sector_values, names)
    if sectors["dates"] != postings["dates"]:
        raise DataError("美国分行业与整体岗位指数的周度日期不一致")
    labels = dict(SECTORS)
    sectors["labels"] = {n: labels.get(n, n) for n in names}
    return {
        "last_updated": None,
        "source": "https://github.com/hiring-lab",
        "license": "CC BY 4.0",
        "countries": dict(COUNTRIES),
        "ai_share": ai_block,
        "postings": postings,
        "sectors": sectors,
    }


def to_csv(columns, rows, sort_key):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=columns, lineterminator="\n", extrasaction="ignore")
    w.writeheader()
    w.writerows(sorted(rows, key=sort_key))
    return buf.getvalue()


def sector_weekly_rows(sectors_block):
    rows = []
    for name in sectors_block["total"]:
        for i, d in enumerate(sectors_block["dates"]):
            rows.append({"date": d, "display_name": name,
                         "total_postings_index": sectors_block["total"][name][i],
                         "new_postings_index": sectors_block["new"][name][i]})
    return rows


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
    for var in VARIABLES:
        require_same_latest({c: total_values[c][var] for c in total_values}, f"整体岗位指数（{var}）")
    t_dates = sorted(next(iter(total_values.values()))["total"])
    print(f"  {len(total_rows)} 行，{t_dates[0]} ~ {t_dates[-1]}")

    print("下载 Indeed 美国分行业岗位指数（约 12 MB）...")
    sector_values = parse_sector(fetch(US_SECTOR_URL))
    print(f"  {len(sector_values['total'])} 个行业")

    output = build_json(ai_values, total_values, sector_values)
    order = {c: i for i, (c, _) in enumerate(COUNTRIES)}
    sector_idx = {n: i for i, n in enumerate(output["sectors"]["labels"])}
    var_order = {v: i for i, v in enumerate(VARIABLES.values())}
    csvs = {
        OUTPUT_AI: to_csv(AI_COLUMNS, ai_rows, lambda r: (order[r["jobcountry"]], r["date"])),
        OUTPUT_TOTAL: to_csv(TOTAL_COLUMNS, total_rows,
                             lambda r: (order[r["jobcountry"]], var_order[r["variable"]], r["date"])),
        OUTPUT_SECTOR: to_csv(SECTOR_OUT_COLUMNS, sector_weekly_rows(output["sectors"]),
                              lambda r: (sector_idx[r["display_name"]], r["date"])),
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

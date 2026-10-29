"""
GPU 租赁价格 - 数据抓取脚本
- 数据源：GetDeploying 公开的周度 GPU 价格数据集（CC BY 4.0，使用时需署名）
  https://getdeploying.com/dataset/gpu-prices
- 源文件已包含全部历史，每次全量覆盖写入，不需要自己累积
- 只保留主流型号（H100 / A100 / B200 / B300 / GB200），明细写入 data/gpu/，前端用 docs/gpu.json
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

SOURCE_URL = "https://getdeploying.com/dataset/gpu-prices/weekly.csv"
DATA_DIR = "data/gpu"
OUTPUT_CSV = f"{DATA_DIR}/getdeploying_weekly.csv"
OUTPUT_JSON = "docs/gpu.json"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )
}

# (源数据中的 gpu_slug, 前端显示名)
GPUS = [
    ("nvidia-h100", "H100"),
    ("nvidia-a100", "A100"),
    ("nvidia-b200", "B200"),
    ("nvidia-b300", "B300"),
    ("nvidia-gb200", "GB200"),
]

# 前端使用的价格序列：key -> (billing_type, reservation_months)
SERIES = {
    "on_demand": ("ON_DEMAND", ""),
    "spot": ("SPOT", ""),
    "reserved_1": ("RESERVATION", "1"),
    "reserved_12": ("RESERVATION", "12"),
    "reserved_36": ("RESERVATION", "36"),
}

REQUIRED_COLUMNS = [
    "gpu_slug", "date", "billing_type", "reservation_months",
    "min_price", "max_price", "median_price", "provider_median_price",
    "provider_count", "offering_count",
]
MAX_PRICE = 200  # 美元 / GPU 小时，超出视为异常


class DataError(Exception):
    pass


def fetch(url, retries=3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read().decode("utf-8")
        except Exception as e:
            print(f"    尝试 {attempt + 1}/{retries} 失败: {e}")
            if attempt < retries - 1:
                time.sleep(5)
    raise DataError(f"请求失败: {url}")


def parse(text):
    reader = csv.DictReader(io.StringIO(text))
    missing = [c for c in REQUIRED_COLUMNS if c not in (reader.fieldnames or [])]
    if missing:
        raise DataError(f"源文件缺少列 {missing}，数据格式可能已变化")
    slugs = {s for s, _ in GPUS}
    rows = [r for r in reader if r["gpu_slug"] in slugs]
    if not rows:
        raise DataError("源文件中没有目标型号的数据")
    return reader.fieldnames, rows


def num(v):
    v = (v or "").strip()
    return round(float(v), 4) if v else None


def validate(rows):
    for r in rows:
        try:
            datetime.date.fromisoformat(r["date"])
        except ValueError:
            raise DataError(f"日期格式异常: {r['date']}")
        for col in ("min_price", "max_price", "median_price"):
            v = num(r[col])
            if v is None or not 0 < v <= MAX_PRICE:
                raise DataError(f"{r['gpu_slug']} {r['date']} {col} 超出 (0, {MAX_PRICE}]: {r[col]!r}")
    latest = max(r["date"] for r in rows)
    for slug, label in GPUS:
        weeks = {r["date"] for r in rows if r["gpu_slug"] == slug and r["billing_type"] == "ON_DEMAND"}
        if latest not in weeks:
            raise DataError(f"{label} 最新一周（{latest}）缺少按需价")


def build_json(rows):
    weeks = sorted({r["date"] for r in rows})
    index = {w: i for i, w in enumerate(weeks)}
    gpus = {}
    for slug, label in GPUS:
        series = {}
        for key, (billing, months) in SERIES.items():
            cols = {f: [None] * len(weeks) for f in ("median", "min", "max", "providers")}
            for r in rows:
                if r["gpu_slug"] == slug and r["billing_type"] == billing and r["reservation_months"] == months:
                    i = index[r["date"]]
                    cols["median"][i] = num(r["median_price"])
                    cols["min"][i] = num(r["min_price"])
                    cols["max"][i] = num(r["max_price"])
                    cols["providers"][i] = int(r["provider_count"]) if r["provider_count"] else None
            if any(v is not None for v in cols["median"]):
                series[key] = cols
        gpus[slug] = {"label": label, "series": series}
    return {
        "last_updated": None,
        "source": "https://getdeploying.com/dataset/gpu-prices",
        "license": "CC BY 4.0",
        "weeks": weeks,
        "gpus": gpus,
    }


def build_csv(fieldnames, rows):
    order = {s: i for i, (s, _) in enumerate(GPUS)}
    rows = sorted(rows, key=lambda r: (order[r["gpu_slug"]], r["billing_type"], int(r["reservation_months"] or 0), r["date"]))
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=fieldnames, lineterminator="\n", extrasaction="ignore")
    w.writeheader()
    w.writerows(rows)
    return buf.getvalue()


def main():
    print("下载 GetDeploying 周度 GPU 价格数据集...")
    fieldnames, rows = parse(fetch(SOURCE_URL))
    validate(rows)
    weeks = sorted({r["date"] for r in rows})
    print(f"  {len(rows)} 行，{weeks[0]} ~ {weeks[-1]}，共 {len(weeks)} 周")

    output = build_json(rows)
    csv_text = build_csv(fieldnames, rows)

    # 数据与上次相同则不写文件，last_updated 表示数据最近一次变化的时间
    try:
        with open(OUTPUT_JSON, encoding="utf-8") as f:
            previous = json.load(f)
        previous["last_updated"] = None
        with open(OUTPUT_CSV, encoding="utf-8", newline="") as f:
            if previous == output and f.read() == csv_text:
                print("数据无变化，跳过写入")
                return
    except (FileNotFoundError, json.JSONDecodeError):
        pass

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(OUTPUT_CSV, "w", encoding="utf-8", newline="") as f:
        f.write(csv_text)
    output["last_updated"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))
    print(f"已写入 {OUTPUT_JSON} 与 {OUTPUT_CSV}")


if __name__ == "__main__":
    try:
        main()
    except (DataError, KeyError, ValueError) as e:
        print(f"错误: {e}")
        sys.exit(1)

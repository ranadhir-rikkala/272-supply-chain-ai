from datetime import date

import numpy as np

from pipeline.forecast.features import SeriesHistory

START = date(2023, 1, 1)
CATEGORIES = ("BEV", "SNK", "WIN", "ELE")
WAREHOUSES = ("WH-01", "WH-02")
WEEKLY = np.array([0.9, 0.9, 0.95, 1.0, 1.1, 1.25, 1.0])


def synthetic_history(series_per_cell: int = 5, days: int = 760, seed: int = 11) -> SeriesHistory:
    rng = np.random.default_rng(seed)
    cells = [(c, w) for c in range(len(CATEGORIES)) for w in range(len(WAREHOUSES))]
    series = [cell for cell in cells for _ in range(series_per_cell)]
    category_codes = np.array([c for c, _ in series], dtype=np.float32)
    warehouse_codes = np.array([w for _, w in series], dtype=np.float32)
    base = rng.uniform(5, 40, size=len(series))[:, None]
    day_index = np.arange(days)
    weekday = WEEKLY[[(START.weekday() + d) % 7 for d in day_index]]
    phase = (category_codes[:, None] * 90 + day_index[None, :]) * 2 * np.pi / 365.25
    season = 1 + 0.35 * np.cos(phase)
    mean = base * weekday[None, :] * season
    units = rng.gamma(8.0, mean / 8.0).round().astype(np.float32)
    stockout = rng.random(units.shape) < 0.03
    units[stockout] = np.floor(units[stockout] * 0.3)
    return SeriesHistory(
        start=START,
        units=units,
        stockout=stockout,
        promo=np.zeros(units.shape, dtype=bool),
        price_index=np.ones(units.shape, dtype=np.float32),
        category_codes=category_codes,
        warehouse_codes=warehouse_codes,
    )


FAST_PARAMS = {"max_depth": 4, "min_child_weight": 5, "eta": 0.15}
FAST_ROUNDS = 80

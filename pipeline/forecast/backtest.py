from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from pipeline.forecast.features import SeriesHistory
from pipeline.forecast.model import HORIZON_DAYS, DemandModel, recursive_forecast, visible_history

BACKTEST_DAYS = 184
BLOCK_DAYS = HORIZON_DAYS
SEASONAL_LAG_DAYS = 364
WEEK_DAYS = 7


@dataclass(frozen=True)
class BacktestResult:
    series: np.ndarray
    origin_day: np.ndarray
    target_day: np.ndarray
    horizon: np.ndarray
    actual: np.ndarray
    yhat: np.ndarray
    baseline: np.ndarray
    usable: np.ndarray

    def __len__(self) -> int:
        return self.series.size


def backtest_origins(day_count: int, backtest_days: int = BACKTEST_DAYS) -> list[tuple[int, int]]:
    test_start = day_count - backtest_days
    if test_start <= SEASONAL_LAG_DAYS:
        raise ValueError("not enough history before the backtest window")
    origins = []
    for origin in range(test_start - 1, day_count - 1, BLOCK_DAYS):
        origins.append((origin, min(BLOCK_DAYS, day_count - 1 - origin)))
    return origins


def seasonal_naive(history: SeriesHistory, origin_day: int, horizon: int) -> np.ndarray:
    visible = visible_history(history, origin_day, horizon)
    target_days = origin_day + 1 + np.arange(horizon)
    forecast = visible.units[:, target_days - SEASONAL_LAG_DAYS].copy()
    fallback = visible.units[:, target_days - SEASONAL_LAG_DAYS - WEEK_DAYS]
    forecast = np.where(np.isnan(forecast), fallback, forecast)
    return np.nan_to_num(forecast, nan=0.0).astype(np.float32)


def run_backtest(
    model: DemandModel, history: SeriesHistory, backtest_days: int = BACKTEST_DAYS
) -> BacktestResult:
    day_count = history.units.shape[1]
    series_count = history.units.shape[0]
    parts: dict[str, list[np.ndarray]] = {name: [] for name in BacktestResult.__annotations__}
    for origin, horizon in backtest_origins(day_count, backtest_days):
        target_days = origin + 1 + np.arange(horizon)
        actual = history.units[:, target_days]
        stockout = history.stockout[:, target_days]
        parts["series"].append(np.repeat(np.arange(series_count), horizon))
        parts["origin_day"].append(np.full(series_count * horizon, origin))
        parts["target_day"].append(np.tile(target_days, series_count))
        parts["horizon"].append(np.tile(np.arange(1, horizon + 1), series_count))
        parts["actual"].append(actual.reshape(-1))
        parts["yhat"].append(recursive_forecast(model, history, origin, horizon).reshape(-1))
        parts["baseline"].append(seasonal_naive(history, origin, horizon).reshape(-1))
        parts["usable"].append((~np.isnan(actual) & ~stockout).reshape(-1))
    return BacktestResult(**{name: np.concatenate(values) for name, values in parts.items()})

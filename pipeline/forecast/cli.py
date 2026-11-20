from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import date


def _connect():
    import psycopg

    return psycopg.connect(os.environ["DATABASE_URL"])


def _train(args) -> dict:
    from pipeline.forecast.artifacts import default_store
    from pipeline.forecast.training import train_and_register

    with _connect() as connection:
        return train_and_register(
            connection, default_store(), args.requested_by, rounds=args.rounds
        )


def _activate(args) -> dict:
    from pipeline.forecast.registry import activate_model

    with _connect() as connection:
        return activate_model(connection, args.version, args.requested_by, args.reason)


def _predict(args) -> dict:
    from pipeline.forecast.artifacts import default_store
    from pipeline.forecast.runs import create_run, execute_run

    with _connect() as connection:
        run = create_run(connection, args.requested_by, args.origin_date, args.horizon_days)
        return execute_run(connection, default_store(), run["run_id"])


COMMANDS = {"train": _train, "activate": _activate, "predict": _predict}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="scforecast", description="Demand forecasting")
    sub = parser.add_subparsers(dest="command", required=True)
    train_parser = sub.add_parser("train", help="train, backtest and register a model")
    train_parser.add_argument("--requested-by", default="cli")
    train_parser.add_argument("--rounds", type=int)
    predict_parser = sub.add_parser("predict", help="run a forecast with the ACTIVE model")
    predict_parser.add_argument("--requested-by", default="cli")
    predict_parser.add_argument("--origin-date", type=date.fromisoformat)
    predict_parser.add_argument("--horizon-days", type=int, default=28)
    activate_parser = sub.add_parser("activate", help="promote or roll back a model version")
    activate_parser.add_argument("version")
    activate_parser.add_argument("--requested-by", default="cli")
    activate_parser.add_argument("--reason", required=True)
    return parser


def main(argv: list[str] | None = None) -> None:
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), stream=sys.stderr)
    args = build_parser().parse_args(argv)
    print(json.dumps(COMMANDS[args.command](args), default=str))

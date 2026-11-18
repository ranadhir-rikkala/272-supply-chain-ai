from __future__ import annotations

import json
import os

try:
    from prometheus_client import Counter, Gauge
except ImportError:  # Optional at import time; production installs the declared dependency.

    class _Metric:
        def inc(self, amount: float = 1) -> None:
            return None

        def set(self, value: float) -> None:
            return None

    def Counter(*args, **kwargs):  # type: ignore[no-untyped-def]
        return _Metric()

    def Gauge(*args, **kwargs):  # type: ignore[no-untyped-def]
        return _Metric()


MESSAGES_PROCESSED = Counter("scdata_messages_processed_total", "Messages successfully processed")
MESSAGES_FAILED = Counter("scdata_messages_failed_total", "Messages sent to retry or DLQ")
CONSUMER_READY = Gauge(
    "scdata_consumer_ready", "Whether the consumer is connected", multiprocess_mode="livesum"
)


class FeedConsumer:
    """Reusable manual-ack consumer with bounded retries and a dead-letter queue."""

    def __init__(self, callback, url: str | None = None):
        import pika

        self.pika = pika
        self.callback = callback
        self.connection = pika.BlockingConnection(
            pika.URLParameters(
                url or os.getenv("RABBITMQ_URL", "amqp://supplychain:supplychain@localhost:5672/")
            )
        )
        self.channel = self.connection.channel()
        self.channel.exchange_declare("erp", "topic", durable=True)
        args = {
            "x-dead-letter-exchange": "erp",
            "x-dead-letter-routing-key": "etl.feed",
            "x-message-ttl": 5000,
        }
        self.channel.queue_declare("etl.feed.retry", durable=True, arguments=args)
        self.channel.queue_declare("etl.feed.dlq", durable=True)
        self.channel.queue_declare("etl.feed", durable=True)
        self.channel.queue_bind("etl.feed", "erp", "feed.#")
        self.channel.basic_qos(prefetch_count=1)
        CONSUMER_READY.set(1)

    def run(self):
        def consume(ch, method, props, body):
            try:
                self.callback(json.loads(body))
                ch.basic_ack(method.delivery_tag)
                MESSAGES_PROCESSED.inc()
            except (ValueError, KeyError, RuntimeError):
                attempts = int((props.headers or {}).get("x-attempts", 0)) + 1
                ch.basic_ack(method.delivery_tag)
                MESSAGES_FAILED.inc()
                target = "etl.feed.retry" if attempts < 4 else "etl.feed.dlq"
                ch.basic_publish(
                    "erp",
                    "feed.retry" if target.endswith("retry") else "feed.dlq",
                    body,
                    self.pika.BasicProperties(delivery_mode=2, headers={"x-attempts": attempts}),
                )

        self.channel.basic_consume("etl.feed", consume)
        self.channel.start_consuming()

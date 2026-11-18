from __future__ import annotations

import json
import os


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

    def run(self):
        def consume(ch, method, props, body):
            try:
                self.callback(json.loads(body))
                ch.basic_ack(method.delivery_tag)
            except (ValueError, KeyError, RuntimeError):
                attempts = int((props.headers or {}).get("x-attempts", 0)) + 1
                ch.basic_ack(method.delivery_tag)
                target = "etl.feed.retry" if attempts < 4 else "etl.feed.dlq"
                ch.basic_publish(
                    "erp",
                    "feed.retry" if target.endswith("retry") else "feed.dlq",
                    body,
                    self.pika.BasicProperties(delivery_mode=2, headers={"x-attempts": attempts}),
                )

        self.channel.basic_consume("etl.feed", consume)
        self.channel.start_consuming()

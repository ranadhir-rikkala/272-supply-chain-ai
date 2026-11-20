from __future__ import annotations

import json
import os

EXCHANGE = "ml"
QUEUE = "forecast.jobs"
ROUTING_KEY = "forecast"
FORECAST_JOB = "forecast"
TRAINING_JOB = "train"
JOB_TYPES = (FORECAST_JOB, TRAINING_JOB)


class JobPublishError(RuntimeError):
    pass


def amqp_url() -> str:
    return os.getenv("AMQP_URL") or os.getenv(
        "RABBITMQ_URL", "amqp://supplychain:supplychain@localhost:5672/"
    )


def declare_topology(channel) -> None:
    channel.exchange_declare(exchange=EXCHANGE, exchange_type="topic", durable=True)
    channel.queue_declare(queue=QUEUE, durable=True)
    channel.queue_bind(queue=QUEUE, exchange=EXCHANGE, routing_key=f"{ROUTING_KEY}.#")
    channel.queue_declare(
        queue=f"{QUEUE}.retry",
        durable=True,
        arguments={"x-dead-letter-exchange": EXCHANGE, "x-dead-letter-routing-key": ROUTING_KEY},
    )
    channel.queue_declare(queue=f"{QUEUE}.dlq", durable=True)


class RabbitJobPublisher:
    def __init__(self, url: str | None = None, timeout_seconds: float = 5.0):
        self.url = url or amqp_url()
        self.timeout_seconds = timeout_seconds

    def publish(self, message: dict, request_id: str | None = None) -> None:
        import pika

        parameters = pika.URLParameters(self.url)
        parameters.socket_timeout = self.timeout_seconds
        parameters.blocked_connection_timeout = self.timeout_seconds
        parameters.connection_attempts = 1
        try:
            connection = pika.BlockingConnection(parameters)
            try:
                channel = connection.channel()
                channel.confirm_delivery()
                declare_topology(channel)
                channel.basic_publish(
                    EXCHANGE,
                    f"{ROUTING_KEY}.{message['job_type']}",
                    json.dumps(message, default=str).encode(),
                    pika.BasicProperties(
                        delivery_mode=2,
                        content_type="application/json",
                        correlation_id=request_id,
                        headers={"x-request-id": request_id} if request_id else None,
                    ),
                    mandatory=True,
                )
            finally:
                connection.close()
        except (pika.exceptions.AMQPError, OSError) as error:
            raise JobPublishError(
                f"could not publish {message['job_type']} job: {error}"
            ) from error

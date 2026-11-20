from __future__ import annotations

import json
import os
from dataclasses import dataclass

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


@dataclass(frozen=True)
class JobTopology:
    exchange: str = EXCHANGE
    queue: str = QUEUE
    routing_key: str = ROUTING_KEY

    @property
    def retry_queue(self) -> str:
        return f"{self.queue}.retry"

    @property
    def dead_letter_queue(self) -> str:
        return f"{self.queue}.dlq"

    @classmethod
    def from_env(cls) -> JobTopology:
        return cls(
            exchange=os.getenv("FORECAST_JOBS_EXCHANGE", EXCHANGE),
            queue=os.getenv("FORECAST_JOBS_QUEUE", QUEUE),
        )


def declare_topology(channel, topology: JobTopology | None = None) -> None:
    topology = topology or JobTopology.from_env()
    channel.exchange_declare(exchange=topology.exchange, exchange_type="topic", durable=True)
    channel.queue_declare(queue=topology.queue, durable=True)
    channel.queue_bind(
        queue=topology.queue,
        exchange=topology.exchange,
        routing_key=f"{topology.routing_key}.#",
    )
    channel.queue_declare(
        queue=topology.retry_queue,
        durable=True,
        arguments={
            "x-dead-letter-exchange": topology.exchange,
            "x-dead-letter-routing-key": topology.routing_key,
        },
    )
    channel.queue_declare(queue=topology.dead_letter_queue, durable=True)


class RabbitJobPublisher:
    def __init__(
        self,
        url: str | None = None,
        timeout_seconds: float = 5.0,
        topology: JobTopology | None = None,
    ):
        self.url = url or amqp_url()
        self.timeout_seconds = timeout_seconds
        self.topology = topology or JobTopology.from_env()

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
                declare_topology(channel, self.topology)
                channel.basic_publish(
                    self.topology.exchange,
                    f"{self.topology.routing_key}.{message['job_type']}",
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

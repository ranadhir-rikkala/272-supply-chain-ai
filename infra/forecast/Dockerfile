FROM python:3.12-slim AS build
WORKDIR /src
COPY pyproject.toml ./
COPY pipeline ./pipeline
RUN pip wheel --no-cache-dir --wheel-dir /wheels ".[service]" "xgboost-cpu>=2.1"

FROM python:3.12-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 forecast \
    && mkdir -p /data \
    && chown forecast:forecast /data
COPY --from=build /wheels /wheels
RUN pip install --no-cache-dir --no-index --find-links /wheels /wheels/*.whl \
    && rm -rf /wheels
USER forecast
WORKDIR /home/forecast
ENV PYTHONUNBUFFERED=1 LOCAL_STORE_ROOT=/data STORE=local
EXPOSE 8000 9100
CMD ["scforecast", "serve"]

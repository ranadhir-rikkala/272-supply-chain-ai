# Build from the repository root.
FROM prom/prometheus:v3.1.0
COPY infra/aws/images/prometheus/prometheus.yml /etc/prometheus/prometheus.yml
CMD ["--config.file=/etc/prometheus/prometheus.yml", "--storage.tsdb.path=/prometheus", "--storage.tsdb.retention.time=2d"]

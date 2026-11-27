# Build from the repository root. Same dashboards as compose; AWS datasources.
FROM grafana/grafana:11.4.0
COPY monitoring/grafana/provisioning/dashboards /etc/grafana/provisioning/dashboards
COPY infra/aws/images/grafana/datasources.yml /etc/grafana/provisioning/datasources/datasources.yml
COPY monitoring/grafana/dashboards /var/lib/grafana/dashboards

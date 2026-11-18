# ADR 0002: Flyway owns the schema

All shared PostgreSQL DDL lives in ordered Flyway migrations. Application code only loads data and never creates or mutates contract tables, so Forecasting and the Platform API can depend on stable versions.

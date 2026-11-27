# ADR 0007: AWS deployment on ECS Fargate

- Status: Accepted
- Date: 2026-11-26

## Context

The system runs locally from one Compose file with 13 containers. For the demo
it also needs to run in the cloud, the way an enterprise would deploy it:
managed data stores, no long-lived servers to patch, secrets outside the code,
and infrastructure that can be recreated from the repository. It must also be
cheap enough for a class project, so it should run only around the demo and be
easy to delete.

## Decision

Deploy to AWS with Terraform (`infra/aws/terraform`):

- **Compute:** every long-running container becomes an ECS Fargate service on
  ARM64 (Graviton), one task each. Fargate removes server management, and ARM
  is about 20% cheaper than x86 and matches the developers' Apple silicon, so
  images build natively.
- **Service discovery:** ECS Service Connect gives services the same short
  names they use in Compose (`platform-api:8080`, `keycloak:8080`,
  `forecast-api:8000`, `rabbitmq:5672`). Configuration that already works
  locally keeps working, and Service Connect adds per-request metrics and retries.
- **Database:** one RDS PostgreSQL 16 instance with two databases: `supplychain`
  (Flyway-owned, unchanged migrations) and `keycloak`. RDS forces TLS, so every
  client connects with `sslmode=require`. The application keeps its
  least-privilege roles (`platform_api`, `forecast_service`, `grafana_reader`).
- **Object storage:** model artifacts go to S3 through the existing `STORE=s3`
  backend, with encryption, versioning and public access blocked. Only the
  forecast tasks' IAM role can read and write the bucket.
- **Edge:** CloudFront serves the public HTTPS URL and forwards to an
  Application Load Balancer. The load balancer accepts traffic only from
  CloudFront's IP ranges and only with a secret origin header. CloudFront is
  required because the dashboard's PKCE sign-in needs HTTPS, and it provides a
  trusted certificate without owning a domain. Hashed dashboard assets are
  cached at the edge; API, Keycloak and Grafana requests are not.
- **Secrets:** Terraform generates every password and token and stores them in
  one Secrets Manager secret. ECS injects individual keys at task start, so no
  secret is in an image, an environment file or the repository.
- **Setup steps** (Keycloak database, Flyway, loading the feeds, training) run as
  one-off ECS tasks, the same way the Compose stack runs `flyway` once.
- **Networking:** public subnets with tight security groups instead of private
  subnets and a NAT gateway. Tasks get public IPs only to reach ECR and Secrets
  Manager; nothing accepts inbound traffic except from the load balancer or
  from other tasks, and RDS accepts connections only from the tasks.
- **Cost controls:** a `services_enabled` switch scales every service to zero,
  `destroy.sh` deletes everything (including the database and images), and an
  AWS budget emails at 50, 80 and 100 percent.

## Consequences

- The cloud stack runs the same images and migrations as the local one, so the
  end-to-end checks done locally carry over.
- Requests through CloudFront are limited to 60 seconds. The disruption
  evaluation (about 80 seconds) has to become a background job to work there.
- RabbitMQ stays a single container without persistent storage. Amazon MQ was
  rejected for now because it doesn't expose the Prometheus metrics the queue
  dashboards use; the code already accepts an `amqps://` URL, so switching
  later is a configuration change.
- The ETL worker isn't deployed; ingestion is a one-off task. Continuous
  ingestion would need the feeds in S3 or EFS.
- For cost, RDS is single-AZ and each service has one task. Production would use
  Multi-AZ RDS, two or more tasks per service, private subnets with VPC
  endpoints, and remote Terraform state with locking.

### Security scan

`trivy config infra/aws/terraform` (HIGH and CRITICAL) reports the following,
each accepted for this deployment:

| Finding | Why it is accepted | Production fix |
|---|---|---|
| Plain HTTP from CloudFront to the load balancer | Only CloudFront's IP ranges with the secret origin header can reach it; HTTPS on the load balancer needs a certificate for an owned domain | Custom domain with an ACM certificate, or a CloudFront VPC origin |
| Load balancer exposed to the internet | Same restriction as above | CloudFront VPC origin with an internal load balancer |
| Unrestricted egress, public IPs on tasks | Tasks need ECR, Secrets Manager and CloudWatch, and a NAT gateway would cost about $1 a day | Private subnets with VPC endpoints |
| Mutable ECR tags | Deploys use `latest` with a forced redeploy, which keeps the scripts simple | Tag images with the git commit and make tags immutable |
| No WAF on CloudFront | Extra cost for a short-lived demo | AWS WAF managed rule groups |
| S3 encrypted with S3-managed keys, not customer keys | Keys are still AES-256 and AWS-managed | KMS customer-managed key |

## Alternatives considered

- **One EC2 instance running Docker Compose.** Fastest to set up and cheapest,
  but it's a single server to patch with no managed database or backups, and
  it doesn't show how the services would run in production. Kept as the
  fallback if the ECS deployment isn't ready in time.
- **EKS (Kubernetes).** More flexible, but the control plane alone costs about
  $70 a month and adds a lot of operational work for eight services.
- **Amazon MQ for RabbitMQ.** See Consequences.

# Build from the repository root. Compose mounts these two files; ECS needs them in the image.
FROM quay.io/keycloak/keycloak:26.0
COPY keycloak/supplychain-realm.json /opt/keycloak/data/import/supplychain-realm.json
COPY keycloak/bootstrap.sh /opt/keycloak/bootstrap.sh
ENTRYPOINT ["bash", "/opt/keycloak/bootstrap.sh"]

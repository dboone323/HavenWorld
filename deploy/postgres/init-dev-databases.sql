-- deploy/postgres/init-dev-databases.sql
-- Mounted into the postgres:16 container via docker-compose.dev.yml
-- Initializes BOTH the dev and test databases so the server (.env → havenworld_dev)
--  and Jest (.env.test → havenworld_test) can connect without a separate step.
--
-- POSTGRES_DB=havenworld_dev already created by the image's entrypoint, so we
-- only need to create havenworld_test here (idempotent).
CREATE DATABASE havenworld_test OWNER postgres;

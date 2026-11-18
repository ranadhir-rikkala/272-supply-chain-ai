SELECT 'CREATE DATABASE supplychain_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'supplychain_test')\gexec

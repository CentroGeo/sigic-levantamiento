#!/bin/sh
set -e

echo "⏳ Esperando base de datos..."
until nc -z $PG_HOST $PG_PORT; do
  sleep 2
done

echo "📦 Ejecutando migraciones..."
npx sequelize-cli db:migrate

echo "🚀 Iniciando aplicación..."
exec node index.js

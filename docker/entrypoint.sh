#!/bin/bash
set -e

echo "=== NetCore ISP Docker Entrypoint ==="
echo "Starting services..."

# Function to wait for database
wait_for_db() {
    local host="${DB_HOST:-127.0.0.1}"
    local port="${DB_PORT:-3306}"
    local user="${DB_USERNAME:-root}"
    local pass="${DB_PASSWORD:-}"
    local db="${DB_DATABASE:-netcore_isp}"
    local max_attempts=30
    local attempt=1

    echo "Waiting for database at $host:$port..."
    while [ $attempt -le $max_attempts ]; do
        if mysql -h"$host" -P"$port" -u"$user" -p"$pass" -e "SELECT 1" "$db" >/dev/null 2>&1; then
            echo "Database is ready!"
            return 0
        fi
        echo "Attempt $attempt/$max_attempts: Database not ready, waiting..."
        sleep 2
        attempt=$((attempt + 1))
    done

    echo "ERROR: Database not available after $max_attempts attempts"
    return 1
}

# Function to run migrations
run_migrations() {
    echo "Running database migrations..."
    if [ -f /var/www/html/artisan ]; then
        php /var/www/html/artisan migrate --force || true
    fi

    # Run SQL migrations directly if needed
    for migration in /var/www/html/database/migrations/*.sql; do
        if [ -f "$migration" ]; then
            echo "Running migration: $(basename "$migration")"
            mysql -h"${DB_HOST:-127.0.0.1}" -P"${DB_PORT:-3306}" -u"${DB_USERNAME:-root}" -p"${DB_PASSWORD:-}" "${DB_DATABASE:-netcore_isp}" < "$migration" 2>/dev/null || true
        fi
    done
}

# Function to set permissions
set_permissions() {
    echo "Setting permissions..."
    chown -R nginx:nginx /var/www/html/storage /var/www/html/public 2>/dev/null || true
    chmod -R 777 /var/www/html/storage 2>/dev/null || true
}

# Main execution
main() {
    echo "Environment: ${APP_ENV:-production}"
    echo "APP_URL: ${APP_URL:-http://localhost}"

    # Wait for database
    wait_for_db

    # Run migrations
    run_migrations

    # Set permissions
    set_permissions

    # Create supervisor log directory
    mkdir -p /var/log/supervisor
    mkdir -p /var/log/nginx
    mkdir -p /var/log/php-fpm
    mkdir -p /var/log/php-fpm

    # Start supervisor (which manages nginx, php-fpm, cron)
    echo "Starting supervisord..."
    exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
}

# Trap signals for graceful shutdown
trap 'echo "Shutting down..."; kill $(jobs -p); exit 0' SIGTERM SIGINT

# Run main
main "$@"
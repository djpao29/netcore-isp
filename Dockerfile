# Multi-stage Docker build for NetCore ISP
# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY vite.config.ts ./
COPY tsconfig.json ./
COPY shared/ ./shared/
COPY src/ ./src/
COPY index.html ./

# Install dependencies
RUN npm ci

# Build frontend
RUN npm run build

# Stage 2: PHP dependencies
FROM composer:2 AS php-dependencies

WORKDIR /app

COPY composer.json composer.lock* ./
RUN composer install --no-dev --optimize-autoloader --no-interaction --no-scripts || true

# Stage 3: Production image
FROM php:8.2-fpm-alpine AS production

# Install system dependencies
RUN apk add --no-cache \
    nginx \
    supervisor \
    mysql-client \
    libpng-dev \
    libzip-dev \
    oniguruma-dev \
    libxml2-dev \
    curl \
    openssl \
    bash

# Install PHP extensions
RUN docker-php-ext-install -j$(nproc) \
    pdo \
    pdo_mysql \
    mbstring \
    zip \
    xml \
    bcmath \
    opcache

# Configure PHP
COPY docker/php.ini /usr/local/etc/php/conf.d/custom.ini
COPY docker/php-fpm.conf /usr/local/etc/php-fpm.d/www.conf

# Configure Nginx
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/nginx-site.conf /etc/nginx/sites-enabled/default

# Configure Supervisor
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Create application directory
WORKDIR /var/www/html

# Copy application files
COPY --from=frontend-builder /app/dist ./dist
COPY --from=php-dependencies /app/vendor ./vendor
COPY app/ ./app/
COPY config/ ./config/
COPY database/ ./database/
COPY artisan cron.php ./
COPY server.modules.ts server.ts shared/ ./
COPY src/ ./src/
COPY index.html ./

# Create storage directory
RUN mkdir -p storage && chmod -R 777 storage

# Create startup script
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Expose ports
EXPOSE 80 443

# Start services
ENTRYPOINT ["/entrypoint.sh"]
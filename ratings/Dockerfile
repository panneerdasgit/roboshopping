#
# Build stage: install PHP dependencies with Composer
#
FROM composer:2 AS vendor
WORKDIR /app

# Copy composer.json (and composer.lock if it exists)
COPY composer.json ./
# Only copy composer.lock if present
COPY composer.lock* ./

# Install dependencies (no dev, optimized autoloader)
RUN COMPOSER_MEMORY_LIMIT=-1 composer install --no-dev --optimize-autoloader --no-scripts --no-progress

# Copy the application source
COPY html/ /app

#
# Runtime stage: PHP + Apache
#
FROM php:8.1-apache

# Install system dependencies + PHP extensions
RUN apt-get update && apt-get install -y unzip libzip-dev git \
    && docker-php-ext-install pdo_mysql opcache zip \
    && rm -rf /var/lib/apt/lists/*

# Enable Apache modules
RUN a2enmod rewrite status

# Copy Apache status config
COPY status.conf /etc/apache2/mods-available/status.conf

WORKDIR /var/www/html

# Copy app code + vendor deps from build stage
COPY --from=vendor /app /var/www/html

# Symfony writable dirs
RUN mkdir -p /var/www/html/var/cache /var/www/html/var/log \
 && chown -R www-data:www-data /var/www/html/var \
 && chmod -R 775 /var/www/html/var

EXPOSE 80
CMD ["apache2-foreground"]

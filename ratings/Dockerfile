FROM php:8.1-apache

# Install system dependencies
RUN apt-get update && apt-get install -y unzip libzip-dev git \
    && docker-php-ext-install pdo_mysql opcache zip

# Enable Apache mods
RUN a2enmod rewrite status

# Copy status config
COPY status.conf /etc/apache2/mods-available/status.conf

WORKDIR /var/www/html

# Copy application code
COPY html/ /var/www/html

# Install Composer (multi-stage safer)
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# Install PHP dependencies
RUN COMPOSER_MEMORY_LIMIT=-1 composer install --no-dev --optimize-autoloader

# Symfony requires writable var/cache and var/log
RUN chown -R www-data:www-data /var/www/var && chmod -R 775 /var/www/var

FROM php:7.4-apache

RUN apt-get update && apt-get install -yqq unzip libzip-dev \
  && docker-php-ext-install pdo_mysql opcache zip

COPY status.conf /etc/apache2/mods-available/status.conf
RUN a2enmod rewrite && a2enmod status

WORKDIR /var/www/html

# ✅ copy from context "ratings/html/" into current WORKDIR
COPY ./html/ ./

# If you vendored deps locally, you’re done.
# If not, run composer inside (requires network/DNS):
# COPY --from=composer /usr/bin/composer /usr/bin/composer
# RUN composer install --no-dev --prefer-dist --no-interaction

RUN rm -Rf /var/www/var/* \
 && chown -R www-data /var/www \
 && chmod -R 777 /var/www

#!/usr/bin/env bash

BASE_DIR=/usr/share/nginx/html

if [ -n "$1" ]; then
    exec "$@"
fi

# EUM disabled: always copy empty.html
echo "Instana EUM is disabled"
cp $BASE_DIR/empty.html $BASE_DIR/eum.html

# Ensure proper permissions
chmod 644 $BASE_DIR/eum.html

# Apply environment variables to default.conf
envsubst '${CATALOGUE_HOST} ${USER_HOST} ${CART_HOST} ${SHIPPING_HOST} ${PAYMENT_HOST} ${RATINGS_HOST}' \
    < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf

# Skip Instana tracing patch
echo "Tracing not enabled"

exec nginx-debug -g "daemon off;"

import random
import os
import sys
import time
import logging
import uuid
import json
import requests
from flask import Flask, Response, request, jsonify
from rabbitmq import Publisher
import prometheus_client
from prometheus_client import Counter, Histogram

app = Flask(__name__)
app.logger.setLevel(logging.INFO)

CART = os.getenv('CART_HOST', 'cart')
USER = os.getenv('USER_HOST', 'user')
PAYMENT_GATEWAY = os.getenv('PAYMENT_GATEWAY', 'https://paypal.com/')

# Prometheus Metrics
PromMetrics = {
    'SOLD_COUNTER': Counter('sold_count', 'Running count of items sold'),
    'AUS': Histogram('units_sold', 'Average Unit Sale', buckets=(1, 2, 5, 10, 100)),
    'AVS': Histogram('cart_value', 'Average Value Sale', buckets=(100, 200, 500, 1000, 2000, 5000, 10000))
}


@app.errorhandler(Exception)
def exception_handler(err):
    app.logger.error(str(err))
    return str(err), 500


@app.route('/health', methods=['GET'])
def health():
    return 'OK'


@app.route('/metrics', methods=['GET'])
def metrics():
    res = []
    for m in PromMetrics.values():
        res.append(prometheus_client.generate_latest(m))
    return Response(res, mimetype='text/plain')


@app.route('/pay/<id>', methods=['POST'])
def pay(id):
    app.logger.info(f'payment for {id}')
    cart = request.get_json()
    app.logger.info(cart)

    anonymous_user = True

    # Check user exists
    try:
        req = requests.get(f'http://{USER}:8080/check/{id}')
    except requests.exceptions.RequestException as err:
        app.logger.error(err)
        return str(err), 500

    if req.status_code == 200:
        anonymous_user = False

    # Validate cart
    has_shipping = any(item.get('sku') == 'SHIP' for item in cart.get('items', []))
    if cart.get('total', 0) == 0 or not has_shipping:
        app.logger.warning('cart not valid')
        return 'cart not valid', 400

    # Dummy call to payment gateway
    try:
        req = requests.get(PAYMENT_GATEWAY)
        app.logger.info(f'{PAYMENT_GATEWAY} returned {req.status_code}')
    except requests.exceptions.RequestException as err:
        app.logger.error(err)
        return str(err), 500

    if req.status_code != 200:
        return 'payment error', req.status_code

    # Prometheus
    item_count = countItems(cart.get('items', []))
    PromMetrics['SOLD_COUNTER'].inc(item_count)
    PromMetrics['AUS'].observe(item_count)
    PromMetrics['AVS'].observe(cart.get('total', 0))

    # Generate order ID
    orderid = str(uuid.uuid4())
    queueOrder({ 'orderid': orderid, 'user': id, 'cart': cart })

    # Add to order history
    if not anonymous_user:
        try:
            req = requests.post(
                f'http://{USER}:8080/order/{id}',
                data=json.dumps({'orderid': orderid, 'cart': cart}),
                headers={'Content-Type': 'application/json'}
            )
            app.logger.info(f'order history returned {req.status_code}')
        except requests.exceptions.RequestException as err:
            app.logger.error(err)
            return str(err), 500

    # Delete cart
    try:
        req = requests.delete(f'http://{CART}:8080/cart/{id}')
        app.logger.info(f'cart delete returned {req.status_code}')
    except requests.exceptions.RequestException as err:
        app.logger.error(err)
        return str(err), 500

    if req.status_code != 200:
        return 'order history update error', req.status_code

    return jsonify({ 'orderid': orderid })


def queueOrder(order):
    app.logger.info('queue order')
    delay = int(os.getenv('PAYMENT_DELAY_MS', 0))
    time.sleep(delay / 1000)
    headers = {}
    publisher.publish(order, headers)


def countItems(items):
    return sum(item.get('qty') for item in items if item.get('sku') != 'SHIP')


# RabbitMQ publisher
publisher = Publisher(app.logger)

if __name__ == "__main__":
    sh = logging.StreamHandler(sys.stdout)
    sh.setLevel(logging.INFO)
    fmt = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    app.logger.info(f'Payment gateway {PAYMENT_GATEWAY}')
    port = int(os.getenv("SHOP_PAYMENT_PORT", "8080"))
    app.logger.info(f'Starting on port {port}')
    app.run(host='0.0.0.0', port=port)

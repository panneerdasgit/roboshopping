const redis = require('redis');
const request = require('request');
const bodyParser = require('body-parser');
const express = require('express');
const pino = require('pino');
const expPino = require('express-pino-logger');

// Prometheus
const promClient = require('prom-client');
const Registry = promClient.Registry;
const register = new Registry();
const counter = new promClient.Counter({
    name: 'items_added',
    help: 'running count of items added to cart',
    registers: [register]
});

var redisConnected = false;
var redisHost = process.env.REDIS_HOST || 'redis';
var catalogueHost = process.env.CATALOGUE_HOST || 'catalogue';

const logger = pino({
    level: 'info',
    prettyPrint: false,
    useLevelLabels: true
});
const expLogger = expPino({ logger });

const app = express();
app.use(expLogger);

// CORS headers
app.use((req, res, next) => {
    res.set('Timing-Allow-Origin', '*');
    res.set('Access-Control-Allow-Origin', '*');
    next();
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ app: 'OK', redis: redisConnected });
});

// Prometheus metrics
app.get('/metrics', (req, res) => {
    res.header('Content-Type', 'text/plain');
    res.send(register.metrics());
});

// get cart
app.get('/cart/:id', (req, res) => {
    redisClient.get(req.params.id, (err, data) => {
        if (err) {
            req.log.error('ERROR', err);
            res.status(500).send(err);
        } else {
            if (data == null) {
                res.status(404).send('cart not found');
            } else {
                res.set('Content-Type', 'application/json');
                res.send(data);
            }
        }
    });
});

// delete cart
app.delete('/cart/:id', (req, res) => {
    redisClient.del(req.params.id, (err, data) => {
        if (err) {
            req.log.error('ERROR', err);
            res.status(500).send(err);
        } else {
            res.send(data === 1 ? 'OK' : 'cart not found');
        }
    });
});

// rename cart
app.get('/rename/:from/:to', (req, res) => {
    redisClient.get(req.params.from, (err, data) => {
        if (err) return res.status(500).send(err);
        if (!data) return res.status(404).send('cart not found');
        var cart = JSON.parse(data);
        saveCart(req.params.to, cart)
            .then(() => res.json(cart))
            .catch(err => res.status(500).send(err));
    });
});

// add to cart
app.get('/add/:id/:sku/:qty', (req, res) => {
    var qty = parseInt(req.params.qty);
    if (isNaN(qty) || qty < 1) {
        return res.status(400).send('quantity must be a number > 0');
    }

    getProduct(req.params.sku)
        .then(product => {
            if (!product) return res.status(404).send('product not found');
            if (product.instock === 0) return res.status(404).send('out of stock');

            redisClient.get(req.params.id, (err, data) => {
                if (err) return res.status(500).send(err);

                var cart = data ? JSON.parse(data) : { total: 0, tax: 0, items: [] };
                var item = {
                    qty: qty,
                    sku: req.params.sku,
                    name: product.name,
                    price: product.price,
                    subtotal: qty * product.price
                };
                cart.items = mergeList(cart.items, item, qty);
                cart.total = calcTotal(cart.items);
                cart.tax = calcTax(cart.total);

                saveCart(req.params.id, cart)
                    .then(() => {
                        counter.inc(qty);
                        res.json(cart);
                    })
                    .catch(err => res.status(500).send(err));
            });
        })
        .catch(err => res.status(500).send(err));
});

// update quantity
app.get('/update/:id/:sku/:qty', (req, res) => {
    var qty = parseInt(req.params.qty);
    if (isNaN(qty) || qty < 0) {
        return res.status(400).send('invalid quantity');
    }

    redisClient.get(req.params.id, (err, data) => {
        if (err) return res.status(500).send(err);
        if (!data) return res.status(404).send('cart not found');

        var cart = JSON.parse(data);
        var idx = cart.items.findIndex(i => i.sku === req.params.sku);

        if (idx === -1) return res.status(404).send('not in cart');

        if (qty === 0) {
            cart.items.splice(idx, 1);
        } else {
            cart.items[idx].qty = qty;
            cart.items[idx].subtotal = cart.items[idx].price * qty;
        }

        cart.total = calcTotal(cart.items);
        cart.tax = calcTax(cart.total);

        saveCart(req.params.id, cart)
            .then(() => res.json(cart))
            .catch(err => res.status(500).send(err));
    });
});

// add shipping
app.post('/shipping/:id', (req, res) => {
    const { distance, cost, location } = req.body;
    if (distance === undefined || cost === undefined || !location) {
        return res.status(400).send('shipping data missing');
    }

    redisClient.get(req.params.id, (err, data) => {
        if (err) return res.status(500).send(err);
        if (!data) return res.status(404).send('cart not found');

        var cart = JSON.parse(data);
        var item = {
            qty: 1,
            sku: 'SHIP',
            name: 'shipping to ' + location,
            price: cost,
            subtotal: cost
        };
        var idx = cart.items.findIndex(i => i.sku === 'SHIP');
        if (idx === -1) {
            cart.items.push(item);
        } else {
            cart.items[idx] = item;
        }

        cart.total = calcTotal(cart.items);
        cart.tax = calcTax(cart.total);

        saveCart(req.params.id, cart)
            .then(() => res.json(cart))
            .catch(err => res.status(500).send(err));
    });
});

// Helper functions
function mergeList(list, product, qty) {
    var idx = list.findIndex(i => i.sku === product.sku);
    if (idx !== -1) {
        list[idx].qty += qty;
        list[idx].subtotal = list[idx].price * list[idx].qty;
    } else {
        list.push(product);
    }
    return list;
}

function calcTotal(list) {
    return list.reduce((total, item) => total + item.subtotal, 0);
}

function calcTax(total) {
    return total - (total / 1.2);
}

function getProduct(sku) {
    return new Promise((resolve, reject) => {
        request(`http://${catalogueHost}:8080/product/${sku}`, (err, res, body) => {
            if (err) return reject(err);
            if (res.statusCode !== 200) return resolve(null);
            resolve(JSON.parse(body));
        });
    });
}

function saveCart(id, cart) {
    logger.info('saving cart', cart);
    return new Promise((resolve, reject) => {
        redisClient.setex(id, 3600, JSON.stringify(cart), (err, data) => {
            if (err) reject(err);
            else resolve(data);
        });
    });
}

// Connect to Redis
var redisClient = redis.createClient({ host: redisHost });

redisClient.on('error', (e) => logger.error('Redis ERROR', e));
redisClient.on('ready', (r) => {
    logger.info('Redis READY', r);
    redisConnected = true;
});

// Start server
const port = process.env.CART_SERVER_PORT || '8080';
app.listen(port, () => {
    logger.info('Started on port', port);
});

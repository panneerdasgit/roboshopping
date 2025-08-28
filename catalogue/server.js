// ---- Optional Instana instrumentation (safe/no-op when not installed) ----
let instana = null;

try {
  const ENABLED = String(process.env.INSTANA_ENABLED || 'false').toLowerCase() === 'true';
  const collector = require('@instana/collector');
  instana = collector({
    tracing: { enabled: ENABLED }
  });
  console.log(`[instana] collector loaded (tracing enabled: ${ENABLED})`);
} catch (e) {
  console.warn(`[instana] not available, continuing without APM: ${e.message}`);
  instana = {
    currentSpan: () => ({ annotate: () => {} })
  };
}
// --------------------------------------------------------------------------

const mongoClient = require('mongodb').MongoClient;
const mongoObjectID = require('mongodb').ObjectID;
const bodyParser = require('body-parser');
const express = require('express');
const pino = require('pino');
const expPino = require('express-pino-logger');

const logger = pino({
  level: 'info',
  prettyPrint: false,
  useLevelLabels: true
});
const expLogger = expPino({ logger });

let db;
let collection;
let mongoConnected = false;

const app = express();

app.use(expLogger);

app.use((req, res, next) => {
  res.set('Timing-Allow-Origin', '*');
  res.set('Access-Control-Allow-Origin', '*');
  next();
});

app.use((req, res, next) => {
  const dcs = [
    'asia-northeast2',
    'asia-south1',
    'europe-west3',
    'us-east1',
    'us-west1'
  ];
  const span = instana && typeof instana.currentSpan === 'function' ? instana.currentSpan() : null;
  if (span && typeof span.annotate === 'function') {
    span.annotate('custom.sdk.tags.datacenter', dcs[Math.floor(Math.random() * dcs.length)]);
  }
  next();
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.get('/health', (_req, res) => {
  const stat = { app: 'OK', mongo: mongoConnected };
  res.json(stat);
});

app.get('/products', (req, res) => {
  if (mongoConnected) {
    collection.find({}).toArray()
      .then(products => res.json(products))
      .catch(e => {
        req.log.error('ERROR', e);
        res.status(500).send(e);
      });
  } else {
    req.log.error('database not available');
    res.status(500).send('database not available');
  }
});

// ⚠️ Existing SKU-based route (keep if needed)
app.get('/product/:sku', (req, res) => {
  if (mongoConnected) {
    const delay = process.env.GO_SLOW || 0;
    setTimeout(() => {
      collection.findOne({ sku: req.params.sku })
        .then(product => {
          req.log.info('product', product);
          if (product) {
            res.json(product);
          } else {
            res.status(404).send('SKU not found');
          }
        })
        .catch(e => {
          req.log.error('ERROR', e);
          res.status(500).send(e);
        });
    }, delay);
  } else {
    req.log.error('database not available');
    res.status(500).send('database not available');
  }
});

// ✅ NEW: Get product by Mongo ObjectID
app.get('/product/id/:id', (req, res) => {
  if (mongoConnected) {
    const delay = process.env.GO_SLOW || 0;
    setTimeout(() => {
      try {
        const objectId = new mongoObjectID(req.params.id);
        collection.findOne({ _id: objectId })
          .then(product => {
            req.log.info('product', product);
            if (product) {
              res.json(product);
            } else {
              res.status(404).send('Product not found');
            }
          })
          .catch(e => {
            req.log.error('ERROR', e);
            res.status(500).send(e);
          });
      } catch (err) {
        res.status(400).send('Invalid ID format');
      }
    }, delay);
  } else {
    req.log.error('database not available');
    res.status(500).send('database not available');
  }
});

app.get('/products/:cat', (req, res) => {
  if (mongoConnected) {
    collection.find({ categories: req.params.cat }).sort({ name: 1 }).toArray()
      .then(products => {
        if (products) {
          res.json(products);
        } else {
          res.status(404).send('No products for ' + req.params.cat);
        }
      })
      .catch(e => {
        req.log.error('ERROR', e);
        res.status(500).send(e);
      });
  } else {
    req.log.error('database not available');
    res.status(500).send('database not avaiable');
  }
});

app.get('/categories', (req, res) => {
  if (mongoConnected) {
    collection.distinct('categories')
      .then(categories => res.json(categories))
      .catch(e => {
        req.log.error('ERROR', e);
        res.status(500).send(e);
      });
  } else {
    req.log.error('database not available');
    res.status(500).send('database not available');
  }
});

app.get('/search/:text', (req, res) => {
  if (mongoConnected) {
    collection.find({ '$text': { '$search': req.params.text } }).toArray()
      .then(hits => res.json(hits))
      .catch(e => {
        req.log.error('ERROR', e);
        res.status(500).send(e);
      });
  } else {
    req.log.error('database not available');
    res.status(500).send('database not available');
  }
});

function mongoConnect() {
  return new Promise((resolve, reject) => {
    const mongoURL = process.env.MONGO_URL || 'mongodb://mongodb:27017/catalogue';
    mongoClient.connect(mongoURL, (error, client) => {
      if (error) {
        reject(error);
      } else {
        db = client.db('catalogue');
        collection = db.collection('products');
        resolve('connected');
      }
    });
  });
}

function mongoLoop() {
  mongoConnect()
    .then(() => {
      mongoConnected = true;
      logger.info('MongoDB connected');
    })
    .catch(e => {
      logger.error('ERROR', e);
      setTimeout(mongoLoop, 2000);
    });
}

mongoLoop();

const port = process.env.CATALOGUE_SERVER_PORT || process.env.PORT || '8080';
app.listen(port, () => {
  logger.info('Started on port', port);
});

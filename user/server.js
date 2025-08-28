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
  instana = { currentSpan: () => ({ annotate: () => {} }) };
}
// --------------------------------------------------------------------------

const mongoClient = require('mongodb').MongoClient;
const mongoObjectID = require('mongodb').ObjectID;
const redis = require('redis');
const bodyParser = require('body-parser');
const express = require('express');
const pino = require('pino');
const expPino = require('express-pino-logger');

// MongoDB
let db;
let usersCollection;
let ordersCollection;
let mongoConnected = false;

const logger = pino({
  level: 'info',
  prettyPrint: false,
  useLevelLabels: true
});
const expLogger = expPino({ logger });

const app = express();
app.use(expLogger);

// CORS
app.use((req, res, next) => {
  res.set('Timing-Allow-Origin', '*');
  res.set('Access-Control-Allow-Origin', '*');
  next();
});

// Optional span annotation (works even if Instana isn’t installed)
app.use((req, res, next) => {
  const dcs = ['asia-northeast2', 'asia-south1', 'europe-west3', 'us-east1', 'us-west1'];
  const span = instana && typeof instana.currentSpan === 'function' ? instana.currentSpan() : null;
  if (span && typeof span.annotate === 'function') {
    span.annotate('custom.sdk.tags.datacenter', dcs[Math.floor(Math.random() * dcs.length)]);
  }
  next();
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.get('/health', (_req, res) => {
  res.json({ app: 'OK', mongo: mongoConnected });
});

// use REDIS INCR to track anonymous users
app.get('/uniqueid', (req, res) => {
  redisClient.incr('anonymous-counter', (err, r) => {
    if (!err) {
      res.json({ uuid: 'anonymous-' + r });
    } else {
      req.log.error('ERROR', err);
      res.status(500).send(err);
    }
  });
});

// check user exists
app.get('/check/:id', (req, res) => {
  if (mongoConnected) {
    usersCollection.findOne({ name: req.params.id }).then((user) => {
      if (user) {
        res.send('OK');
      } else {
        res.status(404).send('user not found');
      }
    }).catch((e) => {
      req.log.error(e);
      res.status(500).send(e); // fixed: was res.send(500).send(e)
    });
  } else {
    req.log.error('database not available');
    res.status(500).send('database not available');
  }
});

// return all users (debug only)
app.get('/users', (req, res) => {
  if (mongoConnected) {
    usersCollection.find().toArray().then((users) => {
      res.json(users);
    }).catch((e) => {
      req.log.error('ERROR', e);
      res.status(500).send(e);
    });
  } else {
    req.log.error('database not available');
    res.status(500).send('database not available');
  }
});

app.post('/login', (req, res) => {
  req.log.info('login', req.body);
  if (req.body.name === undefined || req.body.password === undefined) {
    req.log.warn('credentials not complete');
    res.status(400).send('name or password not supplied');
  } else if (mongoConnected) {
    usersCollection.findOne({ name: req.body.name }).then((user) => {
      req.log.info('user', user);
      if (user) {
        if (user.password == req.body.password) {
          res.json(user);
        } else {
          res.status(404).send('incorrect password');
        }
      } else {
        res.status(404).send('name not found');
      }
    }).catch((e) => {
      req.log.error('ERROR', e);
      res.status(500).send(e);
    });
  } else {
    req.log.error('database not available');
    res.status(500).send('database not available');
  }
});

// TODO - validate email address format
app.post('/register', (req, res) => {
  req.log.info('register', req.body);
  if (req.body.name === undefined || req.body.password === undefined || req.body.email === undefined) {
    req.log.warn('insufficient data');
    res.status(400).send('insufficient data');
  } else if (mongoConnected) {
    usersCollection.findOne({ name: req.body.name }).then((user) => {
      if (user) {
        req.log.warn('user already exists');
        res.status(400).send('name already exists');
      } else {
        usersCollection.insertOne({
          name: req.body.name,
          password: req.body.password,
          email: req.body.email
        }).then((r) => {
          req.log.info('inserted', r.result);
          res.send('OK');
        }).catch((e) => {
          req.log.error('ERROR', e);
          res.status(500).send(e);
        });
      }
    }).catch((e) => {
      req.log.error('ERROR', e);
      res.status(500).send(e);
    });
  } else {
    req.log.error('database not available');
    res.status(500).send('database not available');
  }
});

app.post('/order/:id', (req, res) => {
  req.log.info('order', req.body);
  if (mongoConnected) {
    usersCollection.findOne({ name: req.params.id }).then((user) => {
      if (user) {
        ordersCollection.findOne({ name: req.params.id }).then((history) => {
          if (history) {
            const list = history.history;
            list.push(req.body);
            ordersCollection.updateOne(
              { name: req.params.id },
              { $set: { history: list } }
            ).then(() => res.send('OK'))
             .catch((e) => { req.log.error(e); res.status(500).send(e); });
          } else {
            ordersCollection.insertOne({
              name: req.params.id,
              history: [req.body]
            }).then(() => res.send('OK'))
             .catch((e) => { req.log.error(e); res.status(500).send(e); });
          }
        }).catch((e) => { req.log.error(e); res.status(500).send(e); });
      } else {
        res.status(404).send('name not found');
      }
    }).catch((e) => { req.log.error(e); res.status(500).send(e); });
  } else {
    req.log.error('database not available');
    res.status(500).send('database not available');
  }
});

app.get('/history/:id', (req, res) => {
  if (mongoConnected) {
    ordersCollection.findOne({ name: req.params.id }).then((history) => {
      if (history) {
        res.json(history);
      } else {
        res.status(404).send('history not found');
      }
    }).catch((e) => { req.log.error(e); res.status(500).send(e); });
  } else {
    req.log.error('database not available');
    res.status(500).send('database not available');
  }
});

// connect to Redis (legacy API used by this app)
const redisClient = redis.createClient({
  host: process.env.REDIS_HOST || 'redis'
});
redisClient.on('error', (e) => logger.error('Redis ERROR', e));
redisClient.on('ready', (r) => logger.info('Redis READY', r));

// set up Mongo
function mongoConnect() {
  return new Promise((resolve, reject) => {
    const mongoURL = process.env.MONGO_URL || 'mongodb://mongodb:27017/users';
    mongoClient.connect(mongoURL, (error, client) => {
      if (error) {
        reject(error);
      } else {
        db = client.db('users');
        usersCollection = db.collection('users');
        ordersCollection = db.collection('orders');
        resolve('connected');
      }
    });
  });
}

function mongoLoop() {
  mongoConnect().then(() => {
    mongoConnected = true;
    logger.info('MongoDB connected');
  }).catch((e) => {
    logger.error('ERROR', e);
    setTimeout(mongoLoop, 2000);
  });
}
mongoLoop();

// fire it up!
const port = process.env.USER_SERVER_PORT || process.env.PORT || '8080';
app.listen(port, () => {
  logger.info('Started on port', port);
});

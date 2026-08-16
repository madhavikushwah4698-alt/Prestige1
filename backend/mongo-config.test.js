const assert = require('node:assert/strict');
const { resolveMongoConfig } = require('./server');

assert.throws(
  () => resolveMongoConfig({ NODE_ENV: 'production', VERCEL: '1' }),
  /MONGODB_URI.*MongoDB/i,
  'Production deployments without MONGODB_URI should fail fast.'
);

assert.equal(
  resolveMongoConfig({ NODE_ENV: 'development' }),
  'mongodb://127.0.0.1:27017',
  'Local development should still fall back to localhost MongoDB.'
);

console.log('Mongo config checks passed.');

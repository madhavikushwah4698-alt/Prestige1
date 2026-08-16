const { resolveMongoConfig } = require('./server');

let failed = false;

try {
  resolveMongoConfig({ NODE_ENV: 'production', VERCEL: '1' });
  console.log('PRODUCTION_CHECK: no error');
  failed = true;
} catch (error) {
  console.log('PRODUCTION_CHECK: ' + error.message);
}

const localConfig = resolveMongoConfig({ NODE_ENV: 'development' });
console.log('LOCAL_CHECK: ' + localConfig.MONGODB_URI);

if (failed) {
  process.exit(1);
}

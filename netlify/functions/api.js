const serverless = require('serverless-http');
const { app, initializeDatabase } = require('../../server');

const handler = serverless(app, {
    basePath: '/.netlify/functions/api'
});

exports.handler = async (event, context) => {
    await initializeDatabase();
    return handler(event, context);
};

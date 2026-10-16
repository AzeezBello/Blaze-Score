// Vercel serverless entry: reuse the same request handler as `node server.js`.
import { createApp } from '../server.js';

const app = createApp();
export default (req, res) => app.emit('request', req, res);

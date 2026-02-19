/**
 * Vercelデプロイ用: 環境変数から config.js を生成
 * OPENAI_API_KEY を Vercel の環境変数で設定してください
 */
const fs = require('fs');
const path = require('path');

const apiKey = process.env.OPENAI_API_KEY || '';
const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const content = `window.INVOICE_CONFIG = {
  OPENAI_API_KEY: "${apiKey.replace(/"/g, '\\"')}",
  OPENAI_MODEL: "${model.replace(/"/g, '\\"')}"
};
`;

fs.writeFileSync(path.join(__dirname, 'config.js'), content);
console.log('config.js generated');

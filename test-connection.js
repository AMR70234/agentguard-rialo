require('dotenv').config();
const { initiateDeveloperControlledWalletsClient } = require('@circle-fin/developer-controlled-wallets');

const client = initiateDeveloperControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY,
});

async function testConnection() {
  try {
    const response = await client.listWallets();
    console.log('✅ الاتصال نجح! المحافظ الموجودة حاليًا:');
    console.log(response.data);
  } catch (error) {
    console.error('❌ في مشكلة في الاتصال:', error.message);
  }
}

testConnection();
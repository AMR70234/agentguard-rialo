require('dotenv').config();
const client = require('./circleClient');

async function checkTransaction(txId) {
  try {
    const response = await client.getTransaction({ id: txId });
    console.log('✅ حالة المعاملة:', response.data.transaction.state);
    console.log(response.data.transaction);
  } catch (error) {
    console.error('❌ في مشكلة:', error.message);
  }
}

checkTransaction('d1c9e999-7a49-5a3a-ba84-60a4e8969d75');

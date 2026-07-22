#!/bin/bash

echo "════════════════════════════════════════════════════════"
echo "🔍  AgentGuard - Verification Script"
echo "════════════════════════════════════════════════════════"
echo ""

# 1. التحقق من escrowJob.js
echo "📝 1. Checking escrowJob.js..."
if grep -q "DISPUTE_WINDOW_MS = 60000" escrowJob.js; then
    echo "   ✅ DISPUTE_WINDOW_MS = 60000 (60 seconds)"
else
    echo "   ❌ DISPUTE_WINDOW_MS is NOT 60000"
    grep "DISPUTE_WINDOW_MS" escrowJob.js || echo "   ⚠️  Variable not found!"
fi
echo ""

# 2. التحقق من public/index.html
echo "📝 2. Checking public/index.html..."
if grep -q "startDisputeCountdown(data.jobId, data.disputeWindowMs || 60000)" public/index.html; then
    echo "   ✅ disputeWindowMs fallback = 60000"
else
    echo "   ❌ disputeWindowMs fallback is NOT 60000"
    grep "startDisputeCountdown" public/index.html || echo "   ⚠️  Function not found!"
fi

if grep -q "You have.*s to dispute this result" public/index.html; then
    TIMER_TEXT=$(grep "You have.*s to dispute this result" public/index.html | head -1)
    echo "   📌 Timer text: $TIMER_TEXT"
fi
echo ""

# 3. التحقق من db.js
echo "📝 3. Checking db.js..."
if [ -f "db.js" ]; then
    echo "   ✅ db.js exists"
    if grep -q "CREATE TABLE IF NOT EXISTS audit_log" db.js; then
        echo "   ✅ audit_log table defined"
    fi
    if grep -q "CREATE TABLE IF NOT EXISTS reputation" db.js; then
        echo "   ✅ reputation table defined"
    fi
else
    echo "   ❌ db.js NOT found!"
fi
echo ""

# 4. التحقق من reputation.js
echo "📝 4. Checking reputation.js..."
if grep -q "require('./db')" reputation.js; then
    echo "   ✅ reputation.js uses SQLite (db.js)"
else
    echo "   ❌ reputation.js does NOT use SQLite"
fi
echo ""

# 5. التحقق من latchClient.js
echo "📝 5. Checking latchClient.js..."
if grep -q "fetchWithTimeout" latchClient.js; then
    echo "   ✅ latchClient.js has fetchWithTimeout"
fi
if grep -q "retries = 3" latchClient.js; then
    echo "   ✅ latchClient.js has retry logic (3 attempts)"
fi
echo ""

# 6. التحقق من latchCircleClient.js
echo "📝 6. Checking latchCircleClient.js..."
if grep -q "fetchWithTimeout" latchCircleClient.js; then
    echo "   ✅ latchCircleClient.js has fetchWithTimeout"
fi
if grep -q "amountNum > 10" latchCircleClient.js; then
    echo "   ✅ latchCircleClient.js has amount validation (>10 check)"
fi
echo ""

# 7. التحقق من server.js
echo "📝 7. Checking server.js..."
if grep -q "require('./db')" server.js; then
    echo "   ✅ server.js uses db.js (SQLite)"
else
    echo "   ❌ server.js does NOT use db.js"
fi
if grep -q "Keep-Alive" server.js || grep -q "setInterval.*reputation" server.js; then
    echo "   ✅ server.js has Keep-Alive"
fi
echo ""

# 8. التحقق من package.json
echo "📝 8. Checking package.json..."
if grep -q "sqlite3" package.json; then
    echo "   ✅ sqlite3 is in package.json"
fi
if grep -q "solc" package.json; then
    echo "   ✅ solc is in package.json"
fi
echo ""

# 9. التحقق من .env
echo "📝 9. Checking .env..."
if grep -q "OPENAI_API_KEY" .env; then
    echo "   ⚠️  OPENAI_API_KEY still exists (should be removed)"
else
    echo "   ✅ OPENAI_API_KEY is removed"
fi
if grep -q "JSONBIN" .env; then
    echo "   ⚠️  JSONBIN variables still exist (should be removed)"
else
    echo "   ✅ JSONBIN variables are removed"
fi
if grep -q "USDC_TOKEN_ADDRESS" .env; then
    echo "   ✅ USDC_TOKEN_ADDRESS is present"
fi
echo ""

# 10. التحقق من العقد الذكي
echo "📝 10. Checking contract..."
if grep -q "disputeWindow = 60 seconds" contracts/AgentEscrow.sol; then
    echo "   ✅ Contract disputeWindow = 60 seconds"
else
    echo "   ❌ Contract disputeWindow is NOT 60 seconds"
    grep "disputeWindow" contracts/AgentEscrow.sol || echo "   ⚠️  Not found!"
fi
echo ""

# 11. التحقق من عنوان العقد الجديد
echo "📝 11. Checking contract address..."
if grep -q "ESCROW_CONTRACT_ADDRESS=0xef106e1ecbb38648f52bd284e2c2b1b0a6b5a4b3" .env; then
    echo "   ✅ New contract address is set (0xef106e...) "
else
    echo "   ⚠️  Could not verify contract address"
fi
echo ""

# 12. التحقق من node_modules
echo "📝 12. Checking dependencies..."
if [ -d "node_modules/sqlite3" ]; then
    echo "   ✅ sqlite3 is installed"
else
    echo "   ❌ sqlite3 is NOT installed"
fi
if [ -d "node_modules/@openzeppelin/contracts" ]; then
    echo "   ✅ @openzeppelin/contracts is installed"
fi
echo ""

# 13. اختبار بسيط للـ API
echo "📝 13. Testing API..."
if command -v curl &> /dev/null; then
    echo "   ⏳ Testing /reputation endpoint..."
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3002/reputation 2>/dev/null)
    if [ "$RESPONSE" = "200" ]; then
        echo "   ✅ Server is running (HTTP $RESPONSE)"
    else
        echo "   ⚠️  Server not responding (HTTP $RESPONSE) - make sure to run 'node server.js' first"
    fi
else
    echo "   ⚠️  curl not found, skipping API test"
fi
echo ""

echo "════════════════════════════════════════════════════════"
echo "✅ Verification complete!"
echo "════════════════════════════════════════════════════════"

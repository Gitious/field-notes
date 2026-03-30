#!/bin/bash
# Test Nexla webhook - sends a sample field report to Google Drive via Nexla
# Usage: ./test-nexla.sh

source .env 2>/dev/null

URL="${NEXLA_WEBHOOK_URL:-https://hooks-dataops.nexla.io/data-e298e8/118820?api_key=2eb6fe97f13c42a79df2aad2ae347c15}"

echo "Sending test report to Nexla..."
RESPONSE=$(curl -s -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Field Notes Test Report",
    "session_id": "test_session",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "report": "# Test Field Report\n\nThis is a test report from Field Notes.\n\n## Observations\n- Test observation 1\n- Test observation 2",
    "observations_count": 2,
    "categories": ["technology", "environment"]
  }')

echo "Response: $RESPONSE"

if echo "$RESPONSE" | grep -q "processed"; then
  echo "SUCCESS - Data sent to Nexla!"
else
  echo "FAILED - Check the response above"
fi

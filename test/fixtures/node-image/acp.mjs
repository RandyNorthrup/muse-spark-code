import assert from 'node:assert/strict'
assert.equal(process.getuid(), 10_001)
assert.equal(
  Object.keys(process.env).some((name) => /API_KEY|TOKEN|PASSWORD|SECRET/.test(name)),
  false,
)
console.log('M110 terminal attach probe passed')

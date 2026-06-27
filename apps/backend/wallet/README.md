# @delego/wallet

Delego **wallet** service.

## Development

```bash
pnpm --filter @delego/wallet dev
```

Health check: `GET http://localhost:3012/health`

## Public Key Validation

This service uses `@delego/utils` to validate Stellar public keys at route boundaries.

| Export | Purpose |
|---|---|
| `validatePublicKey(key)` | Returns `{ valid, normalized?, error? }` — trims whitespace, rejects secret seeds (`S...`), validates Ed25519 public key (`G...`) |
| `isValidStellarPublicKey(key)` | Boolean shorthand for `validatePublicKey(key).valid` |
| `validatePublicKeyMiddleware(paramName)` | Express middleware that validates a route param and responds with HTTP 400 on failure |

Malformed keys and secret keys are rejected before processing.

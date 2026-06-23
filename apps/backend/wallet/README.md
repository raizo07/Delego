# @delego/wallet

Delego **wallet** service.

## Development

```bash
pnpm --filter @delego/wallet dev
```

Health check: `GET http://localhost:3012/health`

Validation: this service verifies Stellar public keys (StrKey) at route boundaries
and will reject malformed or secret keys with HTTP 400 before processing.

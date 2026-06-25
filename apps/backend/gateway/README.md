# @delego/gateway

Delego **gateway** service.

## Development

```bash
pnpm --filter @delego/gateway dev
```

Health check: `GET http://localhost:3000/health`

## JWT Validation

Access and refresh tokens are validated with [`jsonwebtoken`](https://www.npmjs.com/package/jsonwebtoken).
To tolerate small clock drift between distributed services when validating the
`nbf` (not-before) and `exp` (expiry) claims, the gateway accepts a configurable
clock-skew window.

| Env var                       | Default            | Notes                                                  |
| ----------------------------- | ------------------ | ------------------------------------------------------ |
| `JWT_SECRET`                  | `change-me-...`    | HMAC signing secret. **Must** be overridden in prod.   |
| `JWT_ISSUER`                  | `delego-gateway`   | Expected `iss` claim.                                  |
| `JWT_AUDIENCE`                | `delego-clients`   | Expected `aud` claim.                                  |
| `JWT_CLOCK_TOLERANCE_SECONDS` | `5`                | Allowed clock skew for `nbf` / `exp`. Hard-capped 300. |

The validation contract is exported from
`src/auth/authService.ts` as `JwtValidationConfig`:

```ts
export interface JwtValidationConfig {
  issuer: string;
  audience: string;
  clockToleranceSeconds: number;
}
```

`getJwtValidationConfig()` reads and validates the values from the environment
(invalid/non-numeric values fall back to the default; values above the hard
ceiling are clamped) and `verifyToken()` applies the tolerance to every
verification.

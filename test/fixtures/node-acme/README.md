# Node ACME fixtures (M110e lane A3)

- `example-com-2026-10-22.pem`: the leaf certificate served for
  `example.com` on 2026-10-22, captured with:
  `echo | openssl s_client -connect example.com:443 -servername example.com | openssl x509`
  (subject CN=example.com, SAN DNS:example.com and DNS:*.example.com,
  valid 2026-09-26 to 2026-12-25). The ACME install check reads its
  expiry and names with node:crypto's X509Certificate; no part of the
  product trusts this certificate.

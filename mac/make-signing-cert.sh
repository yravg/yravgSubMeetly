#!/bin/bash
# Create a local self-signed code-signing certificate — ONCE.
#
# Why this exists: an ad-hoc signature (`codesign -s -`) gives the app an
# identity derived from its CDHash, which changes on every rebuild. macOS TCC
# stores Screen Recording / Accessibility / Input Monitoring grants against that
# identity, so each rebuild silently revokes every permission — the app still
# shows up (even switched on) in System Settings but is actually denied.
#
# Signing with a stable certificate instead keeps the identity constant, so you
# grant permissions once and they survive rebuilds.
set -euo pipefail

CERT_NAME="${CERT_NAME:-yraverageSubMin Dev}"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

if security find-identity -v -p codesigning 2>/dev/null | grep -q "$CERT_NAME"; then
    echo "✓ signing identity already exists: $CERT_NAME"
    exit 0
fi

echo "▸ creating self-signed code-signing certificate: $CERT_NAME"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/openssl.cnf" <<'CNF'
[ req ]
distinguished_name = dn
x509_extensions = v3
prompt = no
[ dn ]
CN = yraverageSubMin Dev
[ v3 ]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
CNF

openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout "$TMP/key.pem" -out "$TMP/cert.pem" -config "$TMP/openssl.cnf" 2>/dev/null

# A non-empty password plus SHA1/3DES: the macOS keychain importer rejects
# OpenSSL 3's modern PKCS12 defaults ("MAC verification failed").
P12PASS=transsub
openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" \
    -out "$TMP/identity.p12" -passout "pass:$P12PASS" -name "$CERT_NAME" \
    -macalg sha1 -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES 2>/dev/null \
  || openssl pkcs12 -export -legacy -inkey "$TMP/key.pem" -in "$TMP/cert.pem" \
    -out "$TMP/identity.p12" -passout "pass:$P12PASS" -name "$CERT_NAME" 2>/dev/null

# -T /usr/bin/codesign pre-authorizes codesign so it won't prompt on every build.
security import "$TMP/identity.p12" -k "$KEYCHAIN" -P "$P12PASS" \
    -T /usr/bin/codesign -T /usr/bin/security >/dev/null

# Allow codesign to use the key without an interactive prompt each time.
security set-key-partition-list -S apple-tool:,apple:,codesign: \
    -s -k "" "$KEYCHAIN" >/dev/null 2>&1 || \
    echo "  (note: macOS may ask you to 'Always Allow' the first time you build)"

echo "✓ created. Rebuild with ./build-app.sh — permissions will now persist."

"""Verify JWT decode works correctly. Reads secret from .env."""
import os
import jwt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env_path = os.path.join(ROOT, 'supabase-psa', '.env')
secret = None
with open(env_path) as f:
    for line in f:
        if line.startswith('JWT_SECRET='):
            secret = line.split('=', 1)[1].strip()
            break

if not secret:
    print("FAIL: JWT_SECRET not found")
    sys.exit(1)

# Test 1: decode a valid token
token = jwt.encode({"role": "anon", "iss": "supabase"}, secret, algorithm="HS256")
claims = jwt.decode(token, secret, algorithms=["HS256"], options={"verify_exp": True})
assert claims["role"] == "anon"
print("PASS: valid token decodes correctly")

# Test 2: reject invalid token
try:
    jwt.decode("invalid.token.here", secret, algorithms=["HS256"])
    print("FAIL: should have rejected invalid token")
    sys.exit(1)
except jwt.InvalidTokenError:
    print("PASS: invalid token correctly rejected")

# Test 3: reject token signed with wrong secret
wrong_token = jwt.encode({"role": "anon"}, "wrong-secret", algorithm="HS256")
try:
    jwt.decode(wrong_token, secret, algorithms=["HS256"])
    print("FAIL: should have rejected wrong signature")
    sys.exit(1)
except jwt.InvalidSignatureError:
    print("PASS: wrong signature correctly rejected")

print("\nAll JWT tests passed.")

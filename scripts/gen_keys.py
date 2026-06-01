#!/usr/bin/env python3
"""Generate valid Supabase ANON_KEY and SERVICE_ROLE_KEY and write to .env.

No credentials are printed to stdout — all output goes directly to the .env file.
"""
import os
import re
import jwt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(ROOT, 'supabase-psa', '.env')


def main():
    # Read existing .env
    with open(ENV_PATH, 'r') as f:
        content = f.read()

    # Extract JWT_SECRET
    match = re.search(r'^JWT_SECRET=(.+)$', content, re.MULTILINE)
    if not match:
        raise RuntimeError("JWT_SECRET not found in .env")
    secret = match.group(1).strip()

    # Generate keys
    anon_key = jwt.encode({"role": "anon", "iss": "supabase"}, secret, algorithm="HS256")
    service_key = jwt.encode({"role": "service_role", "iss": "supabase"}, secret, algorithm="HS256")

    # Replace placeholder ANON_KEY line
    content = re.sub(
        r'^ANON_KEY=.*$',
        f'ANON_KEY={anon_key}',
        content,
        flags=re.MULTILINE,
    )
    # Replace placeholder SERVICE_ROLE_KEY line
    content = re.sub(
        r'^SERVICE_ROLE_KEY=.*$',
        f'SERVICE_ROLE_KEY={service_key}',
        content,
        flags=re.MULTILINE,
    )

    # Write back
    with open(ENV_PATH, 'w') as f:
        f.write(content)

    # Only print confirmation — no secrets
    print("Done — ANON_KEY and SERVICE_ROLE_KEY updated in supabase-psa/.env")

if __name__ == "__main__":
    main()

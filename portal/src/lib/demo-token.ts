import { SignJWT, jwtVerify } from "jose";

const ALG = "HS256";

function secretKey(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

export async function signDemoToken(secret: string): Promise<string> {
  return new SignJWT({ purpose: "demo" })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secretKey(secret));
}

export async function verifyDemoToken(
  token: string,
  secret: string
): Promise<{ purpose: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret));
    return payload as { purpose: string };
  } catch {
    return null;
  }
}

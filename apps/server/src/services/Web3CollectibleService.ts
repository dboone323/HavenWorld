import crypto from 'crypto';

export class Web3CollectibleService {
  /**
   * Performs zero-cost, off-chain public key signature verification to link
   * external verifiable achievements or avatars without gas fees.
   */
  static verifyOwnershipSignature(
    publicKeyPem: string,
    message: string,
    signatureBase64: string
  ): boolean {
    try {
      const verifier = crypto.createVerify('SHA256');
      verifier.update(message);
      verifier.end();
      return verifier.verify(publicKeyPem, signatureBase64, 'base64');
    } catch {
      return false;
    }
  }

  /**
   * Generates a unique verification challenge for an account
   */
  static generateChallenge(userId: string): { challenge: string; expiresAt: number } {
    const nonce = crypto.randomBytes(16).toString('hex');
    const challenge = `HavenWorld Verifiable Credential Link for User ${userId}: Nonce ${nonce}`;
    return {
      challenge,
      expiresAt: Date.now() + 10 * 60_000, // 10 minutes
    };
  }
}

import crypto from 'crypto';

export type SouvenirRarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY' | 'MYTHIC';

export interface ProvenancePayload {
  souvenirId: string;
  itemId: string;
  itemName: string;
  originalMinterId: string;
  minterUsername: string;
  mintedTimestamp: number;
  serialNumber: number;
  editionTotal: number;
  rarity: SouvenirRarity;
  eventOrigin?: string;
}

export interface ProvenanceCertificate extends ProvenancePayload {
  provenanceHash: string;
  signature: string;
}

export interface OpenMetadataAttribute {
  trait_type: string;
  value: string | number;
}

export interface OpenCollectibleMetadata {
  name: string;
  description: string;
  image: string;
  external_url: string;
  attributes: OpenMetadataAttribute[];
  provenance: {
    hash: string;
    serial: number;
    total: number;
    minter: string;
    timestamp: number;
  };
}

export class Web3CollectibleService {
  private static readonly SYSTEM_CERTIFICATE_SECRET =
    process.env.SOUVENIR_CERTIFICATE_SECRET || 'havenworld_system_provenance_secret_salt_2026';

  /**
   * Generates a tamper-proof cryptographic provenance certificate for a digital souvenir
   */
  static generateProvenanceCertificate(payload: ProvenancePayload): ProvenanceCertificate {
    const rawData = [
      payload.souvenirId,
      payload.itemId,
      payload.originalMinterId,
      payload.mintedTimestamp,
      payload.serialNumber,
      payload.editionTotal,
      payload.rarity,
      payload.eventOrigin || 'GENESIS',
    ].join(':');

    const provenanceHash = crypto.createHash('sha256').update(rawData).digest('hex');

    const signature = crypto
      .createHmac('sha256', this.SYSTEM_CERTIFICATE_SECRET)
      .update(provenanceHash)
      .digest('hex');

    return {
      ...payload,
      provenanceHash,
      signature,
    };
  }

  /**
   * Verifies the authenticity and untampered state of a provenance certificate
   */
  static verifyCertificate(certificate: ProvenanceCertificate): {
    isValid: boolean;
    hashMatches: boolean;
    signatureMatches: boolean;
  } {
    const rawData = [
      certificate.souvenirId,
      certificate.itemId,
      certificate.originalMinterId,
      certificate.mintedTimestamp,
      certificate.serialNumber,
      certificate.editionTotal,
      certificate.rarity,
      certificate.eventOrigin || 'GENESIS',
    ].join(':');

    const computedHash = crypto.createHash('sha256').update(rawData).digest('hex');
    const hashMatches = computedHash === certificate.provenanceHash;

    const expectedSignature = crypto
      .createHmac('sha256', this.SYSTEM_CERTIFICATE_SECRET)
      .update(certificate.provenanceHash)
      .digest('hex');

    const signatureMatches = expectedSignature === certificate.signature;

    return {
      isValid: hashMatches && signatureMatches,
      hashMatches,
      signatureMatches,
    };
  }

  /**
   * Exports an ERC-721 standard compliant JSON metadata document for collector export
   */
  static exportTokenMetadata(
    certificate: ProvenanceCertificate,
    options?: { imageUrl?: string; description?: string }
  ): OpenCollectibleMetadata {
    return {
      name: `${certificate.itemName} #${certificate.serialNumber}/${certificate.editionTotal}`,
      description:
        options?.description ||
        `Official HavenWorld Digital Souvenir minted by ${certificate.minterUsername}. Rarity: ${certificate.rarity}.`,
      image: options?.imageUrl || `https://havenworld.game/assets/souvenirs/${certificate.itemId}.png`,
      external_url: `https://havenworld.game/souvenir/${certificate.souvenirId}`,
      attributes: [
        { trait_type: 'Rarity', value: certificate.rarity },
        { trait_type: 'Serial Number', value: certificate.serialNumber },
        { trait_type: 'Total Editions', value: certificate.editionTotal },
        { trait_type: 'Minter', value: certificate.minterUsername },
        { trait_type: 'Event Origin', value: certificate.eventOrigin || 'Genesis World' },
        { trait_type: 'Minted Year', value: new Date(certificate.mintedTimestamp).getFullYear() },
      ],
      provenance: {
        hash: certificate.provenanceHash,
        serial: certificate.serialNumber,
        total: certificate.editionTotal,
        minter: certificate.originalMinterId,
        timestamp: certificate.mintedTimestamp,
      },
    };
  }

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

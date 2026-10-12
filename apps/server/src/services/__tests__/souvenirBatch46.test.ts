import { Web3CollectibleService, ProvenancePayload } from '../Web3CollectibleService';
import crypto from 'crypto';

describe('Batch 46: Rare Digital Souvenir Provenance Hashing & Certificate Verification', () => {
  const samplePayload: ProvenancePayload = {
    souvenirId: 'souv_aurora_crystal_001',
    itemId: 'item_celestial_aurora_crystal',
    itemName: 'Radiant Aurora Crystal',
    originalMinterId: 'user_star_gazer_42',
    minterUsername: 'StarGazer',
    mintedTimestamp: 1728700000000,
    serialNumber: 7,
    editionTotal: 100,
    rarity: 'MYTHIC',
    eventOrigin: 'Haven Eclipse 2026',
  };

  it('generates a valid SHA-256 cryptographic provenance certificate and HMAC signature', () => {
    const cert = Web3CollectibleService.generateProvenanceCertificate(samplePayload);
    expect(cert).toBeDefined();
    expect(cert.provenanceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(cert.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(cert.serialNumber).toBe(7);
    expect(cert.rarity).toBe('MYTHIC');
  });

  it('verifies untampered certificates successfully', () => {
    const cert = Web3CollectibleService.generateProvenanceCertificate(samplePayload);
    const verification = Web3CollectibleService.verifyCertificate(cert);
    expect(verification.isValid).toBe(true);
    expect(verification.hashMatches).toBe(true);
    expect(verification.signatureMatches).toBe(true);
  });

  it('detects tampering when serial number or minter is manipulated', () => {
    const cert = Web3CollectibleService.generateProvenanceCertificate(samplePayload);

    // Attacker tampers serial number from #7 to #1
    const forgedCert = {
      ...cert,
      serialNumber: 1,
    };

    const verification = Web3CollectibleService.verifyCertificate(forgedCert);
    expect(verification.isValid).toBe(false);
    expect(verification.hashMatches).toBe(false);
  });

  it('exports open ERC-721 standard compliant JSON metadata', () => {
    const cert = Web3CollectibleService.generateProvenanceCertificate(samplePayload);
    const metadata = Web3CollectibleService.exportTokenMetadata(cert);

    expect(metadata.name).toBe('Radiant Aurora Crystal #7/100');
    expect(metadata.attributes.length).toBeGreaterThan(3);
    expect(metadata.provenance.hash).toBe(cert.provenanceHash);
    expect(metadata.provenance.serial).toBe(7);
  });

  it('preserves existing challenge generation and signature verification', () => {
    const challenge = Web3CollectibleService.generateChallenge('user_123');
    expect(challenge.challenge).toContain('user_123');
    expect(challenge.expiresAt).toBeGreaterThan(Date.now());

    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const signer = crypto.createSign('SHA256');
    signer.update(challenge.challenge);
    signer.end();
    const sig = signer.sign(privateKey, 'base64');

    expect(Web3CollectibleService.verifyOwnershipSignature(publicKey, challenge.challenge, sig)).toBe(true);
    expect(Web3CollectibleService.verifyOwnershipSignature(publicKey, 'tampered_data', sig)).toBe(false);
  });
});

import { x25519 } from '@noble/curves/ed25519.js';
import crypto from 'crypto';

const privateKey = crypto.randomBytes(32);
const publicKey = x25519.getPublicKey(privateKey);
console.log('Private:', Buffer.from(privateKey).toString('base64'));
console.log('Public:', Buffer.from(publicKey).toString('base64'));
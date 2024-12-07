// Graciously lifted from OpenAuthJS: https://github.com/openauthjs/openauthjs/blob/08cd2bde94898be3bdf2add8b6a9b82257c73de9/packages/core/src/adapter/password.ts#L384-L449
// You should use a library!
// This file is leaning on `node_compat` set in the wrangler.toml
import crypto, { timingSafeEqual } from 'crypto';

interface PasswordHasher<T> {
	hash(password: string): Promise<T>;
	verify(password: string, compare: T): Promise<boolean>;
}

function ScryptHasher(opts?: { N?: number; r?: number; p?: number }): PasswordHasher<{
	hash: string;
	salt: string;
	N: number;
	r: number;
	p: number;
}> {
	const N = opts?.N ?? 16384;
	const r = opts?.r ?? 8;
	const p = opts?.p ?? 1;

	return {
		async hash(password) {
			const salt = crypto.randomBytes(16);
			const keyLength = 32; // 256 bits

			const derivedKey = await new Promise<Buffer>((resolve, reject) => {
				crypto.scrypt(password, salt, keyLength, { N, r, p }, (err, derivedKey) => {
					if (err) reject(err);
					else resolve(derivedKey);
				});
			});

			const hashBase64 = derivedKey.toString('base64');
			const saltBase64 = salt.toString('base64');

			return {
				hash: hashBase64,
				salt: saltBase64,
				N,
				r,
				p,
			};
		},

		async verify(password, compare) {
			const salt = Buffer.from(compare.salt, 'base64');
			const keyLength = 32; // 256 bits

			const derivedKey = await new Promise<Buffer>((resolve, reject) => {
				crypto.scrypt(password, salt, keyLength, { N: compare.N, r: compare.r, p: compare.p }, (err, derivedKey) => {
					if (err) reject(err);
					else resolve(derivedKey);
				});
			});

			return timingSafeEqual(derivedKey, Buffer.from(compare.hash, 'base64'));
		},
	};
}

const hasher = ScryptHasher();

export async function hashPassword(password: string) {
	const hash = await hasher.hash(password);
	return JSON.stringify(hash);
}

export async function verifyPassword(password: string, hashword: string) {
	return await hasher.verify(password, JSON.parse(hashword));
}

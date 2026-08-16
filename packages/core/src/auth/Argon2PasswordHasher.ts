import { hash, verify, type Options } from "@node-rs/argon2";
import type { PasswordHasher } from "./AuthRepository.js";

const options = {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const satisfies Options;

export class Argon2PasswordHasher implements PasswordHasher {
  private unknownHash?: Promise<string>;

  hash(password: string): Promise<string> {
    return hash(password, options);
  }

  verify(passwordHash: string, password: string): Promise<boolean> {
    return verify(passwordHash, password, options);
  }

  async verifyUnknown(password: string): Promise<void> {
    this.unknownHash ??= hash("unknown-account-password", options);
    await verify(await this.unknownHash, password, options);
  }
}

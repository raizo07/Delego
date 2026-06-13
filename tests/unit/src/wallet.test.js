import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { vaultService } from "../../../services/wallet/dist/src/vault.js";
import { accountService } from "../../../services/wallet/dist/stellar/account.js";

describe("Wallet Service & Vault", () => {
  const vaultDir = path.join(process.cwd(), "../../services/wallet/data");
  const vaultFile = path.join(vaultDir, "vault.json");
  let backupVaultData = null;

  before(async () => {
    // Back up existing vault file if it exists
    try {
      backupVaultData = await fs.readFile(vaultFile, "utf-8");
    } catch (err) {
      // Ignore if file doesn't exist
    }
  });

  after(async () => {
    // Restore vault backup
    try {
      if (backupVaultData !== null) {
        await fs.writeFile(vaultFile, backupVaultData, "utf-8");
      } else {
        await fs.rm(vaultFile, { force: true });
      }
    } catch (err) {
      // Ignore
    }
  });

  it("should encrypt and store a key in the vault and decrypt it back", async () => {
    const testPub = "GATESTPUBKEY1234567890ABCDEF";
    const testSec = "SATESTSECRETKEY1234567890ABCDEF";

    await vaultService.storeKey(testPub, testSec);
    const retrievedSec = await vaultService.getKey(testPub);

    assert.equal(retrievedSec, testSec);
  });

  it("should successfully generate a Stellar keypair", async () => {
    // Stub global fetch to prevent actual friendbot calls in unit tests
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    let fetchUrl = "";

    globalThis.fetch = async (url) => {
      fetchCalled = true;
      fetchUrl = url;
      return {
        ok: true,
        text: async () => "Success"
      };
    };

    try {
      const account = await accountService.createAccount("testnet");

      assert.ok(account.address);
      assert.equal(account.network, "testnet");
      assert.ok(fetchCalled);
      assert.ok(fetchUrl.includes("friendbot.stellar.org"));
      assert.ok(fetchUrl.includes(account.address));

      // Check if it's stored in the vault
      const storedKeys = await vaultService.listPublicKeys();
      assert.ok(storedKeys.includes(account.address));
    } finally {
      // Restore fetch
      globalThis.fetch = originalFetch;
    }
  });
});

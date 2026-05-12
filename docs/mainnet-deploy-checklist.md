# Cadence mainnet deploy checklist

> **Status**: pre-mainnet. Arc mainnet has not launched as of 2026-05-12.
> This is the operator runbook for the moment Arc mainnet goes live.

## Hard prereqs (do NOT deploy without all 7)

- [ ] **Independent audit completed.** All Critical/High findings remediated. Audit report public.
- [ ] **Bug bounty program announced** (minimum $25K bounty pool — funded from Grant M2 if approved).
- [ ] **`v1.0.0` git tag** on the audited commit. Tag is signed.
- [ ] **`PaymentEscrowV2` Solidity source matches** the audited commit byte-for-byte (use `forge inspect ... bytecode` to verify).
- [ ] **Foundry invariant tests** pass with ≥ 10,000 fuzz runs (configured in `contracts/foundry.toml` `[profile.ci]`).
- [ ] **EIP-712 domain `version` bumped to `"3"`** for the mainnet contract. Mainnet sigs and testnet sigs MUST NOT cross-replay.
- [ ] **Deploy signer is a hardware-backed key** (Ledger / Trezor), NOT a hot key. Tx signed offline if possible.

## Soft prereqs (highly recommended)

- [ ] Multisig deploy via Safe wallet to remove single-point-of-failure on deploy signer
- [ ] Pre-publish post-deploy verification commands in a script
- [ ] Have a designated explorer-verification flow ready (verify contract source on Arcscan within 10 min of deploy)
- [ ] Pre-announce maintenance window in Discord / Twitter
- [ ] Monitoring + alerting infrastructure (Tenderly / Defender / Custom) deployed for the new address before first deposit
- [ ] Operational runbook for: pause-not-supported (we have no admin keys), emergency response, contact-tree

## Pre-deploy verification (within 30 min before broadcast)

```sh
# 1. Pin and verify version
git log -1 --format='%H %s'
git tag --verify v1.0.0

# 2. Re-run all tests with CI profile (heavier fuzz)
cd contracts
FOUNDRY_PROFILE=ci forge test -vv
FOUNDRY_PROFILE=ci forge invariant

# 3. Verify bytecode against audited commit
forge inspect PaymentEscrowV2 bytecode > deploy-bytecode.txt
sha256sum deploy-bytecode.txt   # compare against audit artifact

# 4. Estimate gas on a fork of mainnet (when mainnet RPC is available)
forge script script/DeployMainnet.s.sol --rpc-url $ARC_MAINNET_RPC --account ledger --sender $DEPLOYER

# 5. Dry-run: simulate without broadcasting
forge script script/DeployMainnet.s.sol --rpc-url $ARC_MAINNET_RPC --account ledger --sender $DEPLOYER
```

## Deploy

```sh
# Requires:
#   - $ARC_MAINNET_RPC env set
#   - Hardware-backed signer attached (Ledger via --account / --keystore)
#   - MAINNET_CONFIRM=true to bypass the script's safety latch
MAINNET_CONFIRM=true forge script script/DeployMainnet.s.sol \
    --rpc-url $ARC_MAINNET_RPC \
    --account mainnet-deployer \
    --sender $DEPLOYER_ADDR \
    --broadcast \
    --verify \
    --etherscan-api-key $ARCSCAN_API_KEY \
    --slow
```

## Post-deploy verification (within 10 min after deploy)

- [ ] Contract address noted, recorded in `.env` AND announced
- [ ] Bytecode on chain matches local artifact (`cast code <addr> --rpc-url $RPC`)
- [ ] EIP-712 `DOMAIN_SEPARATOR()` matches the expected value
- [ ] First deposit attempt with 0.0001 USDC succeeds
- [ ] First withdraw attempt with 0.0001 USDC succeeds
- [ ] First claim + settle attempt with 0.0001 USDC succeeds
- [ ] First batch settle with 2-claim payload succeeds
- [ ] Block explorer shows verified source

## Announce

- [ ] Tweet: deployment + address + audit link + bug-bounty link
- [ ] Discord: pinned message in `#general` and `#announcements`
- [ ] Update `README.md` with mainnet badge + address
- [ ] Update `docs/spec.md` network parameters section
- [ ] Update both SDK package READMEs and `constants.ts` / `constants.py`
- [ ] Publish v1.0.0 release notes on GitHub

## Rollback / pause posture

**The contract has no pause function.** This is intentional — admin keys are an attack surface we don't want. If a critical vulnerability is found post-deploy:

1. Public disclosure via Discord + Twitter (within 1h of confirmation)
2. Deploy V_{n+1} with the fix, new EIP-712 domain version
3. Encourage users to withdraw from V_n and re-deposit into V_{n+1}
4. V_n remains operational but flagged as deprecated in docs/SDK; UX will route users to V_{n+1} automatically

## Day-1 monitoring targets

For the first 7 days post-deploy:

- Transaction count per hour: alert if < 10 (likely a config issue elsewhere) or > 10,000 (likely abuse)
- Unique deposit-from addresses: log and inspect for sybil patterns
- Settlement batch sizes: confirm ≥ 10 to validate our economic model
- Failed-claim revert reasons: aggregate by selector, alert on > 100 InvalidSignature in 1 hour (potential coordinated attack)
- Contract native balance growth + sum(`balanceOf`): invariant check, alert on divergence

## Contact tree

(Fill in after team grows beyond solo)

- Primary on-call: Zen Chen
- Secondary on-call: TBD
- Auditor escalation: TBD (post-M2)
- Circle contact: TBD (post-Grant)

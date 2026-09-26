import { test } from "node:test";
import assert from "node:assert/strict";
import { makePaymentGuard } from "../src/agents/guard.js";

function fakeRes() {
  const r: any = { statusCode: 200, body: null, headers: {} as Record<string, string> };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; };
  return r;
}
const req = (tx?: string) => ({ header: (name: string) => (name === "X-Payment-Tx" ? tx : undefined) }) as any;
const HASH = "0x" + "ab".repeat(32);

test("missing payment header -> 402 with instructions", async () => {
  const guard = makePaymentGuard(async () => ({ ok: true }), () => ({ amount: "1" }));
  const res = fakeRes(); let next = false;
  await guard(req(), res, () => { next = true; });
  assert.equal(res.statusCode, 402); assert.equal(res.body.amount, "1"); assert.equal(next, false);
});

test("malformed hash -> 402, verifier never called", async () => {
  let called = 0;
  const guard = makePaymentGuard(async () => { called++; return { ok: true }; }, () => ({}));
  const res = fakeRes();
  await guard(req("not-a-hash"), res, () => {});
  assert.equal(res.statusCode, 402); assert.equal(called, 0);
});

test("valid payment passes once, duplicate reuse is rejected", async () => {
  let verified = 0;
  const guard = makePaymentGuard(async () => { verified++; return { ok: true }; }, () => ({}));
  const r1 = fakeRes(); let next1 = false;
  await guard(req(HASH), r1, () => { next1 = true; });
  assert.equal(next1, true); assert.equal(r1.headers["X-Payment-Tx"], HASH);
  const r2 = fakeRes(); let next2 = false;
  await guard(req(HASH.toUpperCase().replace("0X", "0x")), r2, () => { next2 = true; });
  assert.equal(next2, false); assert.equal(r2.statusCode, 402); assert.match(r2.body.error, /already used/);
  assert.equal(verified, 1, "second attempt short-circuits before verification");
});

test("failed verification -> 402 with reason and hash stays reusable for a later valid proof", async () => {
  let ok = false;
  const guard = makePaymentGuard(async () => (ok ? { ok: true } : { ok: false, reason: "underpaid" }), () => ({}));
  const r1 = fakeRes();
  await guard(req(HASH), r1, () => {});
  assert.equal(r1.statusCode, 402); assert.equal(r1.body.error, "underpaid");
  ok = true;
  const r2 = fakeRes(); let next = false;
  await guard(req(HASH), r2, () => { next = true; });
  assert.equal(next, true);
});

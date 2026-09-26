import { test } from "node:test";
import assert from "node:assert/strict";
import { assertBucketAllowed, getBucket, getR2Config, getSecureBucket } from "../storage";

const ENV_KEYS = [
  "VERCEL",
  "VERCEL_ENV",
  "R2_ENDPOINT",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_SECURE_BUCKET_NAME",
  "R2_PREVIEW_ENDPOINT",
  "R2_PREVIEW_ACCESS_KEY_ID",
  "R2_PREVIEW_SECRET_ACCESS_KEY",
  "R2_PREVIEW_BUCKET_NAME",
  "R2_PREVIEW_SECURE_BUCKET_NAME",
];

function withEnv(values: Record<string, string | undefined>, run: () => void) {
  const previous = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const previewValues = {
  VERCEL_ENV: "preview",
  R2_ENDPOINT: "https://shared.example.invalid",
  R2_ACCESS_KEY_ID: "shared-access-key",
  R2_SECRET_ACCESS_KEY: "shared-secret-key",
  R2_BUCKET_NAME: "production-bucket",
  R2_PREVIEW_ENDPOINT: "https://preview.example.invalid",
  R2_PREVIEW_ACCESS_KEY_ID: "preview-access-key",
  R2_PREVIEW_SECRET_ACCESS_KEY: "preview-secret-key",
  R2_PREVIEW_BUCKET_NAME: "preview-bucket",
};

const previewOnly = {
  VERCEL_ENV: "preview",
  R2_PREVIEW_ENDPOINT: "https://preview.example.invalid",
  R2_PREVIEW_ACCESS_KEY_ID: "preview-access-key",
  R2_PREVIEW_SECRET_ACCESS_KEY: "preview-secret-key",
  R2_PREVIEW_BUCKET_NAME: "preview-bucket",
};

test("Preview refuses to use shared R2 variables when dedicated config is absent", () => {
  withEnv({
    VERCEL_ENV: "preview",
    R2_ENDPOINT: "https://shared.example.invalid",
    R2_ACCESS_KEY_ID: "shared-access-key",
    R2_SECRET_ACCESS_KEY: "shared-secret-key",
    R2_BUCKET_NAME: "production-bucket",
  }, () => {
    assert.throws(() => getR2Config(), /R2_PREVIEW_ENDPOINT is configured/);
  });
});

test("Preview uses only dedicated bucket and credentials", () => {
  withEnv(previewValues, () => {
    const config = getR2Config();
    assert.equal(config.endpoint, previewValues.R2_PREVIEW_ENDPOINT);
    assert.equal(config.accessKeyId, previewValues.R2_PREVIEW_ACCESS_KEY_ID);
    assert.equal(config.secretAccessKey, previewValues.R2_PREVIEW_SECRET_ACCESS_KEY);
    assert.equal(getBucket(), previewValues.R2_PREVIEW_BUCKET_NAME);
    assert.equal(getSecureBucket(), previewValues.R2_PREVIEW_BUCKET_NAME);
  });
});

test("Preview rejects the shared bucket or shared credentials", () => {
  withEnv({ ...previewValues, R2_PREVIEW_BUCKET_NAME: "production-bucket" }, () => {
    assert.throws(() => getR2Config(), /separate from the general R2 buckets/);
  });
  withEnv({ ...previewValues, R2_PREVIEW_ACCESS_KEY_ID: "shared-access-key" }, () => {
    assert.throws(() => getR2Config(), /access key separate/);
  });
  withEnv({ ...previewValues, R2_PREVIEW_SECRET_ACCESS_KEY: "shared-secret-key" }, () => {
    assert.throws(() => getR2Config(), /secret key separate/);
  });
});

test("Preview rejects a secure-object bucket that matches the shared secure bucket", () => {
  withEnv({
    ...previewValues,
    R2_SECURE_BUCKET_NAME: "shared-preview-secure-bucket",
    R2_PREVIEW_SECURE_BUCKET_NAME: "shared-preview-secure-bucket",
  }, () => {
    assert.throws(() => getR2Config(), /separate from the general R2 buckets/);
  });
});

test("non-Preview environments retain the existing R2 configuration", () => {
  withEnv({
    VERCEL_ENV: "production",
    R2_ENDPOINT: "https://general.example.invalid",
    R2_ACCESS_KEY_ID: "general-access-key",
    R2_SECRET_ACCESS_KEY: "general-secret-key",
    R2_BUCKET_NAME: "general-bucket",
    R2_SECURE_BUCKET_NAME: "secure-bucket",
  }, () => {
    assert.equal(getBucket(), "general-bucket");
    assert.equal(getSecureBucket(), "secure-bucket");
    assert.equal(getR2Config().accessKeyId, "general-access-key");
  });
});


test("Preview rejects crossing the general main and secure buckets", () => {
  withEnv({
    ...previewValues,
    R2_SECURE_BUCKET_NAME: "production-secure-preview",
    R2_PREVIEW_BUCKET_NAME: "production-secure-preview",
  }, () => {
    assert.throws(() => getR2Config(), /separate from the general R2 buckets/);
  });
  withEnv({
    ...previewValues,
    R2_BUCKET_NAME: "production-preview-named",
    R2_PREVIEW_SECURE_BUCKET_NAME: "production-preview-named",
  }, () => {
    assert.throws(() => getR2Config(), /separate from the general R2 buckets/);
  });
});

test("Preview rejects bucket names without 'preview' even when general vars are absent", () => {
  withEnv({ ...previewOnly, R2_PREVIEW_BUCKET_NAME: "some-production-bucket" }, () => {
    assert.throws(() => getR2Config(), /must contain "preview"/);
  });
  withEnv({ ...previewOnly, R2_PREVIEW_SECURE_BUCKET_NAME: "vault" }, () => {
    assert.throws(() => getR2Config(), /must contain "preview"/);
  });
  withEnv({ ...previewOnly, R2_PREVIEW_BUCKET_NAME: "crucible-files" }, () => {
    assert.throws(() => getR2Config(), /separate from the general R2 buckets/);
  });
  withEnv(previewOnly, () => {
    assert.equal(getBucket(), "preview-bucket");
  });
});

test("Comparisons trim whitespace on the general values", () => {
  withEnv({ ...previewValues, R2_BUCKET_NAME: "shared-preview\n", R2_PREVIEW_BUCKET_NAME: "shared-preview" }, () => {
    assert.throws(() => getR2Config(), /separate from the general R2 buckets/);
  });
  withEnv({ ...previewValues, R2_ACCESS_KEY_ID: "preview-access-key\n" }, () => {
    assert.throws(() => getR2Config(), /access key separate/);
  });
});

test("A Vercel runtime with VERCEL_ENV missing fails closed", () => {
  withEnv({
    VERCEL: "1",
    R2_ENDPOINT: "https://shared.example.invalid",
    R2_ACCESS_KEY_ID: "shared-access-key",
    R2_SECRET_ACCESS_KEY: "shared-secret-key",
    R2_BUCKET_NAME: "production-bucket",
  }, () => {
    assert.throws(() => getR2Config(), /R2_PREVIEW_ENDPOINT is configured/);
  });
});

test("Local runs without Vercel keep the general configuration", () => {
  withEnv({ R2_BUCKET_NAME: "local-bucket" }, () => {
    assert.equal(getBucket(), "local-bucket");
  });
});

test("Preview refuses row buckets outside its configured buckets", () => {
  withEnv(previewValues, () => {
    assert.doesNotThrow(() => assertBucketAllowed("preview-bucket"));
    assert.throws(() => assertBucketAllowed("production-bucket"), /outside its configured Preview buckets/);
  });
  withEnv({ VERCEL_ENV: "production", R2_BUCKET_NAME: "production-bucket" }, () => {
    assert.doesNotThrow(() => assertBucketAllowed("production-bucket"));
  });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareVersions,
  releaseDecision,
  selectRelease,
  ensureReleaseTag,
} from "../ci-release.mjs";

const sha = "a".repeat(40);
const repo = { owner: "owner", repo: "drc" };
const successful = {
  event: "push",
  status: "completed",
  conclusion: "success",
  head_sha: sha,
  head_branch: "main",
  head_repository: { full_name: "owner/drc" },
};
function api({ published = false, tag = null, runs = [successful] } = {}) {
  const calls = [];
  let current = tag;
  const github = {
    paginate: async () => [{ name: "v0.4.8" }],
    rest: {
      actions: {
        listWorkflowRuns: async () => ({ data: { workflow_runs: runs } }),
      },
      repos: {
        listTags() {},
        getReleaseByTag: async () => {
          if (!published) throw { status: 404 };
          return { data: { draft: false } };
        },
      },
      git: {
        getRef: async () => {
          if (!current) throw { status: 404 };
          return { data: { object: { type: "commit", sha: current } } };
        },
        createTag: async (args) => {
          calls.push(["tag", args]);
          return { data: { sha: "b".repeat(40) } };
        },
        createRef: async (args) => {
          calls.push(["ref", args]);
          current = sha;
        },
      },
    },
  };
  return { github, calls };
}
const context = {
  repo,
  ref: "refs/heads/main",
  eventName: "workflow_run",
  payload: { repository: { default_branch: "main" }, workflow_run: successful },
};
test("a new version is eligible; a published version is skipped with an explicit reason", () => {
  assert.equal(
    releaseDecision({ version: "0.5.0", sha, tags: ["v0.4.8"] }).release,
    true,
  );
  const old = releaseDecision({
    version: "0.5.0",
    sha,
    tags: ["v0.5.0"],
    published: true,
  });
  assert.equal(old.release, false);
  assert.match(old.reason, /already published/);
  assert(compareVersions("0.10.0", "0.9.9") > 0);
});
test("unpublished tags may be retried only at their original commit; downgrades and malformed versions fail", () => {
  assert.equal(
    releaseDecision({ version: "0.5.0", sha, tags: [], existingTag: sha })
      .release,
    true,
  );
  assert.throws(
    () =>
      releaseDecision({
        version: "0.5.0",
        sha,
        tags: [],
        existingTag: "other",
      }),
    /different commit/,
  );
  assert.throws(
    () => releaseDecision({ version: "0.5.0", sha, tags: ["v0.6.0"] }),
    /newer version/,
  );
  assert.throws(
    () => releaseDecision({ version: "0.5.0;exec", sha, tags: [] }),
    /X.Y.Z/,
  );
});
test("automatic publication accepts only successful Checks from this repository and default-branch commit", async () => {
  assert.equal(
    (await selectRelease({ ...api(), context, version: "0.5.0", sha })).release,
    true,
  );
  for (const change of [
    { conclusion: "failure" },
    { event: "pull_request" },
    { head_branch: "feature" },
    { head_sha: "wrong" },
    { head_repository: { full_name: "fork/drc" } },
  ]) {
    await assert.rejects(
      selectRelease({
        ...api(),
        context: {
          ...context,
          payload: {
            ...context.payload,
            workflow_run: { ...successful, ...change },
          },
        },
        version: "0.5.0",
        sha,
      }),
      /successful Checks/,
    );
  }
});
test("manual builds require current successful Checks; no older success can bypass a newer failure or pending run", async () => {
  const manual = { ...context, eventName: "workflow_dispatch" };
  assert.equal(
    (await selectRelease({ ...api(), context: manual, version: "0.5.0", sha }))
      .release,
    true,
  );
  for (const runs of [
    [],
    [{ ...successful, conclusion: "failure" }, successful],
    [{ ...successful, status: "in_progress", conclusion: null }, successful],
  ]) {
    await assert.rejects(
      selectRelease({
        ...api({ runs }),
        context: manual,
        version: "0.5.0",
        sha,
      }),
      /Checks successfully/,
    );
  }
  await assert.rejects(
    selectRelease({
      ...api(),
      context: { ...manual, ref: "refs/heads/feature" },
      version: "0.5.0",
      sha,
    }),
    /Run Desktop packages from main/,
  );
});
test("tag creation is annotated, commit-pinned, idempotent and refuses to move an existing tag", async () => {
  const mock = api();
  await ensureReleaseTag({ ...mock, repo, version: "0.5.0", sha });
  await ensureReleaseTag({ ...mock, repo, version: "0.5.0", sha });
  assert.equal(mock.calls.length, 2);
  assert.equal(mock.calls[0][1].object, sha);
  assert.equal(mock.calls[1][1].ref, "refs/tags/v0.5.0");
  await assert.rejects(
    ensureReleaseTag({ ...api({ tag: "wrong" }), repo, version: "0.5.0", sha }),
    /changed after review/,
  );
});
